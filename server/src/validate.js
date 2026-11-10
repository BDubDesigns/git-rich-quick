/**
 * Get Rich Quick GIT — server-side save validation (Slice 1).
 *
 * The client sends a snapshot, not a trusted balance. The server holds the
 * last accepted snapshot and recomputes what is possible from it. Implements
 * the nine rules from `save-schema-validation-spec.md`, with two deliberate
 * deviations, both documented here and in the PR:
 *
 * 1. CREDITING USES THE NEW SNAPSHOT'S RATES, not the previous snapshot's.
 *    The spec says to use the previous snapshot's employees/bonuses, which
 *    can only under-credit. But under-crediting plus a hard 409 reject
 *    false-rejects legitimate play: buy an OverReact level mid-window and
 *    your clicks earn at the new rate, which the old rate cannot explain,
 *    so the save is rejected and the client discards the purchase. We
 *    credit at the new snapshot's rates instead. This can over-credit a
 *    player who upgrades late in a window, bounded by the rate delta times
 *    the window length — and upgrades are real purchases, verified by the
 *    money, LOC, and delta rules, with finite levels. The proper fix is
 *    split-window accounting (credit each rate for the time it was live),
 *    which needs purchase timestamps the client does not send yet.
 *
 * 2. SHAPE failures are 400 and RATE_LIMIT is 429, not 409. A malformed
 *    body is a bad request, and a rate-limited save must NOT make the
 *    client discard its local state (the 409 path does that) — it should
 *    keep its actions and retry on the next heartbeat. `validateSave`
 *    returns the rule; the HTTP layer maps SHAPE -> 400, RATE_LIMIT -> 429,
 *    everything else -> 409.
 *
 * Pure function: no I/O, no clock of its own. `prev` is the last accepted
 * snapshot `{ state, savedAtMs }`; for a brand-new player the store passes
 * the initial state with savedAtMs = player creation time. `nowMs` is the
 * server time of the save attempt.
 */

import {
  BALANCE,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  employeePurchaseCosts,
  employeeUnlockConditionsMet,
  locPerClick,
  locPerSecond,
  openSourceLevelCosts,
  openSourceUnlockConditionsMet,
} from "../../shared/game-balance.js";

/** Max plausible sustained click rate: 10 clicks/second. */
export const MAX_CLICKS_PER_SECOND = 10;
/** Small grace on the click-count cap, for timing jitter. */
export const CLICK_GRACE = 10;
/** Offline passive accrual is capped at 8 hours. */
export const MAX_OFFLINE_ACCRUAL_SECONDS = 8 * 60 * 60;
/** At most one accepted save per 10 seconds per player. */
export const SAVE_RATE_LIMIT_SECONDS = 10;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(rule, detail) {
  return { ok: false, rule, detail };
}

function isInt(n) {
  return Number.isInteger(n);
}

function isNonNegNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function hasExactKeys(obj, keys) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return false;
  }
  const actual = Object.keys(obj);
  return (
    actual.length === keys.length && keys.every((key) => key in obj)
  );
}

function isCountMap(obj, keys) {
  return (
    hasExactKeys(obj, keys) &&
    keys.every((key) => isInt(obj[key]) && obj[key] >= 0)
  );
}

/**
 * Rule 1 — shape. Only known keys, right types, no negatives, levels 0-3,
 * NoPilot frozen at 0 (no buy action exists for it in v1).
 */
