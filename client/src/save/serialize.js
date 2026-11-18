/**
 * State mapping between the client's reducer state and the server's flat
 * save shape (Slice 2).
 *
 * The client stores counts as `{ type: { count } }` and levels as
 * `{ id: { level } }`; the server stores flat maps (`{ type: count }`,
 * `{ id: level }`). These are thin adapters — the numbers come from the
 * reducer, never invented here.
 *
 * The 19 game fields are saved, including the timed golden-star buffs
 * (activeStarEffects), the star schedule timers (nextStarAtMs /
 * lastStarBuyAtMs), the in-game inbox (emails, issue #31), and the
 * cosmetics (unlockedCosmetics / equippedCosmetics, issue #11). UI state (activeTab, selectedPanes,
 * clickHistory, currentCPS, uiState) is NOT saved and is reset to the
 * initial values on restore.
 */

import {
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  deriveUnlockedCosmetics,
  employeeUnlockConditionsMet,
  freelanceProjectUnlockConditionsMet,
  initialSaveState,
  openSourceUnlockConditionsMet,
  achievementTiersEarned,
  achievementsStateError,
  sanitizeAchievementsState,
  normalizeSubtracterallState,
  nightShiftLevelOf,
} from "../../../shared/game-balance.js";
import { unreadEmailCount } from "../email/email.js";

function flatCounts(nested) {
  return EMPLOYEE_TYPES.reduce((acc, key) => {
    // A save from before Project Manager / Commit Specialist shipped
    // has no entry for those types; default it to 0 instead of
    // throwing on the missing entry.
    acc[key] = nested[key]?.count ?? 0;
    return acc;
  }, {});
}

function flatLevels(nested) {
  return OPEN_SOURCE_IDS.reduce((acc, key) => {
    // A save from before Constellation shipped has no constellation key;
    // default it to 0 instead of throwing on the missing entry.
    acc[key] = nested[key]?.level ?? 0;
    return acc;
  }, {});
}

function inflateCounts(flat) {
  return EMPLOYEE_TYPES.reduce((acc, key) => {
    // Same migration as flatCounts: an old save lacks the new types.
    acc[key] = { count: flat[key] ?? 0 };
    return acc;
  }, {});
}

function inflateLevels(flat) {
  return OPEN_SOURCE_IDS.reduce((acc, key) => {
    // Same migration as flatLevels: an old save lacks constellation.
    acc[key] = { level: flat[key] ?? 0 };
    return acc;
  }, {});
}

