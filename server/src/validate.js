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
 * 3. GOLDEN STARS (issue #33, server-rolled in issue #29) are decided
 *    by the SERVER, not the client. The client asks the server for a
 *    star outcome (POST /api/star/claim); the server rolls the effect,
 *    good/bad, and reward from the player's stored state, records the
 *    issued outcome (with a claimId) in `star_issues`, and returns it.
 *    The client applies exactly that claim and reports it in
 *    `actionsSinceLastSave.starClaims`. The server validates each claim
 *    against the issued outcomes (see `matchIssuedStarClaims`): the
 *    claimId must match an unconsumed issued outcome and the content
 *    must be identical — a forged or inflated claim has no issued row
 *    and is rejected. The server also rolls the next spawn time and
 *    tells the client, so the client never picks its own spawn time.
 *    The LOC and money rules then credit the claimed star gains (and
 *    debit the claimed losses) and add the buff allowance to the max
 *    earnable, so a legitimate star reward never false-rejects. A
 *    hacked client can no longer claim the maximum reward on every
 *    spawn: it can only claim what the server actually issued, once.
 *    The claim shape carries a claimId (a UUID); a claim without one
 *    is malformed (an old client bundle that predates the server roll
 *    will 400 on a star claim until it reloads — the save itself is
 *    not lost, and the next heartbeat retries with fresh state).
 *
 * 4. COSMETICS (issue #11) extend Rule 3 (unlocks are real): a
 *    cosmetic NEWLY claimed in a save must have its hire-count
 *    trigger met by the new snapshot itself, and an equipped cosmetic
 *    must be unlocked and belong to the slot it is equipped in. A
 *    cosmetic already unlocked in the previous save is grandfathered
 *    (the trigger rose from 10 to 25 hires; an earned cosmetic is
 *    never revoked). The unlocked list only grows (Rule 2); the
 *    equipped map switches freely. Failures are the COSMETIC rule
 *    (409).
 *
 * Star-era fields are backward-compatible: a save (or client) from
 * before Constellation shipped lacks `constellation` in the
 * open-source maps, `activeStarEffects` on the state, and `starClaims`
 * in the actions. Those are defaulted (constellation 0 / unlocked,
 * no active buffs, no claims) by `normalizeSaveState` /
 * `normalizeStarActions` before any check runs, so old saves keep
 * validating. Only the new fields are defaulted — a missing old
 * field is still a shape error. The same applies to the later
 * fields: `unlockedFreelanceProjects` (issue #19) is derived from
 * the shipped counts, and `unlockedCosmetics` / `equippedCosmetics`
 * (issue #11) are derived / defaulted the same way.
 *
 * Pure function: no I/O, no clock of its own. `prev` is the last accepted
 * snapshot `{ state, savedAtMs }`; for a brand-new player the store passes
 * the initial state with savedAtMs = player creation time. `nowMs` is the
 * server time of the save attempt.
 */

import {
  BALANCE,
  COSMETIC_SLOTS,
  EMAIL_CONFIG,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  STAR_CONFIG,
  STAR_EFFECT_IDS,
  baseLocPerSecond,
  canEquipCosmetic,
  cosmeticTriggerMet,
  employeeBuffTypeRate,
  employeePurchaseCosts,
  employeeUnlockConditionsMet,
  findCosmetic,
  freelanceProjectUnlockConditionsMet,
  locPerClick,
  locPerSecond,
  normalizeSaveState,
  normalizeStarActions,
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
      "unlockedFreelanceProjects",
      "activeStarEffects",
      "emails",
      "unlockedCosmetics",
      "equippedCosmetics",
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
  // In-game inbox (issue #31). The client caps the inbox at
  // EMAIL_CONFIG.maxInboxEmails and deletes the oldest past it, so a
  // save with more is malformed/tampered and fails the shape check
  // (400) rather than being silently trimmed — trimming here would
  // drop mail the client still shows, and the next save would just
  // fail again. Each entry is a plain record; the server never
  // interprets trigger keys or content, it only bounds them.
  if (!Array.isArray(state.emails)) {
    return "emails must be an array";
  }
  if (state.emails.length > EMAIL_CONFIG.maxInboxEmails) {
    return `emails exceeds the ${EMAIL_CONFIG.maxInboxEmails} inbox cap`;
  }
  const seenEmailIds = new Set();
  for (const entry of state.emails) {
    const entryError = emailEntryError(entry);
    if (entryError) return entryError;
    if (seenEmailIds.has(entry.id)) {
      return "emails must have unique ids";
    }
    seenEmailIds.add(entry.id);
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
  if (
    !hasExactKeys(state.unlockedFreelanceProjects, FREELANCE_PROJECT_KEYS) ||
    !FREELANCE_PROJECT_KEYS.every(
      (key) => typeof state.unlockedFreelanceProjects[key] === "boolean"
    )
  ) {
    return "unlockedFreelanceProjects must be booleans";
  }
  // Cosmetics (issue #11). The unlocked list holds known cosmetic
  // ids only, no duplicates; the equipped map holds known slots
  // (a subset is fine — only equipped slots are present) mapping to
  // known cosmetic ids. Whether an unlocked cosmetic's trigger is
  // met, and whether an equipped cosmetic is unlocked and in the
  // right slot, is the COSMETIC rule in validateSave, not the shape.
  if (!Array.isArray(state.unlockedCosmetics)) {
    return "unlockedCosmetics must be an array";
  }
  const seenCosmetics = new Set();
  for (const cosmeticId of state.unlockedCosmetics) {
    if (typeof cosmeticId !== "string" || !findCosmetic(cosmeticId)) {
      return `unlockedCosmetics has an unknown cosmetic id: ${cosmeticId}`;
    }
    if (seenCosmetics.has(cosmeticId)) {
      return "unlockedCosmetics must not contain duplicates";
    }
    seenCosmetics.add(cosmeticId);
  }
  if (
    state.equippedCosmetics === null ||
    typeof state.equippedCosmetics !== "object" ||
    Array.isArray(state.equippedCosmetics)
  ) {
    return "equippedCosmetics must be an object";
  }
  for (const [slot, cosmeticId] of Object.entries(state.equippedCosmetics)) {
    if (!COSMETIC_SLOTS.includes(slot)) {
      return `equippedCosmetics has an unknown slot: ${slot}`;
    }
    if (typeof cosmeticId !== "string" || !findCosmetic(cosmeticId)) {
      return `equippedCosmetics has an unknown cosmetic id: ${cosmeticId}`;
    }
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
 * good/bad roll produce. Frenzy good is an integer x2-5/60s, bad x0.5/30s;
 * Click good is an integer x2-5/20s, bad x0.5/10s; Employee good is an
 * integer x3-15/60s, bad x0.5/30s. Any other multiplier is a tampered claim.
 * (Frenzy's range is lower than Employee's because it buffs everything;
 * Employee's is higher because it buffs a single type — Brandon, Nov 10.)
 */
function starBuffMultiplierValid(effect, multiplier) {
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier)) {
    return false;
  }
  switch (effect) {
    case "frenzy":
      return (
        multiplier === 0.5 ||
        (Number.isInteger(multiplier) && multiplier >= 2 && multiplier <= 5)
      );
    case "click":
      return (
        multiplier === 0.5 ||
        (Number.isInteger(multiplier) && multiplier >= 2 && multiplier <= 5)
      );
    case "employee":
      return (
        multiplier === 0.5 ||
        (Number.isInteger(multiplier) && multiplier >= 3 && multiplier <= 15)
      );
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

/** One inbox entry (issue #31). Plain record, bounded strings. */
function emailEntryError(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return "emails entries must be objects";
  }
  if (
    !hasExactKeys(entry, [
      "id",
      "triggerKey",
      "sender",
      "subject",
      "body",
      "createdAtMs",
      "read",
    ])
  ) {
    return "emails entries have unknown or missing keys";
  }
  if (typeof entry.id !== "string" || !UUID_RE.test(entry.id)) {
    return "emails id must be a UUID string";
  }
  if (
    typeof entry.triggerKey !== "string" ||
    entry.triggerKey.length < 1 ||
    entry.triggerKey.length > EMAIL_CONFIG.maxTriggerKeyLength
  ) {
    return "emails triggerKey must be a non-empty string within its length cap";
  }
  const stringFieldError = (value, max, field) =>
    typeof value !== "string" || value.length < 1 || value.length > max
      ? `emails ${field} must be a non-empty string within its length cap`
      : null;
  return (
    stringFieldError(entry.sender, EMAIL_CONFIG.maxSenderLength, "sender") ??
    stringFieldError(entry.subject, EMAIL_CONFIG.maxSubjectLength, "subject") ??
    stringFieldError(entry.body, EMAIL_CONFIG.maxBodyLength, "body") ??
    (!isInt(entry.createdAtMs) || entry.createdAtMs < 0
      ? "emails createdAtMs must be a non-negative integer"
      : null) ??
    (typeof entry.read !== "boolean"
      ? "emails read must be a boolean"
      : null)
  );
}

/** Shape of one starClaims entry. Semantic checks live in matchIssuedStarClaims. */
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
      "claimId",
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
  // The claimId ties the claim to the server-issued outcome (issue
  // #29). Without it the server cannot tell a real claim from a
  // forged one, so a missing or malformed claimId is a shape error.
  if (typeof claim.claimId !== "string" || !UUID_RE.test(claim.claimId)) {
    return "starClaims claimId must be a UUID string";
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
 * Whether two star claims are the same outcome: the effect, good/bad
 * roll, instant deltas, and (for timed buffs) multiplier, duration,
 * and employee type must all match. The claimId is compared by the
 * caller, not here.
 */
function sameStarClaim(a, b) {
  return (
    a.effect === b.effect &&
    a.good === b.good &&
    a.locDelta === b.locDelta &&
    a.moneyDelta === b.moneyDelta &&
    a.multiplier === b.multiplier &&
    a.durationSeconds === b.durationSeconds &&
    a.employeeType === b.employeeType
  );
}

/**
 * Match a save's star claims against the server-issued outcomes
 * (issue #29). `issued` is the player's unconsumed issued outcomes
 * (each carrying its claimId), as the store read them. Returns
 * `{ ok: true, claimIds }` (the issued claimIds this save consumes),
 * or `{ ok: false, detail }` when a claim has no matching issued
 * outcome. Each claim must match exactly one distinct issued outcome
 * — same claimId and identical content — so a forged, inflated, or
 * replayed claim (an already-consumed outcome) is rejected. The
 * issued outcome is, by construction, an effect the server rolled
 * from the unlocked pool with in-range amounts and the exact
 * multiplier/duration, so matching it implies all of those checks;
 * there is no separate plausibility pass anymore. The spawn cap is
 * enforced at issuance (the server only issues a star when one is
 * due), not here.
 *
 * An issued outcome EXPIRES 30s after it was issued (the star's
 * lifetime, star fix slice): a claim for an outcome older than that is
 * rejected even if it matches exactly and is unconsumed, so a stale
 * outcome cannot be claimed late by a tampered client. The store
 * attaches `issuedAtMs` to each issued entry (from
 * star_issues.issued_at); entries without one — synthetic test data
 * that does not model issue time — skip the expiry check. `nowMs` is
 * the save time; when it is null the expiry check is skipped too.
 */
export function matchIssuedStarClaims(claims, issued, nowMs = null) {
  const unused = [...issued];
  const claimIds = [];
  for (const claim of claims) {
    const index = unused.findIndex(
      (issuedClaim) =>
        issuedClaim.claimId === claim.claimId &&
        sameStarClaim(issuedClaim, claim)
    );
    if (index === -1) {
      return {
        ok: false,
        detail: `star claim ${claim.claimId} does not match a server-issued outcome`,
      };
    }
    const issuedClaim = unused[index];
    if (
      nowMs !== null &&
      typeof issuedClaim.issuedAtMs === "number" &&
      nowMs >
        issuedClaim.issuedAtMs +
          STAR_CONFIG.starLifetimeSeconds * 1000 +
          STAR_CLOCK_SKEW_GRACE_MS
    ) {
      return {
        ok: false,
        detail: `star claim ${claim.claimId} expired: an issued outcome is only valid for ${STAR_CONFIG.starLifetimeSeconds}s after issue`,
      };
    }
    claimIds.push(unused[index].claimId);
    unused.splice(index, 1);
  }
  return { ok: true, claimIds };
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
  // The base click value, with the Commit Specialist bonus at 1x
  // (no Sprint). The final total is floored (Brandon: a click must
  // never commit a fractional amount), so this is the whole-number
  // click value the client credits for clicks outside any buff.
  const newClick = locPerClick(
    newState.openSourceProjects,
    newState.employees
  );

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
    // The type's contribution to the passive rate, from the one shared
    // helper the client uses too. A Project Manager's contribution is
    // the boost itself (the rate the Sprint scales); a Commit
    // Specialist contributes nothing to passive LOC, so a Sprint on
    // them scales nothing here — their bonus lives on clicks.
    const typeRate = employeeBuffTypeRate(
      group.employeeType,
      newState.employees,
      newState.openSourceProjects
    );
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
  let clicksDuringClickBuff = 0;
  if (clickGroup) {
    const overlapSeconds = Math.min(clickGroup.overlapSeconds, elapsedSeconds);
    const multiplier = Math.max(...clickGroup.multipliers);
    const maxClicksDuringBuff =
      Math.floor(MAX_CLICKS_PER_SECOND * overlapSeconds) + CLICK_GRACE;
    const clicksDuringBuff = Math.min(actions.clicks, maxClicksDuringBuff);
    clicksDuringClickBuff = clicksDuringBuff;
    clickExtra = (multiplier - 1) * clicksDuringBuff * newClick;
  }

  // Commit Specialist Sprint extra: a Sprint on Commit Specialists
  // multiplies their per-click bonus, so clicks made while it was live
  // earn more than the 1x base click above. The per-click extra is the
  // difference of the two floored click totals (with the Sprint and at
  // 1x) — that is exactly what the client credits per click, since the
  // base is an integer and the floor lives on the final total. Only a
  // positive delta is added: a Meeting (0.5x) makes clicks earn LESS
  // than the base credit, which the base credit already covers, and
  // subtracting for it could under-credit clicks made outside the
  // Meeting. The Click x Commit Specialist interaction (a Click buff
  // multiplying Sprint-boosted clicks) is the same delta times the
  // Click buff's uplift, over the clicks that could have been during
  // both buffs — an upper bound, like the Frenzy x Employee
  // interaction above.
  const csSprintGroup = groups.get("employee:commitSpecialist");
  if (csSprintGroup) {
    const overlapSeconds = Math.min(
      csSprintGroup.overlapSeconds,
      elapsedSeconds
    );
    const multiplier = Math.max(...csSprintGroup.multipliers);
    const csBonusDelta =
      locPerClick(
        newState.openSourceProjects,
        newState.employees,
        multiplier
      ) - newClick;
    if (csBonusDelta > 0) {
      const maxClicksDuringBuff =
        Math.floor(MAX_CLICKS_PER_SECOND * overlapSeconds) + CLICK_GRACE;
      const clicksDuringBuff = Math.min(actions.clicks, maxClicksDuringBuff);
      clickExtra += csBonusDelta * clicksDuringBuff;
      if (clickGroup) {
        const clickMultiplier = Math.max(...clickGroup.multipliers);
        clickExtra +=
          (clickMultiplier - 1) *
          csBonusDelta *
          Math.min(clicksDuringClickBuff, clicksDuringBuff);
      }
    }
  }

  return { passiveExtra, clickExtra };
}

/**
 * Validate one save attempt against the last accepted snapshot.
 * Returns `{ ok: true }` or `{ ok: false, rule, detail }`.
 * `issuedStarClaims` is the player's unconsumed server-issued star
 * outcomes (issue #29); a save's star claims must match them exactly.
 * Defaults to [] (no issued outcomes — any star claim is rejected).
 */
export function validateSave(prev, body, nowMs, issuedStarClaims = []) {
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
  for (const key of FREELANCE_PROJECT_KEYS) {
    if (
      prevState.unlockedFreelanceProjects[key] &&
      !newState.unlockedFreelanceProjects[key]
    ) {
      return fail(
        "MONOTONIC",
        `freelance unlock latch flipped back: ${key}`
      );
    }
  }
  // Cosmetics (issue #11): the unlocked list only grows — an earned
  // cosmetic is never lost. Equipped cosmetics switch freely, so
  // there is no monotonic constraint on the equipped map.
  for (const cosmeticId of prevState.unlockedCosmetics ?? []) {
    if (!(newState.unlockedCosmetics ?? []).includes(cosmeticId)) {
      return fail("MONOTONIC", `cosmetic unlock lost: ${cosmeticId}`);
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
    // A level claimed without meeting the unlock condition is rejected
    // too (star fix slice): the latch alone does not gate a level —
    // a save could claim Constellation level 1 with the latch false —
    // so the level itself must satisfy the conditions. This is what
    // enforces the Constellation TOTAL_LOC >= 500 unlock on the level
    // a save claims, not just on the latch it carries. It applies to
    // every open-source project (same loop); OverReact has no
    // conditions, and Blocker's 5-junior condition is met by any
    // legitimate owner.
    if (
      newState.openSourceProjects[projectId] > 0 &&
      !openSourceUnlockConditionsMet(projectId, newState)
    ) {
      return fail(
        "UNLOCK",
        `open-source level claimed without meeting unlock conditions: ${projectId}`
      );
    }
  }
  for (const key of FREELANCE_PROJECT_KEYS) {
    if (
      newState.unlockedFreelanceProjects[key] &&
      !freelanceProjectUnlockConditionsMet(key, newState)
    ) {
      return fail(
        "UNLOCK",
        `freelance unlock claimed without meeting conditions: ${key}`
      );
    }
  }

  // Rule 3, cosmetics (issue #11) — unlocks and equips are real:
  // every cosmetic NEWLY claimed in this save must have its
  // hire-count trigger met by the new snapshot itself, and every
  // equipped cosmetic must be unlocked and belong to the slot it is
  // equipped in. A cosmetic already unlocked in the previous save is
  // grandfathered: the trigger rose under it (10 -> 25 hires), and
  // the MONOTONIC rule above already guarantees the unlocked list
  // only grows, so an earned cosmetic is never revoked or rejected
  // for a threshold it met when it was earned. A failure here is a
  // COSMETIC rejection (409 with the last good state).
  for (const cosmeticId of newState.unlockedCosmetics ?? []) {
    if ((prevState.unlockedCosmetics ?? []).includes(cosmeticId)) {
      continue;
    }
    if (!cosmeticTriggerMet(cosmeticId, newState)) {
      return fail(
        "COSMETIC",
        `cosmetic unlock claimed without meeting its trigger: ${cosmeticId}`
      );
    }
  }
  for (const [slot, cosmeticId] of Object.entries(
    newState.equippedCosmetics ?? {}
  )) {
    if (
      !canEquipCosmetic(slot, cosmeticId, newState.unlockedCosmetics ?? [])
    ) {
      return fail(
        "COSMETIC",
        `cosmetic ${cosmeticId} cannot be equipped in ${slot}`
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

  // Star claims (issue #29): each claim must match a server-issued,
  // unconsumed outcome exactly, before the claimed gains are credited
  // in the LOC/money rules below. A failed claim is a STAR rejection
  // (409 with the last good state).
  const starClaims = actions.starClaims ?? [];
  const starMatch = matchIssuedStarClaims(starClaims, issuedStarClaims, nowMs);
  if (!starMatch.ok) return fail("STAR", starMatch.detail);
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
    actions.clicks *
      locPerClick(newState.openSourceProjects, newState.employees) +
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