function checkShape(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "body must be an object";
  }
  if (typeof body.playerId !== "string" || !UUID_RE.test(body.playerId)) {
    return "playerId must be a UUID string";
  }
  const state = body.state;
  if (
    !hasExactKeys(state, [
      "linesOfCode",
      "totalLinesOfCode",
      "money",
      "employees",
      "aiAssistants",
      "freelanceProjectsCompleted",
      "openSourceProjects",
      "unlockedEmployees",
      "unlockedOpenSourceProjects",
    ])
  ) {
    return "state has unknown or missing keys";
  }
  if (!isNonNegNumber(state.linesOfCode)) {
    return "linesOfCode must be a non-negative number";
  }
  if (!isNonNegNumber(state.totalLinesOfCode)) {
    return "totalLinesOfCode must be a non-negative number";
  }
  if (!isInt(state.money) || state.money < 0) {
    return "money must be a non-negative integer (cents)";
  }
  if (!isCountMap(state.employees, EMPLOYEE_TYPES)) {
    return "employees must be non-negative integer counts";
  }
  if (
    !hasExactKeys(state.aiAssistants, ["noPilot"]) ||
    !isInt(state.aiAssistants.noPilot) ||
    state.aiAssistants.noPilot < 0
  ) {
    return "aiAssistants.noPilot must be a non-negative integer";
  }
  if (state.aiAssistants.noPilot > 0) {
    return "noPilot count must be 0 in v1 (no buy action exists)";
  }
  if (
    !isCountMap(state.freelanceProjectsCompleted, FREELANCE_PROJECT_KEYS)
  ) {
    return "freelanceProjectsCompleted must be non-negative integer counts";
  }
  if (!isCountMap(state.openSourceProjects, OPEN_SOURCE_IDS)) {
    return "openSourceProjects must be non-negative integer levels";
  }
  for (const projectId of OPEN_SOURCE_IDS) {
    if (state.openSourceProjects[projectId] > 3) {
      return "open-source level must be 0-3";
    }
  }
  if (
    !hasExactKeys(state.unlockedEmployees, EMPLOYEE_TYPES) ||
    !EMPLOYEE_TYPES.every(
      (key) => typeof state.unlockedEmployees[key] === "boolean"
    )
  ) {
    return "unlockedEmployees must be booleans";
  }
  if (
    !hasExactKeys(state.unlockedOpenSourceProjects, OPEN_SOURCE_IDS) ||
    !OPEN_SOURCE_IDS.every(
      (key) => typeof state.unlockedOpenSourceProjects[key] === "boolean"
    )
  ) {
    return "unlockedOpenSourceProjects must be booleans";
  }
  const actions = body.actionsSinceLastSave;
  if (
    !hasExactKeys(actions, [
      "clicks",
      "employeesBought",
      "projectsCompleted",
      "openSourceLevelsBought",
    ])
  ) {
    return "actionsSinceLastSave has unknown or missing keys";
  }
  if (!isInt(actions.clicks) || actions.clicks < 0) {
    return "actions.clicks must be a non-negative integer";
  }
  if (!isCountMap(actions.employeesBought, EMPLOYEE_TYPES)) {
    return "actions.employeesBought must be non-negative integer counts";
  }
  if (
    !isCountMap(actions.projectsCompleted, FREELANCE_PROJECT_KEYS)
  ) {
    return "actions.projectsCompleted must be non-negative integer counts";
  }
  if (
    !isCountMap(actions.openSourceLevelsBought, OPEN_SOURCE_IDS)
  ) {
    return "actions.openSourceLevelsBought must be non-negative integer counts";
  }
  return null;
}

/**
 * Validate one save attempt against the last accepted snapshot.
 * Returns `{ ok: true }` or `{ ok: false, rule, detail }`.
 */