/** Client reducer state -> the flat save shape the server stores. */
export function stateToSaveState(clientState) {
  return {
    linesOfCode: clientState.linesOfCode,
    totalLinesOfCode: clientState.totalLinesOfCode,
    money: clientState.money,
    employees: flatCounts(clientState.employees),
    aiAssistants: { noPilot: clientState.aiAssistants.noPilot.count },
    freelanceProjectsCompleted: { ...clientState.freelanceProjectsCompleted },
    // Release Manager assignments (which project each manager ships)
    // and the cumulative auto-ship counts. Copied per key; the save
    // engine derives actions.autoShips from the auto-ship delta, so
    // the server can rate-cap auto-ships.
    releaseManagerAssignments: {
      ...(clientState.releaseManagerAssignments ?? {}),
    },
    autoShipsCompleted: { ...(clientState.autoShipsCompleted ?? {}) },
    openSourceProjects: flatLevels(clientState.openSourceProjects),
    unlockedEmployees: { ...clientState.unlockedEmployees },
    unlockedOpenSourceProjects: { ...clientState.unlockedOpenSourceProjects },
    unlockedFreelanceProjects: { ...clientState.unlockedFreelanceProjects },
    // Prestige (Sell the Company, Slice 1). The Equity books: Lifetime
    // Equity earned (only grows on sale), permanent-store spending
    // (Slice 2), the sale count, the lifetime LOC at the last sale,
    // and the last sale's idempotency key. A client state from before
    // prestige shipped has none of them — default to the fresh
    // values, the same way the server's normalizeSaveState does on
    // save.
    lifetimeEquityEarned: clientState.lifetimeEquityEarned ?? 0,
    equitySpent: clientState.equitySpent ?? 0,
    saleCount: clientState.saleCount ?? 0,
    lifetimeLocAtLastSale: clientState.lifetimeLocAtLastSale ?? 0,
    lastSaleId: clientState.lastSaleId ?? null,
    // Permanent store (Slice 2). The store ranks (persist across
    // sales), the post-sale intermission with its frozen Starting
    // Capital quote (null outside a sale), and the favorited
    // open-source projects. Copied per entry so the save never shares
    // a reference with the live state. The intermission is copied
    // shallow (it is a flat record); the ranks are copied per track.
    permanentStoreRanks: { ...(clientState.permanentStoreRanks ?? {}) },
    prestigeIntermission: clientState.prestigeIntermission
      ? { ...clientState.prestigeIntermission }
      : null,
    favoriteOpenSourceProjects: [
      ...(clientState.favoriteOpenSourceProjects ?? []),
    ],
    // Timed golden-star buffs. A shallow copy of the array (the entries
    // are plain data); expired entries are dropped by the game tick.
    activeStarEffects: [...(clientState.activeStarEffects ?? [])],
    // In-game inbox (issue #31). Entries are plain data, copied per
    // entry; the inbox is capped at EMAIL_CONFIG.maxInboxEmails and the
    // oldest is dropped past it (see the email module).
    emails: (clientState.emails ?? []).map((entry) => ({ ...entry })),
    // Cosmetics (issue #11). The unlocked list only grows; the
    // equipped map is slot -> cosmeticId and changes freely.
    unlockedCosmetics: [...(clientState.unlockedCosmetics ?? [])],
    equippedCosmetics: { ...(clientState.equippedCosmetics ?? {}) },
    // Llama farm (issue #79). Owned, stalls (llama + lighting per
    // stall), and the unlocked types. Copied per stall so the save
    // never shares a reference with the live state.
    farm: {
      owned: clientState.farm?.owned ?? false,
      stalls: (clientState.farm?.stalls ?? []).map((stall) => ({
        llama: stall.llama ?? null,
        lighting: stall.lighting ?? "warm",
      })),
      unlockedTypes: [...(clientState.farm?.unlockedTypes ?? [])],
    },
    // Golden-star schedule (client-rolled now). The wall-clock time
    // the next natural star is due (null = no star scheduled) and the
    // wall-clock time the last StarBroker star was bought (null =
    // never bought). Persisted so the countdown and the buy cooldown
    // survive a reload; a missing value defaults to null.
    nextStarAtMs: clientState.nextStarAtMs ?? null,
    lastStarBuyAtMs: clientState.lastStarBuyAtMs ?? null,
    // SUBTRACTERALL (issue #150). Phase, remaining credited seconds,
    // the per-company use count, and the active use. Normalized (a
    // copy, never a shared reference; any pre-rework shape becomes the
    // fresh Ready state). The Overtime reskin setting persists across
    // sales.
    subtracterall: normalizeSubtracterallState(clientState.subtracterall),
    overtimeReskin: clientState.overtimeReskin ?? false,
    // Night Shift (issue #149): the purchased level, guarded to 0..5
    // (missing or NaN reads 0).
    nightShiftLevel: nightShiftLevelOf(clientState.nightShiftLevel),
    // Achievements (issue #132): sanitized on the way out, so a NaN
    // or missing counter is written as 0, never as null (JSON turns
    // NaN into null and the server's shape check would reject it).
    achievements: sanitizeAchievementsState(clientState.achievements),
  };
}

/**
 * Validate a save payload before it is written (issue #132): the
 * numeric balances must be finite and non-negative (a NaN would be
 * serialized as null and poison the save), and the achievements record
 * must pass the same shared shape rule the server applies. Returns an
 * error string, or null when the payload is safe to send.
 */
export function savePayloadError(saveState) {
  if (!saveState || typeof saveState !== "object") {
    return "save state must be an object";
  }
  for (const field of ["linesOfCode", "totalLinesOfCode", "money"]) {
    const value = saveState[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return `${field} must be a finite non-negative number`;
    }
  }
  return achievementsStateError(saveState.achievements);
}

