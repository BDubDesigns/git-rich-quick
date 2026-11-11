/**
 * State mapping between the client's reducer state and the server's flat
 * save shape (Slice 2).
 *
 * The client stores counts as `{ type: { count } }` and levels as
 * `{ id: { level } }`; the server stores flat maps (`{ type: count }`,
 * `{ id: level }`). These are thin adapters — the numbers come from the
 * reducer, never invented here.
 *
 * The 14 game fields are saved, including the timed golden-star buffs
 * (activeStarEffects), the in-game inbox (emails, issue #31), and the
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

/** Client reducer state -> the flat 14-field save shape the server stores. */
export function stateToSaveState(clientState) {
  return {
    linesOfCode: clientState.linesOfCode,
    totalLinesOfCode: clientState.totalLinesOfCode,
    money: clientState.money,
    employees: flatCounts(clientState.employees),
    aiAssistants: { noPilot: clientState.aiAssistants.noPilot.count },
    freelanceProjectsCompleted: { ...clientState.freelanceProjectsCompleted },
    openSourceProjects: flatLevels(clientState.openSourceProjects),
    unlockedEmployees: { ...clientState.unlockedEmployees },
    unlockedOpenSourceProjects: { ...clientState.unlockedOpenSourceProjects },
    unlockedFreelanceProjects: { ...clientState.unlockedFreelanceProjects },
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
  };
}

/** Server flat save shape -> the 14 game fields in client reducer shape. */
export function saveStateToGameFields(saveState) {
  return {
    linesOfCode: saveState.linesOfCode,
    totalLinesOfCode: saveState.totalLinesOfCode,
    money: saveState.money,
    employees: inflateCounts(saveState.employees),
    aiAssistants: { noPilot: { count: saveState.aiAssistants.noPilot } },
    freelanceProjectsCompleted: { ...saveState.freelanceProjectsCompleted },
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
    openSourceLevelsBought: OPEN_SOURCE_IDS.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {}),
    // Golden-star claims since the last accepted save. The server
    // validates each claim (effect unlocked, amounts in range, count
    // capped by the spawn rate) and credits it in the LOC/money rules.
    starClaims: [],
    // Farm breed claims since the last accepted save (issue #79
    // feedback). The server validates each claim's kids against a
    // server-issued breed outcome; any new llama that is not a matched
    // breed kid must be a bought base llama.
    farmBreedClaims: [],
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
 * saving on every Ship would spam the 10s rate limit. Ship progress
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
  return false;
}
