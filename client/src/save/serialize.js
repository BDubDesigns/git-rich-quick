/**
 * State mapping between the client's reducer state and the server's flat
 * save shape (Slice 2).
 *
 * The client stores counts as `{ type: { count } }` and levels as
 * `{ id: { level } }`; the server stores flat maps (`{ type: count }`,
 * `{ id: level }`). These are thin adapters — the numbers come from the
 * reducer, never invented here.
 *
 * Only the 9 game fields are saved. UI state (activeTab, selectedPanes,
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
    acc[key] = nested[key].level;
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
    acc[key] = { level: flat[key] };
    return acc;
  }, {});
}

/** Client reducer state -> the flat 9-field save shape the server stores. */
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
  };
}

/** Server flat save shape -> the 9 game fields in client reducer shape. */
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
 * The three fields that only change on a "big action" (hire, project
 * completion, open-source level). Used to trigger a save on big actions.
 */
export function bigActionFields(saveState) {
  return {
    employees: saveState.employees,
    freelanceProjectsCompleted: saveState.freelanceProjectsCompleted,
    openSourceProjects: saveState.openSourceProjects,
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
  return true;
}

/** True if any big-action field in `next` is larger than in `prev`. */
export function bigActionIncreased(prev, next) {
  if (!prev) return false;
  for (const key of EMPLOYEE_TYPES) {
    if ((next.employees[key] ?? 0) > (prev.employees[key] ?? 0)) return true;
  }
  for (const key of FREELANCE_PROJECT_KEYS) {
    if (
      (next.freelanceProjectsCompleted[key] ?? 0) >
      (prev.freelanceProjectsCompleted[key] ?? 0)
    )
      return true;
  }
  for (const key of OPEN_SOURCE_IDS) {
    if (
      (next.openSourceProjects[key] ?? 0) > (prev.openSourceProjects[key] ?? 0)
    )
      return true;
  }
  return false;
}