/** Server flat save shape -> the saved game fields in client reducer shape. */
export function saveStateToGameFields(saveState) {
  return {
    linesOfCode: saveState.linesOfCode,
    totalLinesOfCode: saveState.totalLinesOfCode,
    money: saveState.money,
    // Prestige (Sell the Company, Slice 1). A save from before
    // prestige shipped has none of these fields — default them to the
    // fresh values here, the same way the server's normalizeSaveState
    // does on save. Lifetime LOC is the save's own totalLinesOfCode,
    // which the save already carries.
    lifetimeEquityEarned: saveState.lifetimeEquityEarned ?? 0,
    equitySpent: saveState.equitySpent ?? 0,
    saleCount: saveState.saleCount ?? 0,
    lifetimeLocAtLastSale: saveState.lifetimeLocAtLastSale ?? 0,
    lastSaleId: saveState.lastSaleId ?? null,
    // Permanent store (Slice 2). A save from before the store shipped
    // has none of these fields — default them to the fresh values
    // here, the same way the server's normalizeSaveState does on save:
    // no ranks owned, no intermission open, no favorites yet.
    permanentStoreRanks: { ...(saveState.permanentStoreRanks ?? {}) },
    prestigeIntermission: saveState.prestigeIntermission
      ? { ...saveState.prestigeIntermission }
      : null,
    favoriteOpenSourceProjects: [
      ...(saveState.favoriteOpenSourceProjects ?? []),
    ],
    employees: inflateCounts(saveState.employees),
    aiAssistants: { noPilot: { count: saveState.aiAssistants.noPilot } },
    // A save from before PR #78 shipped the four new freelance
    // projects has no key for a never-shipped one; default each missing
    // key to 0, the same way releaseManagerAssignments and
    // autoShipsCompleted do below. Without this, shipping a
    // never-shipped project reads `undefined`, and `undefined + 1` is
    // NaN, which poisons the count, the unlock total, and the save.
    freelanceProjectsCompleted: FREELANCE_PROJECT_KEYS.reduce((acc, key) => {
      acc[key] = saveState.freelanceProjectsCompleted?.[key] ?? 0;
      return acc;
    }, {}),
    // Release Manager assignments and cumulative auto-ship counts. A
    // save from before the Release Manager shipped has neither — default
    // them to all-zero here, the same way the server's
    // normalizeSaveState does on save. No manager assigned, none shipped.
    releaseManagerAssignments: FREELANCE_PROJECT_KEYS.reduce((acc, key) => {
      acc[key] = saveState.releaseManagerAssignments?.[key] ?? 0;
      return acc;
    }, {}),
    autoShipsCompleted: FREELANCE_PROJECT_KEYS.reduce((acc, key) => {
      acc[key] = saveState.autoShipsCompleted?.[key] ?? 0;
      return acc;
    }, {}),
    openSourceProjects: inflateLevels(saveState.openSourceProjects),
    // A save from before Project Manager / Commit Specialist shipped
    // has no latch for those types — the load path returns the raw
    // stored state, so derive each missing latch from the save's own
    // state here, the same way the server's normalizeSaveState does
    // on save. A veteran who already meets a new type's condition
    // gets it unlocked on load instead of locked behind a goal they
    // already cleared.
    unlockedEmployees: EMPLOYEE_TYPES.reduce((acc, key) => {
      acc[key] =
        saveState.unlockedEmployees?.[key] ??
        employeeUnlockConditionsMet(key, saveState);
      return acc;
    }, {}),
    // Constellation shipped unlocked, then gained a TOTAL_LOC >= 500
    // condition (star fix slice). A save from before the condition
    // carries latch=true with lifetime LOC below the threshold, so the
    // latch is re-derived from the save's own lifetime LOC here, the
    // same way the server's normalizeSaveState does on save — a
    // veteran at/above 500 LOC keeps the unlock, a veteran below it
    // gets it locked (with progress shown). The other two latches
    // were always condition-gated, so only Constellation needs this.
    // StarBroker is re-derived the same way: a save that predates it
    // gets its latch from its own lifetime LOC (TOTAL_LOC >= 5000)
    // instead of defaulting to locked behind a goal it already cleared.
    unlockedOpenSourceProjects: {
      ...saveState.unlockedOpenSourceProjects,
      constellation: openSourceUnlockConditionsMet(
        "constellation",
        saveState
      ),
      starBroker: openSourceUnlockConditionsMet("starBroker", saveState),
      // The doubling upgrades (issue #118): a save that predates
      // them has no latch for them, so each missing one comes from
      // the save's own employee counts (own 10 of that type) instead
      // of defaulting to locked behind a goal it already cleared.
      // Existing latches are trusted (??, not re-derived): these
      // projects ship with their conditions, so no stale latch can
      // exist, and the reducer maintains the latch from here on.
      coffeeScript:
        saveState.unlockedOpenSourceProjects?.coffeeScript ??
        openSourceUnlockConditionsMet("coffeeScript", saveState),
      juniorAchievement:
        saveState.unlockedOpenSourceProjects?.juniorAchievement ??
        openSourceUnlockConditionsMet("juniorAchievement", saveState),
      seniorMoment:
        saveState.unlockedOpenSourceProjects?.seniorMoment ??
        openSourceUnlockConditionsMet("seniorMoment", saveState),
      scrumMaster:
        saveState.unlockedOpenSourceProjects?.scrumMaster ??
        openSourceUnlockConditionsMet("scrumMaster", saveState),
      commitmentIssues:
        saveState.unlockedOpenSourceProjects?.commitmentIssues ??
        openSourceUnlockConditionsMet("commitmentIssues", saveState),
      shipHappens:
        saveState.unlockedOpenSourceProjects?.shipHappens ??
        openSourceUnlockConditionsMet("shipHappens", saveState),
    },
    // A save from before project unlocks shipped (issue #19) has no
    // freelance latch — the load path returns the raw stored state,
    // so derive it from the save's own shipped counts here, the same
    // way the server's normalizeSaveState does on save.
    unlockedFreelanceProjects: FREELANCE_PROJECT_KEYS.reduce((acc, key) => {
      acc[key] =
        saveState.unlockedFreelanceProjects?.[key] ??
        freelanceProjectUnlockConditionsMet(key, saveState);
      return acc;
    }, {}),
    activeStarEffects: [...(saveState.activeStarEffects ?? [])],
    emails: [...(saveState.emails ?? [])].map((entry) => ({ ...entry })),
    // A save from before cosmetics shipped (issue #11) has no
    // cosmetic fields — derive the unlocked list from the save's own
    // employee counts here, the same way the server's
    // normalizeSaveState does on save.
    unlockedCosmetics: saveState.unlockedCosmetics
      ? [...saveState.unlockedCosmetics]
      : deriveUnlockedCosmetics(saveState),
    equippedCosmetics: { ...(saveState.equippedCosmetics ?? {}) },
    // Llama farm (issue #79). A save from before the farm shipped has
    // no farm field — default it to the empty (unbought) farm here,
    // the same way the server's normalizeSaveState does on save. A
    // farm that predates the unlocked-types field gets its types
    // derived from the llamas actually in the stalls.
    farm: (() => {
      const farm = saveState.farm;
      if (!farm || typeof farm !== "object" || Array.isArray(farm)) {
        return {
          owned: false,
          stalls: Array.from({ length: FARM_CONFIG.stallCount }, () => ({
            llama: null,
            lighting: "warm",
          })),
          unlockedTypes: [],
        };
      }
      const stalls = (farm.stalls ?? []).map((stall) => ({
        llama: stall?.llama ?? null,
        lighting: stall?.lighting ?? "warm",
      }));
      const unlockedTypes = Array.isArray(farm.unlockedTypes)
        ? [...farm.unlockedTypes]
        : [...new Set(stalls.map((stall) => stall.llama).filter(Boolean))];
      return {
        owned: farm.owned ?? false,
        stalls,
        unlockedTypes,
      };
    })(),
    // Golden-star schedule (client-rolled now). A save from before
    // this slice has neither field — default both to null (no star
    // scheduled, never bought), the same way the server's
    // normalizeSaveState does on save. The star UI rolls a fresh
    // schedule on load when Constellation is unlocked.
    nextStarAtMs: saveState.nextStarAtMs ?? null,
    lastStarBuyAtMs: saveState.lastStarBuyAtMs ?? null,
    // SUBTRACTERALL (issue #150). A save from before it shipped, or
    // from before the rework (old tier / liability / tolerance
    // fields), loads as the fresh Ready state, the same way the
    // server's normalizeSaveState does on save. No migration. A
    // current-shape phase is kept as is: a load never cures a
    // withdrawal.
    subtracterall: normalizeSubtracterallState(saveState.subtracterall),
    overtimeReskin: saveState.overtimeReskin ?? false,
    // Night Shift (issue #149): a save from before it shipped reads 0.
    nightShiftLevel: nightShiftLevelOf(saveState.nightShiftLevel),
    // Achievements (issue #132): a save without a record restores a
    // fresh one (every tier locked, every counter 0).
    achievements: sanitizeAchievementsState(saveState.achievements),
  };
}