export function validateSave(prev, body, nowMs) {
  const shapeError = checkShape(body);
  if (shapeError) return fail("SHAPE", shapeError);

  const prevState = prev.state;
  const newState = body.state;
  const actions = body.actionsSinceLastSave;

  // Rule 9 — rate limit: at most one accepted save per 10 seconds.
  if (nowMs - prev.savedAtMs < SAVE_RATE_LIMIT_SECONDS * 1000) {
    return fail(
      "RATE_LIMIT",
      `save too soon after the last accepted save (${SAVE_RATE_LIMIT_SECONDS}s minimum)`
    );
  }

  // Rule 2 — monotonicity: counts and totals never decrease, latches only flip false -> true.
  for (const type of EMPLOYEE_TYPES) {
    if (newState.employees[type] < prevState.employees[type]) {
      return fail("MONOTONIC", `employee count decreased: ${type}`);
    }
    if (
      prevState.unlockedEmployees[type] &&
      !newState.unlockedEmployees[type]
    ) {
      return fail("MONOTONIC", `employee unlock latch flipped back: ${type}`);
    }
  }
  for (const key of FREELANCE_PROJECT_KEYS) {
    if (
      newState.freelanceProjectsCompleted[key] <
      prevState.freelanceProjectsCompleted[key]
    ) {
      return fail("MONOTONIC", `project completions decreased: ${key}`);
    }
  }
  for (const projectId of OPEN_SOURCE_IDS) {
    if (
      newState.openSourceProjects[projectId] <
      prevState.openSourceProjects[projectId]
    ) {
      return fail("MONOTONIC", `open-source level decreased: ${projectId}`);
    }
    if (
      prevState.unlockedOpenSourceProjects[projectId] &&
      !newState.unlockedOpenSourceProjects[projectId]
    ) {
      return fail(
        "MONOTONIC",
        `open-source unlock latch flipped back: ${projectId}`
      );
    }
  }
  if (newState.totalLinesOfCode < prevState.totalLinesOfCode) {
    return fail("MONOTONIC", "totalLinesOfCode decreased");
  }

  // Rule 3 — unlocks are real: recompute each unlock from the new snapshot itself.
  for (const type of EMPLOYEE_TYPES) {
    if (
      newState.unlockedEmployees[type] &&
      !employeeUnlockConditionsMet(type, newState)
    ) {
      return fail(
        "UNLOCK",
        `employee unlock claimed without meeting conditions: ${type}`
      );
    }
  }
  for (const projectId of OPEN_SOURCE_IDS) {
    if (
      newState.unlockedOpenSourceProjects[projectId] &&
      !openSourceUnlockConditionsMet(projectId, newState)
    ) {
      return fail(
        "UNLOCK",
        `open-source unlock claimed without meeting conditions: ${projectId}`
      );
    }
  }

  // Time window. Elapsed is clamped at zero (clock skew) and passive
  // accrual is capped at 8 hours; the click-count cap uses uncapped elapsed.
  const elapsedSeconds = Math.max(0, (nowMs - prev.savedAtMs) / 1000);
  const passiveSeconds = Math.min(elapsedSeconds, MAX_OFFLINE_ACCRUAL_SECONDS);

  // Rule 5 — clicks: at most 10/sec sustained, plus a small grace.
  if (actions.clicks > MAX_CLICKS_PER_SECOND * elapsedSeconds + CLICK_GRACE) {
    return fail(
      "CLICKS",
      `${actions.clicks} clicks in ${elapsedSeconds.toFixed(1)}s exceeds the plausible maximum`
    );
  }

  // Max earnable LOC in the window, credited at the NEW snapshot's rates
  // (see the deviation note at the top of this file).
  const maxPassive =
    locPerSecond(newState.employees, newState.openSourceProjects) *
    passiveSeconds;
  const maxClickLoc =
    actions.clicks * locPerClick(newState.openSourceProjects);

  // LOC spent in the window, from the claimed actions.
  let projectLocCost = 0;
  for (const key of FREELANCE_PROJECT_KEYS) {
    projectLocCost +=
      actions.projectsCompleted[key] * BALANCE.freelanceProjects[key].loc;
  }
  let openSourceLocCost = 0;
  for (const projectId of OPEN_SOURCE_IDS) {
    openSourceLocCost += openSourceLevelCosts(
      projectId,
      prevState.openSourceProjects[projectId],
      newState.openSourceProjects[projectId]
    );
  }

  // Rule 6 — LOC accounting. Tolerance covers fractional-tick rounding.
  const expectedLoc =
    prevState.linesOfCode + maxPassive + maxClickLoc - projectLocCost - openSourceLocCost;
  const tolerance = Math.max(10, 0.01 * Math.max(expectedLoc, 0));
  if (newState.linesOfCode > expectedLoc + tolerance) {
    return fail(
      "LOC",
      `linesOfCode ${newState.linesOfCode} exceeds the maximum earnable ${expectedLoc.toFixed(1)} (+${tolerance.toFixed(1)} tolerance)`
    );
  }
  const totalGained = newState.totalLinesOfCode - prevState.totalLinesOfCode;
  if (totalGained > maxPassive + maxClickLoc + tolerance) {
    return fail(
      "LOC",
      `totalLinesOfCode gained ${totalGained.toFixed(1)} exceeds the maximum earnable ${(maxPassive + maxClickLoc).toFixed(1)} (+${tolerance.toFixed(1)} tolerance)`
    );
  }
  if (newState.totalLinesOfCode < newState.linesOfCode) {
    return fail("LOC", "totalLinesOfCode is less than linesOfCode");
  }

  // Rule 7 — money accounting, exact, no tolerance. Money only moves via
  // completed projects (in) and employee hires (out), in purchase order.
  let expectedMoney = prevState.money;
  for (const key of FREELANCE_PROJECT_KEYS) {
    expectedMoney +=
      actions.projectsCompleted[key] * BALANCE.freelanceProjects[key].reward;
  }
  for (const type of EMPLOYEE_TYPES) {
    const costs = employeePurchaseCosts(
      type,
      prevState.employees[type],
      actions.employeesBought[type]
    );
    for (const cost of costs) expectedMoney -= cost;
  }
  if (newState.money !== expectedMoney) {
    return fail(
      "MONEY",
      `money ${newState.money} does not match the expected ${expectedMoney}`
    );
  }

  // Rule 8 — action deltas agree with the snapshot.
  for (const type of EMPLOYEE_TYPES) {
    if (
      newState.employees[type] - prevState.employees[type] !==
      actions.employeesBought[type]
    ) {
      return fail(
        "DELTA",
        `employee delta disagrees with claimed purchases: ${type}`
      );
    }
  }
  for (const key of FREELANCE_PROJECT_KEYS) {
    if (
      newState.freelanceProjectsCompleted[key] -
        prevState.freelanceProjectsCompleted[key] !==
      actions.projectsCompleted[key]
    ) {
      return fail(
        "DELTA",
        `project delta disagrees with claimed completions: ${key}`
      );
    }
  }
  for (const projectId of OPEN_SOURCE_IDS) {
    if (
      newState.openSourceProjects[projectId] -
        prevState.openSourceProjects[projectId] !==
      actions.openSourceLevelsBought[projectId]
    ) {
      return fail(
        "DELTA",
        `open-source delta disagrees with claimed levels: ${projectId}`
      );
    }
  }

  return { ok: true };
}
