/**
 * Get Rich Quick GIT — server-side save validation.
 *
 * The leaderboard is gone (killed Nov 11, 2026 — it made saves a pain
 * and cheaters would top it anyway), so the server no longer polices
 * how progress was earned. A save is accepted when it is well-formed
 * and internally consistent:
 *
 * - SHAPE: only known keys, right types, no negatives, levels within
 *   each project's max, star/email/cosmetic/farm entries well-formed.
 *   A shape failure is a 400.
 * - RATE_LIMIT: at most one accepted save per second per player.
 *   Flood control only. A rate-limited save is a 429 and the client
 *   keeps its actions and retries — it must NOT discard local state.
 * - MONOTONIC: counts and totals never decrease, latches only flip
 *   false -> true. A stale or corrupted save can never roll progress
 *   backwards; a rejection here is a 409 with the last good state.
 * - CONSISTENCY: an equipped cosmetic must be unlocked and in the
 *   right slot; Release Manager assignments cannot exceed managers
 *   owned and auto-ships are a subset of completions for unlocked
 *   projects; a claimed star outcome or farm breed must match a
 *   server-issued, unconsumed outcome (replay protection for the
 *   server-rolled star/breed systems, not leaderboard policing).
 *
 * Everything else the old validator computed — the LOC cap, the exact
 * money accounting, the click cap, the action deltas, the unlock
 * recomputation, the cosmetic triggers, the farm purchase/plausibility
 * checks, the auto-ship rate cap — is gone. The client is trusted with
 * its own numbers now; the server stores what it sends.
 *
 * Deliberate deviations, documented here and in the PR:
 *
 * 1. SHAPE failures are 400 and RATE_LIMIT is 429, not 409. A malformed
 *    body is a bad request, and a rate-limited save must NOT make the
 *    client discard its local state (the 409 path does that) — it should
 *    keep its actions and retry on the next heartbeat. `validateSave`
 *    returns the rule; the HTTP layer maps SHAPE -> 400, RATE_LIMIT -> 429,
 *    everything else -> 409.
 *
 * 2. GOLDEN STARS (issue #33, server-rolled in issue #29) are decided
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
 * 3. COSMETICS (issue #11): the server no longer checks whether a
 *    newly claimed cosmetic's hire-count trigger is met — how a
 *    cosmetic was earned is not policed anymore. What survives is the
 *    equip check in validateSave: an equipped cosmetic must be
 *    unlocked and belong to the slot it is equipped in. The unlocked
 *    list only grows (the MONOTONIC rule), so an earned cosmetic is
 *    never revoked. Failures are the COSMETIC rule (409).
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
  FARM_CONFIG,
  FARM_LIGHTING_COLORS,
  FREELANCE_PROJECT_KEYS,
  LLAMA_TYPES,
  OPEN_SOURCE_IDS,
  STAR_CONFIG,
  STAR_EFFECT_IDS,
  canEquipCosmetic,
  findCosmetic,
  normalizeSaveState,
  normalizeStarActions,
  releaseManagerAssignedCount,
} from "../../shared/game-balance.js";

/** At most one accepted save per 1 second per player (flood control only). */
export const SAVE_RATE_LIMIT_SECONDS = 1;

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
      "releaseManagerAssignments",
      "autoShipsCompleted",
      "openSourceProjects",
      "unlockedEmployees",
      "unlockedOpenSourceProjects",
      "unlockedFreelanceProjects",
      "activeStarEffects",
      "emails",
      "unlockedCosmetics",
      "equippedCosmetics",
      "farm",
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
  // Release Manager (auto-ships): the per-project assignment counts
  // and the cumulative auto-ship counts. Both are count maps over the
  // freelance keys; the assignment sum bound (<= owned managers) lives
  // in validateSave, not the shape.
  if (
    !isCountMap(state.releaseManagerAssignments, FREELANCE_PROJECT_KEYS)
  ) {
    return "releaseManagerAssignments must be non-negative integer counts";
  }
  if (!isCountMap(state.autoShipsCompleted, FREELANCE_PROJECT_KEYS)) {
    return "autoShipsCompleted must be non-negative integer counts";
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
  // Llama farm (issue #79). The farm is one object: owned (boolean),
  // stalls (exactly FARM_CONFIG.stallCount entries, each { llama,
  // lighting } with a llama that is null or a known type id and a
  // lighting that is a known color), and unlockedTypes (known type ids
  // only, no duplicates). Whether a claimed kid matches a
  // server-issued breed outcome is the FARM rule in validateSave, not
  // the shape; how a llama was bought or bred is not policed anymore.
  if (
    state.farm === null ||
    typeof state.farm !== "object" ||
    Array.isArray(state.farm) ||
    !hasExactKeys(state.farm, ["owned", "stalls", "unlockedTypes"])
  ) {
    return "farm must be an object with owned, stalls, and unlockedTypes";
  }
  if (typeof state.farm.owned !== "boolean") {
    return "farm.owned must be a boolean";
  }
  if (
    !Array.isArray(state.farm.stalls) ||
    state.farm.stalls.length !== FARM_CONFIG.stallCount
  ) {
    return `farm.stalls must be an array of ${FARM_CONFIG.stallCount} stalls`;
  }
  for (const stall of state.farm.stalls) {
    if (
      stall === null ||
      typeof stall !== "object" ||
      Array.isArray(stall) ||
      !hasExactKeys(stall, ["llama", "lighting"])
    ) {
      return "farm stalls must be objects with llama and lighting";
    }
    if (stall.llama !== null && !LLAMA_TYPES.includes(stall.llama)) {
      return `farm stall has an unknown llama type: ${stall.llama}`;
    }
    if (!FARM_LIGHTING_COLORS.includes(stall.lighting)) {
      return `farm stall has an unknown lighting color: ${stall.lighting}`;
    }
  }
  if (!Array.isArray(state.farm.unlockedTypes)) {
    return "farm.unlockedTypes must be an array";
  }
  const seenLlamaTypes = new Set();
  for (const type of state.farm.unlockedTypes) {
    if (typeof type !== "string" || !LLAMA_TYPES.includes(type)) {
      return `farm.unlockedTypes has an unknown llama type: ${type}`;
    }
    if (seenLlamaTypes.has(type)) {
      return "farm.unlockedTypes must not contain duplicates";
    }
    seenLlamaTypes.add(type);
  }
  if (!state.farm.owned) {
    // An unbought farm has no llamas and no types: a save that claims
    // llamas without owning the farm is malformed.
    if (state.farm.stalls.some((stall) => stall.llama !== null)) {
      return "farm has llamas but is not owned";
    }
    if (state.farm.unlockedTypes.length > 0) {
      return "farm has unlocked types but is not owned";
    }
  } else {
    // Every llama in the barn must be in the unlocked list — a type
    // the player has not discovered cannot be sitting in a stall.
    for (const stall of state.farm.stalls) {
      if (
        stall.llama !== null &&
        !state.farm.unlockedTypes.includes(stall.llama)
      ) {
        return `farm stall holds a llama type that is not unlocked: ${stall.llama}`;
      }
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
      "autoShips",
      "openSourceLevelsBought",
      "starClaims",
      "farmBreedClaims",
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
  // Release Manager auto-ships this window, per project. A subset of
  // projectsCompleted (the auto-shipped ones); the subset check lives in
  // validateSave, not the shape.
  if (!isCountMap(actions.autoShips, FREELANCE_PROJECT_KEYS)) {
    return "actions.autoShips must be non-negative integer counts";
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
  if (!Array.isArray(actions.farmBreedClaims)) {
    return "actions.farmBreedClaims must be an array";
  }
  for (const claim of actions.farmBreedClaims) {
    const claimError = farmBreedClaimShapeError(claim);
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
 * Shape of one farmBreedClaims entry. Semantic checks live in
 * matchIssuedFarmBreeds. A claim is one server-rolled breeding tick:
 * the breedId that ties it to the issued outcome, and the kids the
 * client actually applied (each a stall index + a llama type).
 */
function farmBreedClaimShapeError(claim) {
  if (claim === null || typeof claim !== "object" || Array.isArray(claim)) {
    return "farmBreedClaims entries must be objects";
  }
  if (!hasExactKeys(claim, ["breedId", "kids"])) {
    return "farmBreedClaims entries have unknown or missing keys";
  }
  // The breedId ties the claim to the server-issued outcome (issue
  // #79 feedback). Without it the server cannot tell a real breed
  // from a forged one, so a missing or malformed breedId is a shape
  // error.
  if (typeof claim.breedId !== "string" || !UUID_RE.test(claim.breedId)) {
    return "farmBreedClaims breedId must be a UUID string";
  }
  if (!Array.isArray(claim.kids)) {
    return "farmBreedClaims kids must be an array";
  }
  for (const kid of claim.kids) {
    if (kid === null || typeof kid !== "object" || Array.isArray(kid)) {
      return "farmBreedClaims kids must be objects";
    }
    if (!hasExactKeys(kid, ["stallIndex", "type"])) {
      return "farmBreedClaims kids have unknown or missing keys";
    }
    if (
      !isInt(kid.stallIndex) ||
      kid.stallIndex < 0 ||
      kid.stallIndex >= FARM_CONFIG.stallCount
    ) {
      return "farmBreedClaims kid stallIndex must be a stall index";
    }
    if (!LLAMA_TYPES.includes(kid.type)) {
      return `farmBreedClaims kid has an unknown llama type: ${kid.type}`;
    }
  }
  return null;
}

/**
 * Whether a claimed kid matches an issued kid: same stall, same type.
 * The breedId is compared by the caller, not here.
 */
function sameFarmKid(a, b) {
  return a.stallIndex === b.stallIndex && a.type === b.type;
}

/**
 * Match a save's farm breed claims against the server-issued outcomes
 * (issue #79 feedback). `issued` is the player's unconsumed issued
 * breed outcomes (each carrying its breedId and its kids list), as the
 * store read them. Returns `{ ok: true, breedIds, kids }` (the issued
 * breedIds this save consumes, and the kids it applied), or
 * `{ ok: false, detail }` when a claim has no matching issued outcome.
 *
 * Each claim must match exactly one distinct issued outcome — same
 * breedId — and every kid in the claim must be one of the kids the
 * server rolled in that outcome (same stall, same type). A claim may
 * apply FEWER kids than were issued (a kid's stall can be filled by a
 * llama purchase in the same window, so that kid is never born), but
 * never more, and never a kid the server did not roll — so a forged,
 * inflated, or replayed breed is rejected. The whole issued outcome
 * is consumed when the save is accepted, even for the kids that were
 * never applied: those kids are gone, their stall is occupied now.
 *
 * An issued outcome EXPIRES issuedBreedValidSeconds after it was
 * issued (same reasoning as the star-claim-expiry fix: a prompt save
 * delayed by a deploy restart, a network failure, or rate-limit
 * retries still lands inside the window): a claim for an outcome older
 * than that is rejected even if it matches exactly and is unconsumed.
 * The store attaches `issuedAtMs` to each issued entry (from
 * farm_breed_issues.issued_at); entries without one — synthetic test
 * data that does not model issue time — skip the expiry check. `nowMs`
 * is the save time; when it is null the expiry check is skipped too.
 */
export function matchIssuedFarmBreeds(claims, issued, nowMs = null) {
  const unused = [...issued];
  const breedIds = [];
  const kids = [];
  for (const claim of claims) {
    const index = unused.findIndex(
      (issuedOutcome) => issuedOutcome.breedId === claim.breedId
    );
    if (index === -1) {
      return {
        ok: false,
        detail: `farm breed ${claim.breedId} does not match a server-issued outcome`,
      };
    }
    const issuedOutcome = unused[index];
    if (
      nowMs !== null &&
      typeof issuedOutcome.issuedAtMs === "number" &&
      nowMs >
        issuedOutcome.issuedAtMs +
          FARM_CONFIG.issuedBreedValidSeconds * 1000 +
          STAR_CLOCK_SKEW_GRACE_MS
    ) {
      return {
        ok: false,
        detail: `farm breed ${claim.breedId} expired: an issued outcome is only valid for ${FARM_CONFIG.issuedBreedValidSeconds}s after issue`,
      };
    }
    for (const kid of claim.kids) {
      if (!issuedOutcome.kids.some((issuedKid) => sameFarmKid(issuedKid, kid))) {
        return {
          ok: false,
          detail: `farm breed ${claim.breedId} has a kid the server did not roll: stall ${kid.stallIndex} ${kid.type}`,
        };
      }
      kids.push({ stallIndex: kid.stallIndex, type: kid.type });
    }
    breedIds.push(unused[index].breedId);
    unused.splice(index, 1);
  }
  return { ok: true, breedIds, kids };
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
 * An issued outcome EXPIRES issuedOutcomeValidSeconds after it was
 * issued (star-claim-expiry fix — decoupled from the star's 30s
 * on-screen lifetime, so a prompt save delayed by a deploy restart,
 * a network failure, or rate-limit retries still lands inside the
 * window): a claim for an outcome older than that is rejected even
 * if it matches exactly and is unconsumed, so a stale outcome cannot
 * be claimed late by a tampered client. The store attaches
 * `issuedAtMs` to each issued entry (from star_issues.issued_at);
 * entries without one — synthetic test data that does not model issue
 * time — skip the expiry check. `nowMs` is the save time; when it is
 * null the expiry check is skipped too.
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
          STAR_CONFIG.issuedOutcomeValidSeconds * 1000 +
          STAR_CLOCK_SKEW_GRACE_MS
    ) {
      return {
        ok: false,
        detail: `star claim ${claim.claimId} expired: an issued outcome is only valid for ${STAR_CONFIG.issuedOutcomeValidSeconds}s after issue`,
      };
    }
    claimIds.push(unused[index].claimId);
    unused.splice(index, 1);
  }
  return { ok: true, claimIds };
}

/** Clock-skew grace for server-issued claim expiry (used by the star/farm claim matchers below). */
const STAR_CLOCK_SKEW_GRACE_MS = 5000;

/**
 * Validate one save attempt against the last accepted snapshot.
 * Returns `{ ok: true }` or `{ ok: false, rule, detail }`.
 * `issuedStarClaims` is the player's unconsumed server-issued star
 * outcomes (issue #29); a save's star claims must match them exactly.
 * Defaults to [] (no issued outcomes — any star claim is rejected).
 * `issuedFarmBreeds` is the player's unconsumed server-issued breed
 * outcomes (issue #79 feedback); a save's farm breed claims must
 * match them. Defaults to [] (no issued outcomes — any breed claim is
 * rejected).
 */
export function validateSave(
  prev,
  body,
  nowMs,
  issuedStarClaims = [],
  issuedFarmBreeds = []
) {
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

  // Rate limit: at most one accepted save per second — flood control
  // only, now that the leaderboard is gone.
  if (nowMs - prev.savedAtMs < SAVE_RATE_LIMIT_SECONDS * 1000) {
    return fail(
      "RATE_LIMIT",
      `save too soon after the last accepted save (${SAVE_RATE_LIMIT_SECONDS}s minimum)`
    );
  }

  // Monotonicity: counts and totals never decrease, latches only flip false -> true.
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
    // Release Manager: the cumulative auto-ship counts only grow —
    // a manager's shipped projects are never un-shipped.
    if (
      newState.autoShipsCompleted[key] < prevState.autoShipsCompleted[key]
    ) {
      return fail("MONOTONIC", `auto-ship completions decreased: ${key}`);
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
  // Llama farm (issue #79): the farm is bought once and never
  // un-bought; unlocked types only grow; and a stall's llama, once
  // placed, never changes type and never goes back to empty — there is
  // no sell/cull in v1, so a llama disappearing or swapping types is
  // tampered, not gameplay.
  if (prevState.farm.owned && !newState.farm.owned) {
    return fail("MONOTONIC", "farm ownership flipped back");
  }
  for (const type of prevState.farm.unlockedTypes ?? []) {
    if (!(newState.farm.unlockedTypes ?? []).includes(type)) {
      return fail("MONOTONIC", `farm llama type unlock lost: ${type}`);
    }
  }
  for (let i = 0; i < FARM_CONFIG.stallCount; i++) {
    const prevLlama = prevState.farm.stalls[i]?.llama ?? null;
    const newLlama = newState.farm.stalls[i]?.llama ?? null;
    if (prevLlama !== null && newLlama !== prevLlama) {
      return fail(
        "MONOTONIC",
        `farm stall ${i} llama changed or disappeared: ${prevLlama} -> ${newLlama}`
      );
    }
  }

  // Cosmetics (issue #11): only the equip check survives — an equipped
  // cosmetic must be unlocked and belong to the slot it is equipped in
  // (state consistency). The trigger-met check for newly unlocked
  // cosmetics is gone with the leaderboard: the server no longer polices
  // how a cosmetic was earned. A failure here is a COSMETIC rejection.
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

  // Llama farm (issue #79): only the breed-claim match survives. Each
  // breed claim must match a server-issued, unconsumed outcome, and
  // every claimed kid must be one of the new llamas in this save. The
  // purchase and plausibility checks that used to surround this are gone
  // with the leaderboard — the server no longer polices whether a llama
  // was bought or bred legitimately; the shape check still bounds the
  // stalls and types. A failure here is a FARM rejection.
  //
  // New llamas: stalls that were empty in the previous save and hold a
  // llama in this one. A stall's llama never changes or disappears
  // (MONOTONIC, above), so every new llama is one of these.
  const newFarmLlamas = [];
  for (let i = 0; i < FARM_CONFIG.stallCount; i++) {
    const prevLlama = prevState.farm.stalls[i]?.llama ?? null;
    const newLlama = newState.farm.stalls[i]?.llama ?? null;
    if (prevLlama === null && newLlama !== null) {
      newFarmLlamas.push({ stallIndex: i, type: newLlama });
    }
  }
  const farmBreedClaims = actions.farmBreedClaims ?? [];
  const farmBreedMatch = matchIssuedFarmBreeds(
    farmBreedClaims,
    issuedFarmBreeds,
    nowMs
  );
  if (!farmBreedMatch.ok) return fail("FARM", farmBreedMatch.detail);
  const bredKids = farmBreedMatch.kids;
  // Every bred kid must be one of the new llamas (same stall, same
  // type) — the claim is only valid if the client actually applied the
  // kid the server rolled.
  for (const kid of bredKids) {
    if (
      !newFarmLlamas.some(
        (llama) => llama.stallIndex === kid.stallIndex && llama.type === kid.type
      )
    ) {
      return fail(
        "FARM",
        `farm breed claim for stall ${kid.stallIndex} ${kid.type} does not match the new llamas`
      );
    }
  }

  // Release Manager (auto-ships freelance projects). A failure here is
  // a RELEASE_MANAGER rejection.
  //
  // Assignments are a strategy choice, not a security boundary: the
  // player assigns each manager to a project, and the sum of the
  // per-project counts cannot exceed the managers owned (the rest are
  // unassigned and do nothing). Assignments change freely — there is
  // no monotonic constraint on them.
  //
  // Auto-ships are a subset of all completions: the auto-ship count for
  // a project can never exceed that project's completions in the
  // window, and a manager can only auto-ship a project the player has
  // unlocked. The per-interval RATE cap is gone with the leaderboard.
  const assignedManagers = releaseManagerAssignedCount(
    newState.releaseManagerAssignments
  );
  if (assignedManagers > newState.employees.releaseManager) {
    return fail(
      "RELEASE_MANAGER",
      `${assignedManagers} managers assigned but only ${newState.employees.releaseManager} owned`
    );
  }
  const autoShips = actions.autoShips ?? {};
  for (const key of FREELANCE_PROJECT_KEYS) {
    if (autoShips[key] > actions.projectsCompleted[key]) {
      return fail(
        "RELEASE_MANAGER",
        `auto-ships for ${key} (${autoShips[key]}) exceed completions (${actions.projectsCompleted[key]})`
      );
    }
    if (
      autoShips[key] > 0 &&
      !newState.unlockedFreelanceProjects[key]
    ) {
      return fail(
        "RELEASE_MANAGER",
        `auto-ship claimed for locked project: ${key}`
      );
    }
  }

  // Total LOC is the lifetime counter; it can never sit below the
  // current balance. (The tail of the old LOC rule, kept as a
  // state-consistency check: total only ever grows from gains, and the
  // current balance is spent from, never below, it.)
  if (newState.totalLinesOfCode < newState.linesOfCode) {
    return fail("LOC", "totalLinesOfCode is less than linesOfCode");
  }

  // Star claims (issue #29): each claim must match a server-issued,
  // unconsumed outcome exactly. This is replay protection for the
  // server-rolled star system, not leaderboard policing — an issued
  // outcome can only be claimed once, and the client only ever applies
  // what the server rolled. A failed claim is a STAR rejection.
  const starClaims = actions.starClaims ?? [];
  const starMatch = matchIssuedStarClaims(starClaims, issuedStarClaims, nowMs);
  if (!starMatch.ok) return fail("STAR", starMatch.detail);

  return { ok: true };
}
