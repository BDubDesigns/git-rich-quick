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
 *   projects. Star outcomes and farm kids are rolled client-side now:
 *   they arrive inside the ordinary save payload (star rewards in
 *   linesOfCode/money/activeStarEffects, farm kids in the farm stalls),
 *   so they are stored, never matched against a server-issued outcome.
 *   There is nothing left to claim against.
 *
 * Everything else the old validator computed — the LOC cap, the exact
 * money accounting, the click cap, the action deltas, the unlock
 * recomputation, the cosmetic triggers, the farm purchase/plausibility
 * checks, the auto-ship rate cap, the star/farm claim matching — is
 * gone. The client is trusted with its own numbers now; the server
 * stores what it sends.
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
 * 2. GOLDEN STARS (issue #33) are decided by the CLIENT now, not the
 *    server. The client rolls the effect, good/bad, and reward from
 *    shared/game-balance.js (the same pure helpers the server used)
 *    and applies it to its own state; the next save carries the
 *    result in the ordinary payload. The server never sees a claim
 *    and never issues one — there is no `star_issues` table and no
 *    claim matching anymore. A star reward is just LOC/money/buffs
 *    in the save, like any other gain. The same applies to farm
 *    breeding (issue #79): the client rolls the kid locally from
 *    the shared odds, and the save carries the new llama in the
 *    farm stalls.
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
 * open-source maps, `activeStarEffects` on the state, and the star
 * timers (`nextStarAtMs`, `lastStarBuyAtMs`). Those are defaulted
 * (constellation 0 / unlocked, no active buffs, no scheduled star,
 * never bought) by `normalizeSaveState` / `normalizeActions` before
 * any check runs, so old saves keep validating. Only the new fields
 * are defaulted — a missing old field is still a shape error. The
 * same applies to the later fields: `unlockedFreelanceProjects`
 * (issue #19) is derived from the shipped counts, and
 * `unlockedCosmetics` / `equippedCosmetics` (issue #11) are derived
 * / defaulted the same way.
 *
 * Pure function: no I/O, no clock of its own. `prev` is the last accepted
 * snapshot `{ state, savedAtMs }`; for a brand-new player the store passes
 * the initial state with savedAtMs = player creation time. `nowMs` is the
 * server time of the save attempt.
 */

import {
  COSMETIC_SLOTS,
  EMAIL_CONFIG,
  emailTargetError,
  emailTrophiesError,
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FARM_LIGHTING_COLORS,
  FREELANCE_PROJECT_KEYS,
  LLAMA_TYPES,
  OPEN_SOURCE_IDS,
  MOONSHOT_CONFIG,
  STAR_CONFIG,
  PRESTIGE_STORE_IDS,
  achievementsDecreased,
  achievementsStateError,
  availableEquity,
  canEquipCosmetic,
  claimableEquity,
  farmLlamaCountsByType,
  farmStallIsOpen,
  findCosmetic,
  NIGHT_SHIFT_CONFIG,
  normalizeSaveState,
  normalizeActions,
  openSourceLevelCap,
  releaseManagerAssignedCount,
  storeMaxRank,
  storeRankCost,
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
 * 0 to each project's own max (its level count, or for a track gated
 * by Funding Rounds the owned round's cap), NoPilot frozen at 0 (no buy action
 * exists for it in v1). Star-era fields (activeStarEffects, the star
 * timers) are validated here too.
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
      "nextStarAtMs",
      "lastStarBuyAtMs",
      "lifetimeEquityEarned",
      "equitySpent",
      "saleCount",
      "lifetimeLocAtLastSale",
      "lastSaleId",
      "permanentStoreRanks",
      "prestigeIntermission",
      "favoriteOpenSourceProjects",
      "subtracterall",
      "overtimeReskin",
      "achievements",
      "nightShiftLevel",
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
  // Funding Rounds (issue #170): a gated track can only reach the cap
  // of the round the state owns. The rank is read guarded here (the
  // store ranks are shape-checked below), and it only moves through
  // the store-buy endpoint, so a normal save cannot raise its own cap.
  // Bridge Rounds (issue #192): a company that owns its Bridge Round
  // reaches the next round's caps, and the Bridge Round itself caps at
  // 0 at IPO (issue #226: every other round has a bridge), both read
  // from the same shared helper.
  for (const projectId of OPEN_SOURCE_IDS) {
    const maxLevel = openSourceLevelCap(
      projectId,
      state.permanentStoreRanks,
      state.openSourceProjects
    );
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
  // Golden-star schedule (client-rolled now): the wall-clock time the
  // next natural star is due (null = no star scheduled, e.g. level 0),
  // and the wall-clock time the last StarBroker star was bought (null
  // = never bought; the buy cooldown runs from it). Both are nullable
  // ms-since-epoch numbers; the client rolls and persists them, the
  // server only bounds the shape.
  if (
    state.nextStarAtMs !== null &&
    (!Number.isInteger(state.nextStarAtMs) || state.nextStarAtMs < 0)
  ) {
    return "nextStarAtMs must be null or a non-negative integer (ms since epoch)";
  }
  if (
    state.lastStarBuyAtMs !== null &&
    (!Number.isInteger(state.lastStarBuyAtMs) || state.lastStarBuyAtMs < 0)
  ) {
    return "lastStarBuyAtMs must be null or a non-negative integer (ms since epoch)";
  }
  // Prestige (Sell the Company, Slice 1). The Equity books: Lifetime
  // Equity earned (only grows on sale), permanent-store spending
  // (Slice 2 — 0 in Slice 1), the sale count, the lifetime LOC at the
  // last sale (Company LOC earned is total minus this), and the last
  // sale's idempotency key (null = never sold). Old saves without
  // them are backfilled to 0/null by normalizeSaveState, so a missing
  // field here is a malformed save, not an old one.
  if (!isInt(state.lifetimeEquityEarned) || state.lifetimeEquityEarned < 0) {
    return "lifetimeEquityEarned must be a non-negative integer";
  }
  if (!isInt(state.equitySpent) || state.equitySpent < 0) {
    return "equitySpent must be a non-negative integer";
  }
  if (!isInt(state.saleCount) || state.saleCount < 0) {
    return "saleCount must be a non-negative integer";
  }
  if (!isNonNegNumber(state.lifetimeLocAtLastSale)) {
    return "lifetimeLocAtLastSale must be a non-negative number";
  }
  if (
    state.lastSaleId !== null &&
    (typeof state.lastSaleId !== "string" || !UUID_RE.test(state.lastSaleId))
  ) {
    return "lastSaleId must be null or a UUID string";
  }
  // Permanent store (Slice 2). Ranks are a count map over the five
  // store tracks, each 0 to its own max (3 for the ranked tracks, 1
  // for Company Template). The intermission is null outside a sale,
  // or the frozen Starting Capital quote from the sale that opened
  // it (the sale id, the healthy passive LOC/s, and the best payout
  // per LOC in cents per LOC — both non-negative numbers, the rate
  // may be fractional once Client Network applies). Favorites are a
  // list of open-source project ids, deduped by normalizeSaveState;
  // an unknown id is a stale favorite, rejected here.
  if (!isCountMap(state.permanentStoreRanks, PRESTIGE_STORE_IDS)) {
    return "permanentStoreRanks must be non-negative integer ranks";
  }
  for (const storeId of PRESTIGE_STORE_IDS) {
    if (state.permanentStoreRanks[storeId] > storeMaxRank(storeId)) {
      return `permanentStoreRanks ${storeId} exceeds its max rank`;
    }
  }
  if (state.prestigeIntermission !== null) {
    const intermission = state.prestigeIntermission;
    if (
      !hasExactKeys(intermission, [
        "saleId",
        "frozenHealthyPassiveLocPerSec",
        "frozenBestPayoutPerLocCents",
      ])
    ) {
      return "prestigeIntermission has unknown or missing keys";
    }
    if (
      typeof intermission.saleId !== "string" ||
      !UUID_RE.test(intermission.saleId)
    ) {
      return "prestigeIntermission saleId must be a UUID string";
    }
    if (!isNonNegNumber(intermission.frozenHealthyPassiveLocPerSec)) {
      return "prestigeIntermission frozenHealthyPassiveLocPerSec must be a non-negative number";
    }
    if (!isNonNegNumber(intermission.frozenBestPayoutPerLocCents)) {
      return "prestigeIntermission frozenBestPayoutPerLocCents must be a non-negative number";
    }
  }
  if (!Array.isArray(state.favoriteOpenSourceProjects)) {
    return "favoriteOpenSourceProjects must be an array";
  }
  for (const id of state.favoriteOpenSourceProjects) {
    if (!OPEN_SOURCE_IDS.includes(id)) {
      return `favoriteOpenSourceProjects has an unknown project id: ${id}`;
    }
  }
  if (
    new Set(state.favoriteOpenSourceProjects).size !==
    state.favoriteOpenSourceProjects.length
  ) {
    return "favoriteOpenSourceProjects must not contain duplicates";
  }
  // SUBTRACTERALL (issue #150): phase, remaining credited seconds,
  // the per-company use count, and the use number of the phase in
  // progress. The Overtime reskin is a boolean setting. The server
  // bounds the shape only: it never polices how the LOC was earned
  // (the burst is honest production, not cheating), and it never
  // resets a phase here: a sale may not cure a withdrawal, and
  // neither may a load. There is no use cap.
  const sub = state.subtracterall;
  if (
    !sub ||
    typeof sub !== "object" ||
    Array.isArray(sub) ||
    !hasExactKeys(sub, ["phase", "phaseRemainingSeconds", "uses", "activeUse"])
  ) {
    return "subtracterall has unknown or missing keys";
  }
  if (!["ready", "burst", "withdrawal"].includes(sub.phase)) {
    return "subtracterall phase must be ready, burst, or withdrawal";
  }
  // Phase lengths are 180 x 0.9^(n-1) and 180 x 1.2^(n-1) seconds,
  // so the remaining time is a non-negative number, not an integer.
  if (!isNonNegNumber(sub.phaseRemainingSeconds)) {
    return "subtracterall phaseRemainingSeconds must be a non-negative number";
  }
  if (!Number.isInteger(sub.uses) || sub.uses < 0) {
    return "subtracterall uses must be a non-negative integer";
  }
  if (!Number.isInteger(sub.activeUse) || sub.activeUse < 0) {
    return "subtracterall activeUse must be a non-negative integer";
  }
  // A phase in progress belongs to a real use (1 or more); Ready has
  // none. The active use may exceed `uses` only after a sale, which
  // resets the count while the phase carries on.
  if ((sub.phase === "ready") !== (sub.activeUse === 0)) {
    return "subtracterall activeUse must be 0 exactly when the phase is ready";
  }
  if (typeof state.overtimeReskin !== "boolean") {
    return "overtimeReskin must be a boolean";
  }
  // Night Shift (issue #149): the purchased level, an integer 0..5.
  // Shape only: the client buys levels like any other upgrade (the
  // server does not police purchases). The offline credit itself is
  // server-computed on load, never taken from the client.
  if (
    !Number.isInteger(state.nightShiftLevel) ||
    state.nightShiftLevel < 0 ||
    state.nightShiftLevel > NIGHT_SHIFT_CONFIG.maxLevel
  ) {
    return `nightShiftLevel must be an integer from 0 to ${NIGHT_SHIFT_CONFIG.maxLevel}`;
  }
  // Achievements (issue #132): tier state and the lifetime counters
  // the achievements read. The rule is shared with the client's
  // pre-write payload check (shared.achievementsStateError), so the
  // two can never disagree about a well-formed record.
  const achievementsError = achievementsStateError(state.achievements);
  if (achievementsError) return achievementsError;
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
  // lighting, locked, open } with a llama that is null or a known type id and a
  // lighting that is a known color), and unlockedTypes (known type ids
  // only, no duplicates). Sell prices float with production, so nothing
  // is stored on a stall. A save written by the stored-value build
  // (issue #244) carries a `sellCents` key on each stall:
  // normalizeSaveState strips it before this check, and the check also
  // tolerates it, so those saves and stale cached clients still load.
  // How a llama was bought or bred is not policed anymore: the shape
  // check only bounds the stalls, their values, and the types.
  if (
    state.farm === null ||
    typeof state.farm !== "object" ||
    Array.isArray(state.farm) ||
    !hasExactKeys(state.farm, ["owned", "stalls", "unlockedTypes", "unseenBirths"])
  ) {
    return "farm must be an object with owned, stalls, unlockedTypes, and unseenBirths";
  }
  // Issue #204: the Farm tab badge count, a non-negative whole number.
  if (
    !Number.isSafeInteger(state.farm.unseenBirths) ||
    state.farm.unseenBirths < 0
  ) {
    return "farm.unseenBirths must be a non-negative integer";
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
  // Issue #241: `open` (closed stalls) is optional like `locked` and
  // `sellCents`: normalizeSaveState backfills it, and a stale client
  // that predates it sends no key.
  const optionalStallKeys = ["locked", "sellCents", "open"];
  for (const [stallIndex, stall] of state.farm.stalls.entries()) {
    if (
      stall === null ||
      typeof stall !== "object" ||
      Array.isArray(stall) ||
      !("llama" in stall) ||
      !("lighting" in stall) ||
      Object.keys(stall).some(
        (key) =>
          key !== "llama" && key !== "lighting" && !optionalStallKeys.includes(key)
      )
    ) {
      return "farm stalls must be objects with llama and lighting";
    }
    // Issue #241: a closed stall holds no llama (so it cannot be
    // locked), and an owned barn's starter stalls are always open.
    if ("open" in stall) {
      if (typeof stall.open !== "boolean") {
        return "farm stall open must be a boolean";
      }
      if (!stall.open && stall.llama !== null) {
        return "farm stall is closed but holds a llama";
      }
      if (
        !stall.open &&
        state.farm.owned &&
        FARM_CONFIG.starterStalls.includes(stallIndex)
      ) {
        return "farm starter stall is closed";
      }
    }
    // Issue #240: the llama lock. normalizeSaveState backfills it
    // (unlocked) before this check; a stale client that predates the
    // lock sends no key, and that is tolerated too. When present it is
    // a boolean, and only a llama can be locked.
    if ("locked" in stall) {
      if (typeof stall.locked !== "boolean") {
        return "farm stall locked must be a boolean";
      }
      if (stall.locked && stall.llama === null) {
        return "farm stall is locked but holds no llama";
      }
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
    // An unbought farm has no llamas: a save that claims llamas
    // without owning the farm is malformed. Discovered types survive a
    // sale (issue #237), so an unbought farm may hold types once a
    // company has been sold; before the first sale it has none.
    if (state.farm.stalls.some((stall) => stall.llama !== null)) {
      return "farm has llamas but is not owned";
    }
    if (state.farm.unlockedTypes.length > 0 && state.saleCount < 1) {
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
    // To the Moon (Moonshot jackpot, issue #165): exactly the config
    // multiplier, never a range, so any other value is tampered.
    case "moonshot":
      return multiplier === MOONSHOT_CONFIG.jackpotMultiplier;
    // Hype Train / Derailment and AGI / Union Drive (issue #157):
    // fixed config values both ways.
    case "hype":
      return (
        multiplier === STAR_CONFIG.hypePayoutMultiplier.good ||
        multiplier === STAR_CONFIG.hypePayoutMultiplier.bad
      );
    case "hiring":
      return (
        multiplier === STAR_CONFIG.hiringCostMultiplier.good ||
        multiplier === STAR_CONFIG.hiringCostMultiplier.bad
      );
    default:
      return false;
  }
}

/** The star effects that leave a timed buff in activeStarEffects. */
const TIMED_STAR_EFFECTS = Object.freeze([
  "frenzy",
  "click",
  "employee",
  "moonshot",
  "hype",
  "hiring",
]);

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
  if (!TIMED_STAR_EFFECTS.includes(entry.effect)) {
    return `activeStarEffects effect must be a timed buff (${TIMED_STAR_EFFECTS.join(", ")})`;
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
  // Issue #173: `target` (a link to a tab and item) and `trophies`
  // (an achievement mail's earned tiers) are optional; an old email
  // has neither. The rules are shared (emailTargetError /
  // emailTrophiesError), the same ones the client's builders and
  // sanitizers follow.
  const required = [
    "id",
    "triggerKey",
    "sender",
    "subject",
    "body",
    "createdAtMs",
    "read",
  ];
  const optional = ["target", "trophies"];
  const keys = Object.keys(entry);
  if (
    !required.every((key) => key in entry) ||
    !keys.every((key) => required.includes(key) || optional.includes(key))
  ) {
    return "emails entries have unknown or missing keys";
  }
  const linkError =
    ("target" in entry ? emailTargetError(entry.target) : null) ??
    ("trophies" in entry ? emailTrophiesError(entry.trophies) : null);
  if (linkError) return linkError;
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

/**
 * Validate one save attempt against the last accepted snapshot.
 * Returns `{ ok: true }` or `{ ok: false, rule, detail }`.
 *
 * `options.skipRateLimit` skips the 1s rate limit: the prestige sale
 * endpoint reuses this validation for its pre-sale state (a sale
 * right after a save is not a flood), and the sale itself is a
 * separate, idempotent operation, not a heartbeat save.
 */
export function validateSave(prev, body, nowMs, options = {}) {
  // Star-era fields are backward-compatible: default them on states and
  // actions that predate Constellation, so old saves keep validating.
  // normalizeSaveState / normalizeActions return non-objects
  // unchanged, so a malformed body still fails the shape check below.
  const normalizedPrev = {
    ...(prev ?? {}),
    state: normalizeSaveState(prev?.state),
  };
  const normalizedBody = {
    ...(body ?? {}),
    state: normalizeSaveState(body?.state),
    actionsSinceLastSave: normalizeActions(body?.actionsSinceLastSave),
  };
  const shapeError = checkShape(normalizedBody);
  if (shapeError) return fail("SHAPE", shapeError);

  const prevState = normalizedPrev.state;
  const newState = normalizedBody.state;
  const actions = normalizedBody.actionsSinceLastSave;

  // Rate limit: at most one accepted save per second — flood control
  // only, now that the leaderboard is gone. Skipped for the prestige
  // sale's pre-sale check (see the doc comment on validateSave).
  if (
    !options.skipRateLimit &&
    nowMs - prev.savedAtMs < SAVE_RATE_LIMIT_SECONDS * 1000
  ) {
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
  // Night Shift (issue #149): the level only rises within a company.
  // A sale resets it on the server (applyPrestigeSale), never here.
  if ((newState.nightShiftLevel ?? 0) < (prevState.nightShiftLevel ?? 0)) {
    return fail("MONOTONIC", "nightShiftLevel decreased");
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
  // Prestige (Sell the Company, Slice 1): the Equity books only move
  // through a sale (lifetimeEquityEarned, saleCount, lastSaleId,
  // lifetimeLocAtLastSale) or the permanent store (equitySpent,
  // Slice 2), never through an ordinary save. A normal save that
  // lowers one, or changes a sale-only field at all, is rejected —
  // the sale endpoint is the only path that writes them.
  if (newState.lifetimeEquityEarned < prevState.lifetimeEquityEarned) {
    return fail("MONOTONIC", "lifetimeEquityEarned decreased");
  }
  if (newState.equitySpent < prevState.equitySpent) {
    return fail("MONOTONIC", "equitySpent decreased");
  }
  if (newState.saleCount < prevState.saleCount) {
    return fail("MONOTONIC", "saleCount decreased");
  }
  if (newState.equitySpent > newState.lifetimeEquityEarned) {
    return fail(
      "PRESTIGE",
      "equitySpent exceeds lifetimeEquityEarned"
    );
  }
  if (newState.lifetimeLocAtLastSale > newState.totalLinesOfCode) {
    return fail(
      "PRESTIGE",
      "lifetimeLocAtLastSale exceeds totalLinesOfCode"
    );
  }
  if (newState.lifetimeLocAtLastSale !== prevState.lifetimeLocAtLastSale) {
    return fail(
      "PRESTIGE",
      "lifetimeLocAtLastSale changed outside a sale"
    );
  }
  if (newState.lastSaleId !== prevState.lastSaleId) {
    return fail("PRESTIGE", "lastSaleId changed outside a sale");
  }
  // Permanent store (Slice 2): ranks only move through the store-buy
  // endpoint, never through an ordinary save. A normal save that
  // changes any rank — up or down — is rejected, the same way a
  // normal save cannot move the sale-only Equity books. The buy
  // endpoint is the only path that writes them (and equitySpent).
  for (const storeId of PRESTIGE_STORE_IDS) {
    if (
      (newState.permanentStoreRanks?.[storeId] ?? 0) !==
      (prevState.permanentStoreRanks?.[storeId] ?? 0)
    ) {
      return fail(
        "STORE",
        `permanentStoreRanks ${storeId} changed outside the store`
      );
    }
  }
  // Post-sale intermission (Slice 2): only the sale opens it and
  // only completing it clears it. A normal save that sets, clears,
  // or alters the frozen quote is rejected — the frozen Starting
  // Capital quote must survive untouched until the player completes
  // the intermission, or the grant could be repriced from the empty
  // new company. Compared as JSON: the record is small and flat.
  if (
    JSON.stringify(newState.prestigeIntermission ?? null) !==
    JSON.stringify(prevState.prestigeIntermission ?? null)
  ) {
    return fail(
      "PRESTIGE",
      "prestigeIntermission changed outside the intermission flow"
    );
  }
  // Llama farm (issue #79): the farm is bought once and never
  // un-bought, and unlocked types only grow. Llama economy v2 (issue
  // #129): llamas MOVE between stalls and can be SOLD, so a stall's
  // llama may change or leave. What still holds: llamas of a type only
  // leave the barn through a recorded sale. For every type, the drop
  // in that type's barn count can be at most the rise in that type's
  // lifetime sold counter (achievements.llamasSold, written by the
  // sale). A move keeps every count, so it always passes; a llama that
  // vanishes or swaps type without a sale is tampered, not gameplay.
  if (prevState.farm.owned && !newState.farm.owned) {
    return fail("MONOTONIC", "farm ownership flipped back");
  }
  // Issue #241: an opened stall is bought, like the barn, so it never
  // closes again within a company (a sale resets the farm on its own
  // path, never here). Opening one is a cash purchase the client prices,
  // the same as the barn and Night Shift levels.
  if (prevState.farm.owned && newState.farm.owned) {
    for (let i = 0; i < FARM_CONFIG.stallCount; i++) {
      if (
        farmStallIsOpen(prevState.farm.stalls[i]) &&
        !farmStallIsOpen(newState.farm.stalls[i])
      ) {
        return fail("MONOTONIC", `farm stall ${i} closed again`);
      }
    }
  }
  for (const type of prevState.farm.unlockedTypes ?? []) {
    if (!(newState.farm.unlockedTypes ?? []).includes(type)) {
      return fail("MONOTONIC", `farm llama type unlock lost: ${type}`);
    }
  }
  const prevLlamaCounts = farmLlamaCountsByType(prevState.farm.stalls);
  const newLlamaCounts = farmLlamaCountsByType(newState.farm.stalls);
  // Brandon, Nov 21: a locked llama cannot be sold until it is
  // unlocked. The lock moves with the llama and llamas of one type look
  // alike, so the check is per type: when llamas of a type left the
  // barn, that type's locked count may not have dropped. A locked
  // llama that was sold always drops it. Limit: an unlock and a sale of
  // the same type that land in one save (the unlock's own save was
  // rate limited) read the same and are refused too.
  const lockedOnly = (stalls) => stalls.filter((stall) => stall.locked === true);
  const prevLockedCounts = farmLlamaCountsByType(lockedOnly(prevState.farm.stalls));
  const newLockedCounts = farmLlamaCountsByType(lockedOnly(newState.farm.stalls));
  for (const type of LLAMA_TYPES) {
    const left = prevLlamaCounts[type] - newLlamaCounts[type];
    if (left <= 0) continue;
    if (newLockedCounts[type] < prevLockedCounts[type]) {
      return fail("MONOTONIC", `farm sold a locked ${type} llama`);
    }
    const sold =
      (newState.achievements?.llamasSold?.[type] ?? 0) -
      (prevState.achievements?.llamasSold?.[type] ?? 0);
    if (left > sold) {
      return fail(
        "MONOTONIC",
        `farm lost ${left} ${type} llama(s) but recorded ${sold} sale(s)`
      );
    }
  }

  // Achievements (issue #132): an earned tier is never revoked, and
  // the lifetime counters (hires, clicks, peak LOC/s, llamas bought and
  // sold) only grow. A sale carries them over untouched.
  const achievementDrop = achievementsDecreased(
    prevState.achievements,
    newState.achievements
  );
  if (achievementDrop) {
    return fail("MONOTONIC", `achievements ${achievementDrop} decreased`);
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

  return { ok: true };
}

/**
 * Validate a prestige sale's pre-sale state against the stored
 * snapshot. The sent state is the client's freshest pre-sale state
 * (it may be ahead of the stored one by unsaved progress — the sale
 * settles production up to the sale, so the sale is computed from
 * the SENT lifetime LOC, not the stored one). The Equity books in
 * the sent state must match the stored ones exactly: only a sale
 * changes them, and this sale is what is being validated.
 *
 * Returns `{ ok: true, gainedEquity }` or
 * `{ ok: false, rule, detail }`. `rule` is SALE when there is no new
 * Equity to claim (a zero-reward sale is never applied), PRESTIGE
 * when the sent Equity books disagree with the stored ones. The
 * caller applies the sale with shared.applyPrestigeSale.
 */
export function validatePrestigeSale(prevState, sentState, saleId) {
  if (typeof saleId !== "string" || !UUID_RE.test(saleId)) {
    return fail("SALE", "saleId must be a UUID string");
  }
  if (sentState.lifetimeEquityEarned !== prevState.lifetimeEquityEarned) {
    return fail(
      "PRESTIGE",
      "lifetimeEquityEarned changed outside a sale"
    );
  }
  if (sentState.equitySpent !== prevState.equitySpent) {
    return fail("PRESTIGE", "equitySpent changed outside a sale");
  }
  if (sentState.saleCount !== prevState.saleCount) {
    return fail("PRESTIGE", "saleCount changed outside a sale");
  }
  if (sentState.lifetimeLocAtLastSale !== prevState.lifetimeLocAtLastSale) {
    return fail(
      "PRESTIGE",
      "lifetimeLocAtLastSale changed outside a sale"
    );
  }
  if (sentState.lastSaleId !== prevState.lastSaleId) {
    return fail("PRESTIGE", "lastSaleId changed outside a sale");
  }
  const gainedEquity = claimableEquity(
    sentState.totalLinesOfCode,
    prevState.lifetimeEquityEarned
  );
  if (gainedEquity < 1) {
    return fail("SALE", "no new Equity to claim");
  }
  return { ok: true, gainedEquity };
}

/**
 * Validate a permanent-store purchase (Slice 2). `prevState` is the
 * stored state, `sentState` the client's freshest state (already
 * validated as an ordinary successor, so it carries the same
 * intermission and the same Equity books as the stored state). The
 * purchase is always for the NEXT rank of one track: ranks are
 * bought in order, one at a time, and the price is the per-rank
 * price, not cumulative.
 *
 * Returns `{ ok: true, price }`, or `{ ok: false, rule, detail }`.
 * `rule` is STORE for a purchase that cannot apply, PRESTIGE when
 * the intermission or the Equity books disagree with the stored
 * ones. `alreadyOwned` is true when the rank is already bought: a
 * retried purchase whose first response was lost. The caller returns
 * the stored state for that case (no second charge), the same
 * idempotency shape as a retried sale.
 */
export function validateStoreBuy(prevState, sentState, storeId, rank) {
  if (typeof storeId !== "string") {
    return fail("STORE", "storeId must be a string");
  }
  if (!PRESTIGE_STORE_IDS.includes(storeId)) {
    return fail("STORE", `unknown store track: ${storeId}`);
  }
  if (!Number.isInteger(rank) || rank < 1) {
    return fail("STORE", "rank must be a positive integer");
  }
  const intermission = prevState.prestigeIntermission ?? null;
  if (!intermission) {
    return fail(
      "STORE",
      "the permanent store is only open in the post-sale intermission"
    );
  }
  const sentIntermission = sentState.prestigeIntermission ?? null;
  if (
    !sentIntermission ||
    sentIntermission.saleId !== intermission.saleId
  ) {
    return fail(
      "PRESTIGE",
      "prestigeIntermission does not match the stored intermission"
    );
  }
  if (sentState.equitySpent !== prevState.equitySpent) {
    return fail("PRESTIGE", "equitySpent changed outside the store");
  }
  const currentRank = prevState.permanentStoreRanks?.[storeId] ?? 0;
  if (rank <= currentRank) {
    return {
      ok: false,
      rule: "STORE",
      detail: `${storeId} rank ${rank} is already owned`,
      alreadyOwned: true,
    };
  }
  if (rank !== currentRank + 1) {
    return fail(
      "STORE",
      `${storeId} rank ${rank} is not the next rank (current ${currentRank})`
    );
  }
  const price = storeRankCost(storeId, rank);
  if (price === null) {
    return fail("STORE", `${storeId} has no rank ${rank}`);
  }
  const spendable = availableEquity(
    prevState.lifetimeEquityEarned,
    prevState.equitySpent
  );
  if (price > spendable) {
    return fail(
      "STORE",
      `${storeId} rank ${rank} costs ${price} Equity, only ${spendable} spendable`
    );
  }
  return { ok: true, price };
}

/**
 * Validate completing the post-sale intermission (Slice 2). The
 * stored state must still have the intermission open, and the sent
 * state's intermission must match it (same sale). Returns
 * `{ ok: true, alreadyCompleted }`: alreadyCompleted is true when
 * the intermission is already gone (a retried completion whose
 * first response was lost) — the caller returns the stored state
 * without applying the grant a second time.
 */
export function validateCompleteIntermission(prevState, sentState) {
  const intermission = prevState.prestigeIntermission ?? null;
  if (!intermission) {
    return { ok: true, alreadyCompleted: true };
  }
  const sentIntermission = sentState.prestigeIntermission ?? null;
  if (
    !sentIntermission ||
    sentIntermission.saleId !== intermission.saleId
  ) {
    return fail(
      "PRESTIGE",
      "prestigeIntermission does not match the stored intermission"
    );
  }
  return { ok: true, alreadyCompleted: false };
}