/** A zeroed actionsSinceLastSave (no actions since the last accepted save). */
export function emptyActions() {
  return {
    clicks: 0,
    employeesBought: EMPLOYEE_TYPES.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {}),
    projectsCompleted: FREELANCE_PROJECT_KEYS.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {}),
    // Release Manager auto-ships since the last accepted save, per
    // project. The engine derives this from the autoShipsCompleted
    // state delta (new - baseline), like projectsCompleted above —
    // the server rate-caps it against the assigned managers and the
    // ship interval.
    autoShips: FREELANCE_PROJECT_KEYS.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {}),
    openSourceLevelsBought: OPEN_SOURCE_IDS.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {}),
  };
}

/**
 * Per-key delta (current - baseline) for a flat count/level map.
 * The server checks these deltas against the snapshot deltas (rule 8),
 * so they must be derived from state, not counted from dispatches —
 * a dispatch the reducer rejects (e.g. buying with too little money)
 * must not be counted.
 */
export function diffCounts(baseline, current, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = (current[key] ?? 0) - (baseline[key] ?? 0);
    return acc;
  }, {});
}

/**
 * The fields that only change on a "big action" (hire, open-source
 * level, new email, cosmetic unlock/equip). Used to trigger a save on big actions. Project completions
 * (Ship) are deliberately NOT here: Ship is a rapid-fire action (the
 * player smashes it to sell LOC for cash as fast as possible), so
 * saving on every Ship would spam the 1s rate limit. Ship progress
 * is still saved by the 60s heartbeat and by the keepalive on tab
 * hide/unload. A new email IS here: mail arrives rarely (unlocks,
 * star rewards), and the inbox should persist promptly. A cosmetic
 * unlock/equip IS here too: the player chose it deliberately, and
 * the equipped icon should survive a tab close.
 */
