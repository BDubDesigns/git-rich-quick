/**
 * State mapping between the client's reducer state and the server's flat
 * save shape (Slice 2).
 *
 * The client stores counts as `{ type: { count } }` and levels as
 * `{ id: { level } }`; the server stores flat maps (`{ type: count }`,
 * `{ id: level }`). These are thin adapters — the numbers come from the
 * reducer, never invented here.
 *
 * The 11 game fields are saved, including the timed golden-star buffs
 * (activeStarEffects) and the in-game inbox (emails, issue #31). UI state (activeTab, selectedPanes,
 * clickHistory, currentCPS, uiState) is NOT saved and is reset to the
 * initial values on restore.
 */

import {
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  initialSaveState,
} from "../../../shared/game-balance.js";

function flatCounts(nested) {
  return EMPLOYEE_TYPES.reduce((acc, key) => {
    acc[key] = nested[key].count;
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
    acc[key] = { count: flat[key] };
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

/** Client reducer state -> the flat 11-field save shape the server stores. */
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
    // Timed golden-star buffs. A shallow copy of the array (the entries
    // are plain data); expired entries are dropped by the game tick.
    activeStarEffects: [...(clientState.activeStarEffects ?? [])],
    // In-game inbox (issue #31). Entries are plain data, copied per
    // entry; the inbox is capped at EMAIL_CONFIG.maxInboxEmails and the
    // oldest is dropped past it (see the email module).
    emails: (clientState.emails ?? []).map((entry) => ({ ...entry })),
  };
}

/** Server flat save shape -> the 11 game fields in client reducer shape. */
export function saveStateToGameFields(saveState) {
  return {
    linesOfCode: saveState.linesOfCode,
    totalLinesOfCode: saveState.totalLinesOfCode,
    money: saveState.money,
    employees: inflateCounts(saveState.employees),
    aiAssistants: { noPilot: { count: saveState.aiAssistants.noPilot } },
    freelanceProjectsCompleted: { ...saveState.freelanceProjectsCompleted },
    openSourceProjects: inflateLevels(saveState.openSourceProjects),
    unlockedEmployees: { ...saveState.unlockedEmployees },
    unlockedOpenSourceProjects: { ...saveState.unlockedOpenSourceProjects },
    activeStarEffects: [...(saveState.activeStarEffects ?? [])],
    emails: [...(saveState.emails ?? [])].map((entry) => ({ ...entry })),
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
 * level, new email). Used to trigger a save on big actions. Project completions
 * (Ship) are deliberately NOT here: Ship is a rapid-fire action (the
 * player smashes it to sell LOC for cash as fast as possible), so
 * saving on every Ship would spam the 10s rate limit. Ship progress
 * is still saved by the 60s heartbeat and by the keepalive on tab
 * hide/unload. A new email IS here: mail arrives rarely (unlocks,
 * star rewards), and the inbox should persist promptly.
 */
export function bigActionFields(saveState) {
  return {
    employees: saveState.employees,
    openSourceProjects: saveState.openSourceProjects,
    emails: (saveState.emails ?? []).length,
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
  return true;
}

/** True if any big-action field in `next` is larger than in `prev`. */
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
  if ((next.emails ?? 0) > (prev.emails ?? 0)) return true;
  return false;
}
