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
 * 3. GOLDEN STARS (issue #33) are client-rolled, server-validated. The
 *    client rolls the outcome at click time and reports it as a star
 *    claim in `actionsSinceLastSave.starClaims`; the server validates
 *    plausibility + accounting (see `validateStarClaims`): the effect
 *    must be unlocked at the Constellation level, each claimed amount
 *    must be within the possible range for that effect at the player's
 *    rate/cash, timed buffs must carry the exact multiplier/duration
 *    for the effect, and the number of claims in the window is capped
 *    by the spawn rate (at most ceil(window / min interval) + 1). The
 *    LOC and money rules then credit the claimed star gains (and debit
 *    the claimed losses) and add the buff allowance to the max earnable,
 *    so a legitimate star reward never false-rejects. This is the
 *    strongest validation that fits the save model without a
 *    server-rolled outcome endpoint; that endpoint is a follow-up slice
 *    paired with the leaderboard (#29), and until it lands a player
 *    could in principle claim the maximum star reward on every spawn.
 *    The bound keeps that to the spawn-capped maximum, and the claim
 *    must still match the snapshot deltas exactly (rules 6-8), so the
 *    exposure is a bounded over-credit, not an open faucet.
 *
 * Star-era fields are backward-compatible: a save (or client) from
 * before Constellation shipped lacks `constellation` in the
 * open-source maps, `activeStarEffects` on the state, and `starClaims`
 * in the actions. Those are defaulted (constellation 0 / unlocked,
 * no active buffs, no claims) by `normalizeSaveState` /
 * `normalizeStarActions` before any check runs, so old saves keep
 * validating. Only the new fields are defaulted — a missing old
 * field is still a shape error.
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
  STAR_CONFIG,
  STAR_EFFECT_IDS,
  baseLocPerSecond,
  employeePurchaseCosts,
  employeeUnlockConditionsMet,
  locPerClick,
  locPerSecond,
  normalizeSaveState,
  normalizeStarActions,
  openSourceLevelCosts,
  openSourceUnlockConditionsMet,
  passiveBonus,
  starSpawnIntervalSeconds,
  unlockedStarEffects,
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
 * Rule 1 — shape. Only known keys, right types, no negatives, levels
 * 0 to each project's own max (5 for all three projects now), NoPilot
 * frozen at 0 (no buy action exists for it in v1). Star-era fields
 * (activeStarEffects, starClaims) are validated here too.
 */
/**
 * Shape-check a bare save state (no playerId, no actions). Extracted from
 * checkShape so the admin seed endpoint (issue #46) can reuse it: a seed
 * bypasses progression validation, but the state must still be a
 * well-formed state or the next load/save breaks. Returns an error string,
 * or null when the state is well-formed.
 */
function checkStateShape(state) {
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
      "activeStarEffects",
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
    const maxLevel = BALANCE.openSource[projectId].levels.length;
    if (state.openSourceProjects[projectId] > maxLevel) {
      return `open-source level must be 0-${maxLevel}`;
    }
  }
  if (!Array.isArray(state.activeStarEffects)) {
    return "activeStarEffects must be an array";
  }
  for (const entry of state.activeStarEffects) {
    const entryError = activeStarEffectError(entry);
    if (entryError) return entryError;
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
  return null;
}

/**
 * Shape-check an actions object. Extracted from checkShape (see
 * checkStateShape).
 */
function checkActionsShape(actions) {
  if (
    !hasExactKeys(actions, [
      "clicks",
      "employeesBought",
      "projectsCompleted",
      "openSourceLevelsBought",
      "starClaims",
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
  if (!Array.isArray(actions.starClaims)) {
    return "actions.starClaims must be an array";
  }
  for (const claim of actions.starClaims) {
    const claimError = starClaimShapeError(claim);
    if (claimError) return claimError;
  }
  return null;
}

function checkShape(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "body must be an object";
  }
  if (typeof body.playerId !== "string" || !UUID_RE.test(body.playerId)) {
    return "playerId must be a UUID string";
  }
  const stateError = checkStateShape(body.state);
  if (stateError) return stateError;
  return checkActionsShape(body.actionsSinceLastSave);
}

/**
 * Shape-check a bare save state for the admin seed endpoint (issue #46).
 * The seed bypasses progression validation, but the state must still be
 * well-formed. Star-era fields are defaulted the same way validateSave
 * does, so a state from before Constellation still seeds. Returns
 * `{ ok: true, state }` with the normalized state, or
 * `{ ok: false, detail }`.
 */
export function validateSeedState(state) {
  const normalized = normalizeSaveState(state);
  const error = checkStateShape(normalized);
  if (error) return { ok: false, detail: error };
  return { ok: true, state: normalized };
}

// --- Golden star (issue #33) validation helpers ---

/**
 * A timed buff is only valid with the multiplier/duration its effect and
 * good/bad roll produce. Frenzy good is x7/60s, bad x0.5/30s; Click
 * good is an integer x2-5/20s, bad x0.5/10s; Employee good is x2/60s,
 * bad x0.5/30s. Any other multiplier is a tampered claim.
 */
function starBuffMultiplierValid(effect, multiplier) {
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier)) {
    return false;
  }
  switch (effect) {
    case "frenzy":
      return multiplier === 7 || multiplier === 0.5;
    case "click":
      return (
        multiplier === 0.5 ||
        (Number.isInteger(multiplier) && multiplier >= 2 && multiplier <= 5)
      );
    case "employee":
      return multiplier === 2 || multiplier === 0.5;
    default:
      return false;
  }
}

function starBuffDurationValid(effect, good, durationSeconds) {
  if (!isInt(durationSeconds)) return false;
  const key = good ? "good" : "bad";
  switch (effect) {
    case "frenzy":
      return durationSeconds === STAR_CONFIG.frenzyDurationSeconds[key];
    case "click":
      return durationSeconds === STAR_CONFIG.clickDurationSeconds[key];
    case "employee":
      return durationSeconds === STAR_CONFIG.employeeDurationSeconds[key];
    default:
      return false;
  }
}

/** One activeStarEffects entry (a timed buff in the save state). */
function activeStarEffectError(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return "activeStarEffects entries must be objects";
  }
  if (
    !hasExactKeys(entry, ["effect", "multiplier", "expiresAtMs", "employeeType"])
  ) {
    return "activeStarEffects entries have unknown or missing keys";
  }
  if (!["frenzy", "click", "employee"].includes(entry.effect)) {
    return "activeStarEffects effect must be a timed buff (frenzy, click, employee)";
  }
  if (!starBuffMultiplierValid(entry.effect, entry.multiplier)) {
    return `activeStarEffects multiplier ${entry.multiplier} is not valid for ${entry.effect}`;
  }
  if (typeof entry.expiresAtMs !== "number" || !Number.isFinite(entry.expiresAtMs)) {
    return "activeStarEffects expiresAtMs must be a finite number";
  }
  if (entry.effect === "employee") {
    if (!EMPLOYEE_TYPES.includes(entry.employeeType)) {
      return "activeStarEffects employee buff needs a valid employeeType";
    }
  } else if (entry.employeeType !== null) {
    return "activeStarEffects employeeType must be null for non-employee buffs";
  }
  return null;
}

/** Shape of one starClaims entry. Semantic checks live in validateStarClaims. */
function starClaimShapeError(claim) {
  if (claim === null || typeof claim !== "object" || Array.isArray(claim)) {
    return "starClaims entries must be objects";
  }
  if (
    !hasExactKeys(claim, [
      "effect",
      "good",
      "locDelta",
      "moneyDelta",
      "multiplier",
      "durationSeconds",
      "employeeType",
    ])
  ) {
    return "starClaims entries have unknown or missing keys";
  }
  if (!STAR_EFFECT_IDS.includes(claim.effect)) {
    return `unknown star effect: ${claim.effect}`;
  }
  if (typeof claim.good !== "boolean") {
    return "starClaims good must be a boolean";
  }
  if (!isInt(claim.locDelta) || !isInt(claim.moneyDelta)) {
    return "starClaims locDelta and moneyDelta must be integers";
  }
  const isInstant = claim.effect === "lucky" || claim.effect === "shootingStars";
  if (isInstant) {
    if (claim.multiplier !== null || claim.durationSeconds !== null) {
      return "instant star effects carry no multiplier or duration";
    }
    if (claim.employeeType !== null) {
      return "instant star effects carry no employeeType";
    }
  } else {
    if (typeof claim.multiplier !== "number" || !Number.isFinite(claim.multiplier)) {
      return "timed star effects need a numeric multiplier";
    }
    if (!isInt(claim.durationSeconds)) {
      return "timed star effects need an integer durationSeconds";
    }
    if (claim.effect === "employee") {
      if (!EMPLOYEE_TYPES.includes(claim.employeeType)) {
        return "employee star claims need a valid employeeType";
      }
    } else if (claim.employeeType !== null) {
      return "employeeType must be null for non-employee star claims";
    }
  }
  return null;
}

/**
 * Validate the star claims in one window. Returns an error string, or
 * null when every claim is plausible. Checks, in order:
 * - the effect is unlocked at the Constellation level (max of prev/new,
 *   since a level bought mid-window unlocks stars clicked after it);
 * - instant amounts are within the possible range for the effect at the
 *   player's rate/cash (max of prev/new, the most generous bound, so a
 *   claim made just after a purchase is never false-rejected);
 * - a Lucky roll gives LOC or cash, never both (a claim with both is a
 *   double-dip);
 * - timed buffs carry the exact multiplier/duration for the effect and
 *   good/bad roll;
 * - Shooting Stars is always a good burst (five good Lucky rolls);
 * - the claim count is capped by the spawn rate (see MAX_STAR_WINDOW_SECONDS).
 *
 * Amounts are bounded above only: under-claiming is harmless (it only
 * makes the LOC/money rules stricter), so the lower bound is the max
 * loss for a bad roll, not the min gain. A +1 covers float rounding
 * (the client floors its amounts).
 */
const MAX_STAR_WINDOW_SECONDS = 900; // 15 min: the spawn cap uses the window, capped here. Stars only spawn while the tab is open, and the 60s heartbeat means a longer gap is almost always a closed tab; without the cap an 8h offline window would allow hundreds of claims. 15 min covers a long network outage without opening that hole.

function validateStarClaims(prevState, newState, claims, elapsedSeconds) {
  const prevLevel = prevState.openSourceProjects.constellation ?? 0;
  const newLevel = newState.openSourceProjects.constellation ?? 0;
  const level = Math.max(prevLevel, newLevel);
  if (claims.length > 0 && level === 0) {
    return "star claims without any Constellation level (level 0 = no stars)";
  }
  const unlocked = unlockedStarEffects(level);
  // Most generous bounds: the claim could have happened at either
  // snapshot's rate/cash (e.g. just after a purchase mid-window).
  const maxRate = Math.max(
    locPerSecond(prevState.employees, prevState.openSourceProjects),
    locPerSecond(newState.employees, newState.openSourceProjects)
  );
  const maxMoney = Math.max(prevState.money, newState.money);
  const maxLuckyLoc = STAR_CONFIG.luckyLocMultiplier.good.max * maxRate;
  const maxLuckyLocLoss = STAR_CONFIG.luckyLocMultiplier.bad.max * maxRate;
  const maxLuckyMoney = STAR_CONFIG.luckyMoneyFraction.good.max * maxMoney;
  const maxLuckyMoneyLoss =
    STAR_CONFIG.luckyMoneyFraction.bad.max * maxMoney;

  for (const claim of claims) {
    if (!unlocked.includes(claim.effect)) {
      return `star effect ${claim.effect} is not unlocked at Constellation level ${level}`;
    }
    switch (claim.effect) {
      case "lucky": {
        // One roll gives LOC or cash, never both.
        if (claim.locDelta !== 0 && claim.moneyDelta !== 0) {
          return "lucky star claims give LOC or cash, not both";
        }
        if (claim.good) {
          if (claim.locDelta < 0 || claim.moneyDelta < 0) {
            return "good lucky star claims never lose LOC or money";
          }
          if (claim.locDelta > maxLuckyLoc + 1) {
            return `lucky LOC gain ${claim.locDelta} exceeds the maximum ${maxLuckyLoc.toFixed(1)}`;
          }
          if (claim.moneyDelta > maxLuckyMoney + 1) {
            return `lucky money gain ${claim.moneyDelta} exceeds the maximum ${maxLuckyMoney.toFixed(1)}`;
          }
        } else {
          if (claim.locDelta > 0 || claim.moneyDelta > 0) {
            return "bad lucky star claims never gain LOC or money";
          }
          if (claim.locDelta < -maxLuckyLocLoss - 1) {
            return `lucky LOC loss ${claim.locDelta} exceeds the maximum ${maxLuckyLocLoss.toFixed(1)}`;
          }
          if (claim.moneyDelta < -maxLuckyMoneyLoss - 1) {
            return `lucky money loss ${claim.moneyDelta} exceeds the maximum ${maxLuckyMoneyLoss.toFixed(1)}`;
          }
        }
        break;
      }
      case "shootingStars": {
        // A burst of five good Lucky rolls: always a gain, bounded by 5x Lucky.
        if (!claim.good) {
          return "shooting stars is always a good burst";
        }
        if (claim.locDelta < 0 || claim.moneyDelta < 0) {
          return "shooting stars never loses LOC or money";
        }
        const burst = STAR_CONFIG.shootingStarsCount;
        if (claim.locDelta > burst * maxLuckyLoc + 1) {
          return `shooting stars LOC gain ${claim.locDelta} exceeds the maximum ${(burst * maxLuckyLoc).toFixed(1)}`;
        }
        if (claim.moneyDelta > burst * maxLuckyMoney + 1) {
          return `shooting stars money gain ${claim.moneyDelta} exceeds the maximum ${(burst * maxLuckyMoney).toFixed(1)}`;
        }
        break;
      }
      case "frenzy":
      case "click":
      case "employee": {
        if (claim.locDelta !== 0 || claim.moneyDelta !== 0) {
          return `${claim.effect} star claims give no instant LOC or money`;
        }
        if (!starBuffMultiplierValid(claim.effect, claim.multiplier)) {
          return `${claim.effect} multiplier ${claim.multiplier} is not valid`;
        }
        if (
          !starBuffDurationValid(claim.effect, claim.good, claim.durationSeconds)
        ) {
          return `${claim.effect} duration ${claim.durationSeconds}s is not valid for a ${claim.good ? "good" : "bad"} roll`;
        }
        break;
      }
      default:
        return `unknown star effect: ${claim.effect}`;
    }
  }

  // Spawn cap: at most one star per min interval in the window, plus one
  // for a star spawned just before the window that was clicked inside it.
  // The window is capped at MAX_STAR_WINDOW_SECONDS (see the note above).
  const interval = starSpawnIntervalSeconds(level);
  if (interval) {
    const effectiveSeconds = Math.min(elapsedSeconds, MAX_STAR_WINDOW_SECONDS);
    const maxClaims =
      Math.ceil(effectiveSeconds / interval.min) + 1;
    if (claims.length > maxClaims) {
      return `${claims.length} star claims in ${elapsedSeconds.toFixed(1)}s exceeds the spawn cap of ${maxClaims}`;
    }
  }
  return null;
}

/** Sum of the instant LOC/money deltas across star claims, plus the LOC gains alone. */
function starTotals(claims) {
  let locNet = 0;
  let locGains = 0;
  let moneyNet = 0;
  for (const claim of claims) {
    locNet += claim.locDelta;
    if (claim.locDelta > 0) locGains += claim.locDelta;
    moneyNet += claim.moneyDelta;
  }
  return { locNet, locGains, moneyNet };
}

/**
 * Extra LOC allowance from timed star buffs active in the window.
 * A buff's overlap is how long it was live inside the window:
 * - a buff already active at the window start (in prev.activeStarEffects):
 *   from the window start to its expiry (plus a small clock-skew grace —
 *   the client stamps expiresAtMs from its own clock, which can sit a
 *   few seconds off the server's), capped at the window length and at
 *   the longest any buff can last (60s), so a tampered far-future
 *   expiresAtMs cannot inflate the allowance on a long offline window;
 * - a buff claimed in this window (in starClaims): its full duration,
 *   capped at the window length (it may have started at any point).
 * Buffs of the same (effect, employeeType) never stack in the client
 * (a new one replaces the old), so their overlaps are summed and
 * capped at the window length, and the highest multiplier in the group
 * is used — an upper bound, so the allowance is never below the true
 * gain. A bad buff (multiplier < 1) lowers the allowance, which is
 * correct: the player earned less while it was live.
 *
 * Frenzy and Employee buffs MULTIPLY on the client (the Employee extra
 * is part of the passive rate that Frenzy scales), so the allowance
 * adds their interaction too: (frenzy - 1) x (employee extra rate) x
 * the time both were live, bounded by the shorter of the two overlaps.
 * Without it, a player with both buffs active would false-reject.
 *
 * Returns { passiveExtra, clickExtra } in LOC.
 */
const STAR_CLOCK_SKEW_GRACE_MS = 5000;
/** No timed star buff lasts longer than 60s (Frenzy/Employee good). */
const MAX_STAR_BUFF_SECONDS = 60;

function starBuffAllowance(prev, newState, claims, actions, elapsedSeconds, nowMs) {
  const prevState = prev.state;
  const newRate = locPerSecond(
    newState.employees,
    newState.openSourceProjects
  );
  const newClick = locPerClick(newState.openSourceProjects);
  const passiveBonusValue = passiveBonus(newState.openSourceProjects);

  // Group buff instances by (effect, employeeType). Each group tracks
  // its multipliers and its summed overlap.
  const groups = new Map();
  const addToGroup = (effect, employeeType, multiplier, overlapSeconds) => {
    if (overlapSeconds <= 0) return;
    const key = `${effect}:${employeeType ?? ""}`;
    const group = groups.get(key) ?? {
      effect,
      employeeType,
      multipliers: [],
      overlapSeconds: 0,
    };
    group.multipliers.push(multiplier);
    group.overlapSeconds += overlapSeconds;
    groups.set(key, group);
  };

  // Buffs already active at the window start. The overlap is capped at
  // the longest any buff can last (60s), so a tampered far-future
  // expiresAtMs cannot inflate the allowance on a long offline window.
  for (const buff of prevState.activeStarEffects ?? []) {
    const overlapSeconds = Math.min(
      Math.max(
        0,
        (Math.min(buff.expiresAtMs + STAR_CLOCK_SKEW_GRACE_MS, nowMs) -
          prev.savedAtMs) /
          1000
      ),
      elapsedSeconds,
      MAX_STAR_BUFF_SECONDS
    );
    addToGroup(buff.effect, buff.employeeType, buff.multiplier, overlapSeconds);
  }

  // Buffs claimed in this window.
  for (const claim of claims) {
    if (
      claim.effect !== "frenzy" &&
      claim.effect !== "click" &&
      claim.effect !== "employee"
    ) {
      continue;
    }
    const overlapSeconds = Math.min(claim.durationSeconds, elapsedSeconds);
    addToGroup(
      claim.effect,
      claim.employeeType,
      claim.multiplier,
      overlapSeconds
    );
  }

  // Frenzy (one group at most — it has no employeeType).
  const frenzyGroup = groups.get("frenzy:");
  const frenzyOverlap = frenzyGroup
    ? Math.min(frenzyGroup.overlapSeconds, elapsedSeconds)
    : 0;
  const frenzyMultiplier = frenzyGroup
    ? Math.max(...frenzyGroup.multipliers)
    : 1;

  // Employee buffs, one group per type.
  const employeeGroups = [...groups.values()].filter(
    (group) => group.effect === "employee"
  );
  let employeeExtraRate = 0;
  let employeeExtra = 0;
  let maxEmployeeOverlap = 0;
  for (const group of employeeGroups) {
    const overlapSeconds = Math.min(group.overlapSeconds, elapsedSeconds);
    const multiplier = Math.max(...group.multipliers);
    const typeRate =
      BALANCE.employees[group.employeeType].locPerSecond *
      (newState.employees[group.employeeType] ?? 0) *
      (1 + passiveBonusValue);
    employeeExtraRate += (multiplier - 1) * typeRate;
    employeeExtra += (multiplier - 1) * typeRate * overlapSeconds;
    maxEmployeeOverlap = Math.max(maxEmployeeOverlap, overlapSeconds);
  }

  // Passive extra: Frenzy on the base rate, Employee on its type's
  // rate, plus the Frenzy x Employee interaction (Frenzy scales the
  // Employee extra too) for the time both were live.
  let passiveExtra = (frenzyMultiplier - 1) * newRate * frenzyOverlap;
  passiveExtra += employeeExtra;
  if (frenzyOverlap > 0 && maxEmployeeOverlap > 0) {
    passiveExtra +=
      (frenzyMultiplier - 1) *
      employeeExtraRate *
      Math.min(frenzyOverlap, maxEmployeeOverlap);
  }

  // Click extra: the Click buff scales clicks made while it was live.
  // Clicks that could have happened then are the click-rate cap over
  // the buff's overlap, plus the grace, and no more than the clicks
  // actually claimed in the window.
  let clickExtra = 0;
  const clickGroup = groups.get("click:");
  if (clickGroup) {
    const overlapSeconds = Math.min(clickGroup.overlapSeconds, elapsedSeconds);
    const multiplier = Math.max(...clickGroup.multipliers);
    const maxClicksDuringBuff =
      Math.floor(MAX_CLICKS_PER_SECOND * overlapSeconds) + CLICK_GRACE;
    const clicksDuringBuff = Math.min(actions.clicks, maxClicksDuringBuff);
    clickExtra = (multiplier - 1) * clicksDuringBuff * newClick;
  }

  return { passiveExtra, clickExtra };
}

/**
 * Validate one save attempt against the last accepted snapshot.
 * Returns `{ ok: true }` or `{ ok: false, rule, detail }`.
 */
export function validateSave(prev, body, nowMs) {
  // Star-era fields are backward-compatible: default them on states and
  // actions that predate Constellation, so old saves keep validating.
  // normalizeSaveState / normalizeStarActions return non-objects
  // unchanged, so a malformed body still fails the shape check below.
  const normalizedPrev = {
    ...(prev ?? {}),
    state: normalizeSaveState(prev?.state),
  };
  const normalizedBody = {
    ...(body ?? {}),
    state: normalizeSaveState(body?.state),
    actionsSinceLastSave: normalizeStarActions(body?.actionsSinceLastSave),
  };
  const shapeError = checkShape(normalizedBody);
  if (shapeError) return fail("SHAPE", shapeError);

  const prevState = normalizedPrev.state;
  const newState = normalizedBody.state;
  const actions = normalizedBody.actionsSinceLastSave;

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

  // Star claims (issue #33): validate plausibility and accounting
  // bounds before they are credited in the LOC/money rules below.
  // A failed claim is a STAR rejection (409 with the last good state).
  const starClaims = actions.starClaims ?? [];
  const starError = validateStarClaims(
    prevState,
    newState,
    starClaims,
    elapsedSeconds
  );
  if (starError) return fail("STAR", starError);
  const {
    locNet: starLocNet,
    locGains: starLocGains,
    moneyNet: starMoneyNet,
  } = starTotals(starClaims);
  const {
    passiveExtra: starPassiveExtra,
    clickExtra: starClickExtra,
  } = starBuffAllowance(
    normalizedPrev,
    newState,
    starClaims,
    actions,
    elapsedSeconds,
    nowMs
  );

  // Max earnable LOC in the window, credited at the NEW snapshot's rates
  // (see the deviation note at the top of this file). Star buffs add
  // their allowance on top of the base passive/click credit, and instant
  // star gains are credited to the max earnable (losses debit it).
  const maxPassive =
    locPerSecond(newState.employees, newState.openSourceProjects) *
      passiveSeconds +
    starPassiveExtra;
  const maxClickLoc =
    actions.clicks * locPerClick(newState.openSourceProjects) +
    starClickExtra;

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

  // Rule 6 — LOC accounting. The tolerance covers the discrete-tick
  // error: the client earns passive LOC in whole 1-second GAME_TICKs,
  // but the server credits it continuously by elapsed wall-clock
  // seconds. In a window of W seconds the client can fire up to
  // ceil(W) ticks while the server credits W seconds, so legitimate
  // play can hold up to one full tick of passive LOC beyond the
  // continuous credit. That excess is (ceil(W) - W) * locPerSecond,
  // which approaches one tick as W approaches an integer from below.
  // The old tolerance (1% of expectedLoc, min 10) collapsed to the
  // 10 LOC floor exactly when a player ships heavily — shipping
  // spends LOC, driving expectedLoc toward 0 — while the tick excess
  // stays up to one tick (the player's LOC/sec, e.g. 150). The save
  // was then falsely 409'd. The tolerance is therefore at least one
  // tick of passive LOC at the new snapshot's rate, which is both
  // necessary and sufficient: the legitimate excess is bounded above
  // by one tick, and the 1% term still covers fractional rounding.
  const expectedLoc =
    prevState.linesOfCode +
    maxPassive +
    maxClickLoc +
    starLocNet -
    projectLocCost -
    openSourceLocCost;
  const oneTickLoc = locPerSecond(
    newState.employees,
    newState.openSourceProjects
  );
  const tolerance = Math.max(
    10,
    0.01 * Math.max(expectedLoc, 0),
    oneTickLoc
  );
  if (newState.linesOfCode > expectedLoc + tolerance) {
    return fail(
      "LOC",
      `linesOfCode ${newState.linesOfCode} exceeds the maximum earnable ${expectedLoc.toFixed(1)} (+${tolerance.toFixed(1)} tolerance)`
    );
  }
  const totalGained = newState.totalLinesOfCode - prevState.totalLinesOfCode;
  // totalLinesOfCode only ever grows from gains, so only the positive
  // star LOC counts here (a Lucky loss lowers linesOfCode, not the total).
  if (totalGained > maxPassive + maxClickLoc + starLocGains + tolerance) {
    return fail(
      "LOC",
      `totalLinesOfCode gained ${totalGained.toFixed(1)} exceeds the maximum earnable ${(maxPassive + maxClickLoc + starLocGains).toFixed(1)} (+${tolerance.toFixed(1)} tolerance)`
    );
  }
  if (newState.totalLinesOfCode < newState.linesOfCode) {
    return fail("LOC", "totalLinesOfCode is less than linesOfCode");
  }

  // Rule 7 — money accounting, exact, no tolerance. Money only moves via
  // completed projects (in), employee hires (out), and instant star
  // rewards (in or out, netted in starMoneyNet), in purchase order.
  let expectedMoney = prevState.money + starMoneyNet;
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