export function bigActionFields(saveState) {
  return {
    employees: saveState.employees,
    openSourceProjects: saveState.openSourceProjects,
    emails: (saveState.emails ?? []).length,
    // Read state is part of the save, so the unread count is a
    // big-action field too: marking mail read (one email, or all of
    // them) saves promptly instead of waiting for the heartbeat.
    unreadEmails: unreadEmailCount(saveState.emails),
    // The unlocked list only grows; the equipped map is compared as
    // a string because any change (equip, unequip, switch) is a
    // big action.
    unlockedCosmetics: (saveState.unlockedCosmetics ?? []).length,
    equippedCosmetics: JSON.stringify(saveState.equippedCosmetics ?? {}),
    // Llama farm (issue #79): buying the farm, a kid being born, and a
    // lighting change are all big actions — the farm should persist
    // promptly instead of waiting for the heartbeat. The lighting is
    // compared as a string because any change (one stall's color) is a
    // big action, like an equipped cosmetic.
    farmOwned: saveState.farm?.owned ?? false,
    farmLlamas: (saveState.farm?.stalls ?? []).filter(
      (stall) => stall.llama !== null
    ).length,
    farmLighting: JSON.stringify(
      (saveState.farm?.stalls ?? []).map((stall) => stall.lighting ?? "warm")
    ),
    farmUnlockedTypes: (saveState.farm?.unlockedTypes ?? []).length,
    // Llama economy v2 (issue #129): which llama sits in which stall.
    // A move or a sale changes the layout, and both are deliberate
    // player actions (a sale moves money), so they save promptly.
    farmLayout: JSON.stringify(
      (saveState.farm?.stalls ?? []).map((stall) => stall.llama ?? null)
    ),
    // Release Manager assignments: changing an assignment is a
    // deliberate player choice (like an equip), so it saves promptly.
    // Compared as a string because any change (one project's count)
    // is a big action. The auto-ship COUNTS are deliberately NOT
    // here: auto-ships are ships, and Ship is not a big action
    // (rapid-fire) — the counts still persist via the heartbeat.
    releaseManagerAssignments: JSON.stringify(
      saveState.releaseManagerAssignments ?? {}
    ),
    // Golden-star schedule (client-rolled now): the next star's due
    // time and the last StarBroker buy time. A new schedule (a claim,
    // a despawn, the first roll after unlock) or a new buy is a
    // meaningful state change, so it saves promptly — the countdown
    // and the buy cooldown survive a tab close. Compared as raw
    // values (a timestamp, or null): any change is a big action.
    nextStarAtMs: saveState.nextStarAtMs ?? null,
    lastStarBuyAtMs: saveState.lastStarBuyAtMs ?? null,
    // Prestige (Sell the Company, Slice 1): the Equity books. A sale
    // changes them, but the sale saves through its own endpoint, not
    // through a big-action save — these are a safety net, so a future
    // path that moves them without saving still persists promptly.
    // Compared as raw values: any change is a big action.
    lifetimeEquityEarned: saveState.lifetimeEquityEarned ?? 0,
    equitySpent: saveState.equitySpent ?? 0,
    saleCount: saveState.saleCount ?? 0,
    lifetimeLocAtLastSale: saveState.lifetimeLocAtLastSale ?? 0,
    lastSaleId: saveState.lastSaleId ?? null,
    // Permanent store (Slice 2): the ranks and the intermission only
    // move through the store endpoints, not through a big-action save
    // — these are a safety net, like the Equity books above. The
    // favorites are a deliberate player choice, so any change (add,
    // remove, reorder) saves promptly, compared as a string.
    permanentStoreRanks: JSON.stringify(
      saveState.permanentStoreRanks ?? {}
    ),
    prestigeIntermission: JSON.stringify(
      saveState.prestigeIntermission ?? null
    ),
    favoriteOpenSourceProjects: JSON.stringify(
      saveState.favoriteOpenSourceProjects ?? []
    ),
    // SUBTRACTERALL (issue #150): activating (phase ready -> burst,
    // uses up) and toggling the Overtime reskin are deliberate
    // player choices, so they save promptly. The phase is here too,
    // so a phase flip (burst -> withdrawal, withdrawal -> ready)
    // persists promptly. The per-tick drift (remaining seconds) is
    // deliberately NOT here: it
    // moves every second during a phase, and saving on every tick
    // would spam the 1s rate limit. It persists via the 60s
    // heartbeat and the keepalive on tab hide/unload, the same as
    // the LOC balance.
    subtracterallPhase: saveState.subtracterall?.phase ?? "ready",
    subtracterallUses: saveState.subtracterall?.uses ?? 0,
    // Night Shift (issue #149): buying a level spends cash, so it saves
    // promptly.
    nightShiftLevel: nightShiftLevelOf(saveState.nightShiftLevel),
    overtimeReskin: saveState.overtimeReskin ?? false,
    // Achievements (issue #132): a newly earned tier is a big action,
    // so a permanent buff is never lost to a tab close. The per-action
    // counters (clicks, hires, peak LOC/s) ride along with whatever
    // save comes next.
    achievementTiers: achievementTiersEarned(saveState.achievements),
  };
}

/** True if a flat save state is exactly the fresh-player initial state. */
export function isInitialSaveState(saveState) {
  const initial = initialSaveState();
  if (
    saveState.linesOfCode !== initial.linesOfCode ||
    saveState.totalLinesOfCode !== initial.totalLinesOfCode ||
    saveState.money !== initial.money
  ) {
    return false;
  }
  for (const key of EMPLOYEE_TYPES) {
    if (saveState.employees[key] !== initial.employees[key]) return false;
    if (saveState.unlockedEmployees[key] !== initial.unlockedEmployees[key])
      return false;
  }
  if (saveState.aiAssistants.noPilot !== initial.aiAssistants.noPilot)
    return false;
  for (const key of FREELANCE_PROJECT_KEYS) {
    if (
      saveState.freelanceProjectsCompleted[key] !==
      initial.freelanceProjectsCompleted[key]
    )
      return false;
    if (
      saveState.unlockedFreelanceProjects[key] !==
      initial.unlockedFreelanceProjects[key]
    )
      return false;
    // Release Manager: a fresh save has no managers assigned and
    // none auto-shipped.
    if ((saveState.releaseManagerAssignments?.[key] ?? 0) !== 0) return false;
    if ((saveState.autoShipsCompleted?.[key] ?? 0) !== 0) return false;
  }
  for (const key of OPEN_SOURCE_IDS) {
    if (saveState.openSourceProjects[key] !== initial.openSourceProjects[key])
      return false;
    if (
      saveState.unlockedOpenSourceProjects[key] !==
      initial.unlockedOpenSourceProjects[key]
    )
      return false;
  }
  if ((saveState.activeStarEffects ?? []).length !== 0) return false;
  if ((saveState.emails ?? []).length !== 0) return false;
  if ((saveState.unlockedCosmetics ?? []).length !== 0) return false;
  if (Object.keys(saveState.equippedCosmetics ?? {}).length !== 0)
    return false;
  // Llama farm (issue #79): a fresh save has not bought the farm.
  if (saveState.farm?.owned) return false;
  if ((saveState.farm?.stalls ?? []).some((stall) => stall.llama !== null))
    return false;
  if ((saveState.farm?.unlockedTypes ?? []).length !== 0) return false;
  // Golden-star schedule (client-rolled now): a fresh save has no
  // star scheduled and has never bought one.
  if ((saveState.nextStarAtMs ?? null) !== null) return false;
  if ((saveState.lastStarBuyAtMs ?? null) !== null) return false;
  // Prestige (Sell the Company, Slice 1): a fresh save has earned no
  // Equity, spent none, sold never, and counts Company LOC from zero.
  if ((saveState.lifetimeEquityEarned ?? 0) !== 0) return false;
  if ((saveState.equitySpent ?? 0) !== 0) return false;
  if ((saveState.saleCount ?? 0) !== 0) return false;
  if ((saveState.lifetimeLocAtLastSale ?? 0) !== 0) return false;
  if ((saveState.lastSaleId ?? null) !== null) return false;
  // Permanent store (Slice 2): a fresh save owns no store ranks, has
  // no intermission open, and has favorited nothing.
  if (
    Object.values(saveState.permanentStoreRanks ?? {}).some(
      (rank) => rank !== 0
    )
  )
    return false;
  if ((saveState.prestigeIntermission ?? null) !== null) return false;
  if ((saveState.favoriteOpenSourceProjects ?? []).length !== 0)
    return false;
  // SUBTRACTERALL (issue #150): a fresh save has never used it:
  // Ready phase, no uses, and the reskin off.
  if ((saveState.subtracterall?.phase ?? "ready") !== "ready") return false;
  if ((saveState.subtracterall?.uses ?? 0) !== 0) return false;
  if ((saveState.overtimeReskin ?? false) !== false) return false;
  // Night Shift (issue #149): any purchased level is progress.
  if (nightShiftLevelOf(saveState.nightShiftLevel) !== 0) return false;
  // Achievements (issue #132): any earned tier or counter is progress.
  const achievements = sanitizeAchievementsState(saveState.achievements);
  if (achievementTiersEarned(achievements) !== 0) return false;
  if (achievements.clicks !== 0 || achievements.peakLocPerSecond !== 0) {
    return false;
  }
  for (const map of [
    achievements.hires,
    achievements.llamasBought,
    achievements.llamasSold,
  ]) {
    if (Object.values(map).some((count) => count !== 0)) return false;
  }
  return true;
}

/** True if a big action happened between `prev` and `next`. Employee
 * and open-source counts only count upward (a hire, a level); the
 * inbox counts ANY count change — a new email arriving AND a deleted
 * email both persist via a big-action save. */
export function bigActionIncreased(prev, next) {
  if (!prev) return false;
  for (const key of EMPLOYEE_TYPES) {
    if ((next.employees[key] ?? 0) > (prev.employees[key] ?? 0)) return true;
  }
  for (const key of OPEN_SOURCE_IDS) {
    if (
      (next.openSourceProjects[key] ?? 0) > (prev.openSourceProjects[key] ?? 0)
    )
      return true;
  }
  if ((next.emails ?? 0) !== (prev.emails ?? 0)) return true;
  if ((next.unreadEmails ?? 0) !== (prev.unreadEmails ?? 0)) return true;
  if ((next.unlockedCosmetics ?? 0) > (prev.unlockedCosmetics ?? 0))
    return true;
  // Equipping is not a count — any change (equip, unequip, switch)
  // is a big action.
  if ((next.equippedCosmetics ?? "") !== (prev.equippedCosmetics ?? ""))
    return true;
  // Llama farm (issue #79): buying the farm, a kid being born, a new
  // type being unlocked, or a lighting change all persist promptly.
  if ((next.farmOwned ?? false) !== (prev.farmOwned ?? false)) return true;
  if ((next.farmLlamas ?? 0) > (prev.farmLlamas ?? 0)) return true;
  if ((next.farmUnlockedTypes ?? 0) > (prev.farmUnlockedTypes ?? 0))
    return true;
  if ((next.farmLighting ?? "") !== (prev.farmLighting ?? "")) return true;
  if ((next.farmLayout ?? "") !== (prev.farmLayout ?? "")) return true;
  // Release Manager assignments: any change (one project's count) is
  // a big action, like an equip.
  if (
    (next.releaseManagerAssignments ?? "") !==
    (prev.releaseManagerAssignments ?? "")
  )
    return true;
  // Golden-star schedule (client-rolled now): any change to the next
  // star's due time (a claim, a despawn, the first roll) or to the
  // last buy time is a big action, like an equip.
  if ((next.nextStarAtMs ?? null) !== (prev.nextStarAtMs ?? null))
    return true;
  if ((next.lastStarBuyAtMs ?? null) !== (prev.lastStarBuyAtMs ?? null))
    return true;
  // Prestige (Sell the Company, Slice 1): any change to the Equity
  // books is a big action. The sale itself saves through its own
  // endpoint, so this is a safety net for any other path that moves
  // them — the books must never wait for the heartbeat.
  if ((next.lifetimeEquityEarned ?? 0) !== (prev.lifetimeEquityEarned ?? 0))
    return true;
  if ((next.equitySpent ?? 0) !== (prev.equitySpent ?? 0)) return true;
  if ((next.saleCount ?? 0) !== (prev.saleCount ?? 0)) return true;
  if (
    (next.lifetimeLocAtLastSale ?? 0) !== (prev.lifetimeLocAtLastSale ?? 0)
  )
    return true;
  if ((next.lastSaleId ?? null) !== (prev.lastSaleId ?? null)) return true;
  // Permanent store (Slice 2): any change to the ranks or the
  // intermission is a big action (safety net — the store endpoints
  // save themselves), and any change to the favorites is one too,
  // like an equip.
  if (
    (next.permanentStoreRanks ?? "") !== (prev.permanentStoreRanks ?? "")
  )
    return true;
  if (
    (next.prestigeIntermission ?? "") !== (prev.prestigeIntermission ?? "")
  )
    return true;
  if (
    (next.favoriteOpenSourceProjects ?? "") !==
    (prev.favoriteOpenSourceProjects ?? "")
  )
    return true;
  // SUBTRACTERALL (issue #150): an activation (phase or use count
  // changed), a phase flipped, or the reskin toggled. The per-tick
  // drift (remaining seconds) is not a big
  // action — see bigActionFields.
  if (
    (next.subtracterallPhase ?? "ready") !==
    (prev.subtracterallPhase ?? "ready")
  )
    return true;
  if (
    (next.subtracterallUses ?? 0) !== (prev.subtracterallUses ?? 0)
  )
    return true;
  if ((next.nightShiftLevel ?? 0) !== (prev.nightShiftLevel ?? 0)) return true;
  if ((next.overtimeReskin ?? false) !== (prev.overtimeReskin ?? false))
    return true;
  if ((next.achievementTiers ?? 0) > (prev.achievementTiers ?? 0)) return true;
  return false;
}
