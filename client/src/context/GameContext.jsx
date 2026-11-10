import {
  useReducer,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";

// Server-authoritative saves (Slice 2, guest-only). The engine is
// framework-free; the provider owns it because it owns the reducer state
// the engine reads and restores.
import { SaveSync } from "../save/saveSync.js";
import { saveStateToGameFields } from "../save/serialize.js";

// Shared balance numbers — the reducer uses them for bulk pricing
// (BUY_EMPLOYEE). Display configs live in gameConfig.js.
import * as shared from "../../../shared/game-balance.js";

// Game configs (immutable display + balance data) and pure helpers.
// Configs and helpers live in their own modules so this file only
// exports the context object and the provider component (react-refresh).
import {
  GAME_BALANCE_CONFIG,
  NAV_TABS,
  EMPLOYEE_CONFIGS,
  FREELANCE_PROJECTS_CONFIG,
  OPEN_SOURCE_PROJECTS_CONFIG,
} from "./gameConfig.js";
import {
  calculateLOCPerClick,
  calculateCPS,
  calculateLOCPerSecond,
  isEmployeeUnlocked,
  isOpenSourceProjectUnlocked,
  flatEmployeeCounts,
} from "./gameLogic.js";
import { GameContext } from "./gameContext.js";

// Initial state of the game
// All monetary values are in CENTS to avoid floating-point errors
// Initial values are derived from GAME_BALANCE_CONFIG
const initialState = {
  // Core currencies
  linesOfCode: GAME_BALANCE_CONFIG.STARTING_LOC,
  totalLinesOfCode: 0, // cumulative LOC written over time, never decreases
  money: GAME_BALANCE_CONFIG.STARTING_MONEY,
  activeTab: "shop", // can be "shop", "projects", or "openSource"
  // Desktop pane configuration (hardcoded now, will be dynamic later)
  selectedPanes: {
    left: "shop",
    right: "projects",
  },
  // Click tracking for CPS calculation
  clickHistory: [], // Array of timestamps: [{ timestamp: Date.now(), count: 1 }, ...]
  currentCPS: 0, // Cached CPS for display

  // Permanent unlock tracking (the latch)
  // Dynamically generated: employees with no unlock conditions start unlocked,
  // employees with conditions start locked
  unlockedEmployees: Object.keys(EMPLOYEE_CONFIGS).reduce((acc, key) => {
    const config = EMPLOYEE_CONFIGS[key];
    acc[key] = !config.unlockConditions || config.unlockConditions.length === 0;
    return acc;
  }, {}),

  // Employees (count only - config comes from EMPLOYEE_CONFIGS)
  employees: Object.keys(EMPLOYEE_CONFIGS).reduce((acc, key) => {
    acc[key] = { count: 0 };
    return acc;
  }, {}),

  // AI Assistants (count only - config comes from AI_ASSISTANT_CONFIGS)
  aiAssistants: {
    // eventually these will be populated from AI_ASSISTANT_CONFIGS
    // dynamically, but for now, for testing, we hard code
    noPilot: { count: 0 },
  },

  freelanceProjectsCompleted: Object.keys(FREELANCE_PROJECTS_CONFIG).reduce(
    (acc, key) => {
      acc[key] = 0;
      return acc;
    },
    {}
  ),
  openSourceProjects: Object.keys(OPEN_SOURCE_PROJECTS_CONFIG).reduce(
    (acc, key) => {
      acc[key] = { level: 0 };
      return acc;
    },
    {}
  ),
  unlockedOpenSourceProjects: Object.keys(OPEN_SOURCE_PROJECTS_CONFIG).reduce(
    (acc, key) => {
      const config = OPEN_SOURCE_PROJECTS_CONFIG[key];
      // Only unlocked if NO conditions, otherwise starts locked
      acc[key] =
        !config.unlockConditions || config.unlockConditions.length === 0;
      return acc;
    },
    {}
  ),

  uiState: {
    sections: {
      shop: { isDescriptionVisible: true },
      projects: { isDescriptionVisible: true },
      openSource: { isDescriptionVisible: true },
      settings: { isDescriptionVisible: true },
    },
  },
};

function gameReducer(state, action) {
  switch (action.type) {
    // Player changes active tab (shop, projects, or openSource)
    case "SET_ACTIVE_TAB": {
      const { tab } = action.payload;
      const validTabs = NAV_TABS.map((t) => t.id);
      const activeTab = validTabs.includes(tab) ? tab : "shop";
      if (!validTabs.includes(tab)) {
        console.warn(`Invalid tab: ${tab}. Defaulting to shop.`);
      }
      return { ...state, activeTab };
    }
    // Player clicks the "Write Code" button
    case "WRITE_CODE": {
      const locPerClick = calculateLOCPerClick(state);
      // Update click history for CPS calculation
      const newClickHistory = [...state.clickHistory, Date.now()];
      // Clean up old clicks (older than 10 seconds to save memory)
      // We are saving more than 1 second for history to allow players to choose
      // longer timeframes for CPS if desired in future features
      const cleanedHistory = newClickHistory.filter(
        (ts) => ts > Date.now() - 10000
      );
      // Build newState with all changes from this action
      const newState = {
        ...state,
        linesOfCode: state.linesOfCode + locPerClick,
        totalLinesOfCode: state.totalLinesOfCode + locPerClick,
        clickHistory: cleanedHistory,
        currentCPS: calculateCPS(cleanedHistory),
      };

      // Check for unlocks instantly (not waiting for GAME_TICK)
      // Writing code could trigger unlocks so we run both unlock checks
      return {
        ...newState,
        unlockedEmployees: updateUnlockLatch(newState),
        unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
      };
    }
    // Buy employee(s) (intern, junior, or senior). `quantity` is the
    // bulk-buy amount from the Shop selector (default 1). The total
    // cost is the sum of the next `quantity` individual costs — each
    // successive hire costs more — computed by the same shared helper
    // the save server uses for money accounting (rule 7), so the
    // displayed price and the charged price can never disagree.
    case "BUY_EMPLOYEE": {
      const { employeeType, quantity = 1 } = action.payload;
      const config = EMPLOYEE_CONFIGS[employeeType];
      const employee = state.employees[employeeType];

      // Validate employee type exists
      if (!config || !employee) {
        console.warn(`Unknown employee type: ${employeeType}`);
        return state;
      }
      // Check if employee is unlocked
      if (!isEmployeeUnlocked(employeeType, state)) {
        console.warn(`Attempted to buy locked employee: ${employeeType}`);
        return state;
      }

      // Total cost for `quantity` hires, starting from the owned count.
      const totalCost = shared
        .employeePurchaseCosts(employeeType, employee.count, quantity)
        .reduce((sum, cost) => sum + cost, 0);

      // Check if player has enough money, if so run the purchase
      if (state.money >= totalCost) {
        // Build newState with all changes from this action
        const newState = {
          ...state,
          money: state.money - totalCost,
          employees: {
            ...state.employees,
            [employeeType]: {
              ...employee,
              count: employee.count + quantity,
            },
          },
        };

        // Check for unlocks instantly (buying changed employee count)
        return {
          ...newState,
          unlockedEmployees: updateUnlockLatch(newState),
          unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
        };
      }

      return state;
    }

    // Handle freelance project completion
    case "COMPLETE_PROJECT": {
      // deconstruct projectKey and get project data from config
      const { projectKey } = action.payload;
      const project = FREELANCE_PROJECTS_CONFIG[projectKey];

      // Validate project exists
      if (!project) {
        console.warn(`Unknown project key: ${projectKey}`);
        return state;
      }

      // Check if player has enough LOC to complete the project if so, run completion
      if (state.linesOfCode >= project.loc) {
        return {
          ...state,
          linesOfCode: state.linesOfCode - project.loc,
          money: state.money + project.reward,
          freelanceProjectsCompleted: {
            ...state.freelanceProjectsCompleted,
            [projectKey]: state.freelanceProjectsCompleted[projectKey] + 1,
          },
        };
      } else {
        // Not enough LOC
        return state;
      }
    }

    // Game tick: called every second to generate LOC from employees
    case "GAME_TICK": {
      const totalPassiveLOC = calculateLOCPerSecond(state);
      const cleanedHistory = state.clickHistory.filter(
        (ts) => ts > Date.now() - 10000
      );

      // Build newState with all changes from this action
      const newState = {
        ...state,
        linesOfCode: state.linesOfCode + totalPassiveLOC,
        totalLinesOfCode: state.totalLinesOfCode + totalPassiveLOC,
        clickHistory: cleanedHistory,
        currentCPS: calculateCPS(cleanedHistory),
      };

      // Check for unlocks (same centralized helper as WRITE_CODE and BUY_EMPLOYEE)
      // Employees generating LOC could trigger unlocks
      return {
        ...newState,
        unlockedEmployees: updateUnlockLatch(newState),
        unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
      };
    }

    // contribute to open source project
    case "CONTRIBUTE_TO_PROJECT": {
      // deconstruct projectId from action payload
      const { projectId } = action.payload;
      // get project state and config
      const projectState = state.openSourceProjects[projectId];
      const projectConfig = OPEN_SOURCE_PROJECTS_CONFIG[projectId];

      // check if there is a next level
      if (projectState.level >= projectConfig.levels.length) {
        return state; // already max level, return state unchanged
      }

      // check if project is unlocked
      if (!isOpenSourceProjectUnlocked(projectId, state)) {
        console.warn(`Attempted to contribute to locked project: ${projectId}`);
        return state;
      }

      // get next level config
      const nextLevelConfig = projectConfig.levels[projectState.level];
      const cost = nextLevelConfig.locCost;
      // check if player has enough LOC to contribute
      if (state.linesOfCode < cost) {
        console.warn(`Not enough LOC to contribute to project: ${projectId}`);
        return state; // not enough LOC, return state unchanged
      }

      // deduct LOC cost and increase project level
      return {
        ...state,
        linesOfCode: state.linesOfCode - cost,
        openSourceProjects: {
          ...state.openSourceProjects,
          [projectId]: {
            ...projectState,
            level: projectState.level + 1,
          },
        },
      };
    }

    case "TOGGLE_SECTION_DESC_VISIBILITY": {
      const { sectionId } = action.payload;
      return {
        ...state,
        uiState: {
          ...state.uiState,
          sections: {
            ...state.uiState.sections,
            [sectionId]: {
              ...state.uiState.sections[sectionId],
              isDescriptionVisible:
                !state.uiState.sections[sectionId].isDescriptionVisible,
            },
          },
        },
      };
    }

    // Restore the game fields from a server snapshot (initial load, or a
    // 409 revert to the last good state). UI state (active tab, panes) is
    // preserved; only the saved game fields are replaced. Click history is
    // display-only, so it resets.
    case "RESTORE_SAVE": {
      const { state: saveState } = action.payload;
      return {
        ...state,
        ...saveStateToGameFields(saveState),
        clickHistory: [],
        currentCPS: 0,
      };
    }

    // if action type doesn't make sense, just return current state
    default: {
      return state;
    }
  }
}

/**
 * Checks if a single unlock condition is satisfied by the current game state.
 *
 * This is a pure function (no side effects). It evaluates a condition
 * and returns whether it's met, without modifying state.
 *
 * Used internally by areUnlockConditionsMet(). NOT exported.
 *
 * @param {Object} condition - The condition to check
 * @param {string} condition.type - Type of condition (e.g., "TOTAL_LOC", "TOTAL_EMPLOYEE_COUNT", "SPECIFIC_EMPLOYEE_COUNT")
 * @param {number} condition.target - The threshold value
 * @param {Object} state - The game state to check against
 * @returns {boolean} True if condition is satisfied, false otherwise
 *
 * @private
 */
function checkCondition(condition, state) {
  // Shared evaluation, same as the save server's. Unknown condition types
  // fail closed (locked) — a config typo surfaces as a stuck unlock in
  // testing, never as a silent unlock to the wrong conditions.
  return shared.conditionMet(condition, {
    totalLinesOfCode: state.totalLinesOfCode,
    employees: flatEmployeeCounts(state),
  });
}

/**
 * Checks if all unlock conditions for an employee type are currently satisfied.
 *
 * This function is called by updateUnlockLatch() to determine if an unlock
 * should be latched. It checks the actual game state against the unlock rules.
 *
 * Used internally by updateUnlockLatch(). NOT exported (components can't call this).
 * Components should call isEmployeeUnlocked() instead.
 *
 * @param {string} employeeType - The employee type to check (e.g., "intern", "junior", "senior")
 * @param {Object} state - The game state
 * @returns {boolean} True if all conditions are met, false otherwise
 *
 * @private
 */
function areUnlockConditionsMet(employeeType, state) {
  const config = EMPLOYEE_CONFIGS[employeeType];

  if (!config) {
    console.warn(`Unknown employee type: ${employeeType}`);
    return false;
  }

  // If no unlock conditions defined, employee is always unlocked
  if (!config.unlockConditions || config.unlockConditions.length === 0) {
    return true;
  }

  // ALL conditions must be met (AND logic)
  return config.unlockConditions.every((condition) =>
    checkCondition(condition, state)
  );
}

/**
 * Updates the unlock latch, checking if any new employees should be unlocked.
 *
 * This is the CENTRALIZED unlock logic. It's called from EVERY reducer case
 * that could trigger an unlock (WRITE_CODE, BUY_EMPLOYEE, GAME_TICK).
 *
 * This function takes the *new* state (with all action-specific changes applied)
 * and checks conditions against it. If any new unlocks should happen, it latches them.
 *
 * Returns the updated unlockedEmployees object to be merged into the final state.
 * If no new unlocks occurred, returns the original unlockedEmployees (to prevent
 * unnecessary re-renders from new object references).
 *
 * @param {Object} state - The NEW game state (after action changes have been applied)
 * @returns {Object} The updated unlockedEmployees object (or original if no changes)
 *
 * @private
 */
function updateUnlockLatch(state) {
  const newUnlockedEmployees = { ...state.unlockedEmployees };
  let hasNewUnlock = false;

  // Only check LOCKED employees for new unlocks. Once an employee is unlocked,
  // the latch is permanent and we never need to check them again.
  // This avoids unnecessary condition evaluations on every GAME_TICK, WRITE_CODE, and BUY_EMPLOYEE.
  const lockedEmployees = Object.keys(EMPLOYEE_CONFIGS).filter(
    (employeeType) => !state.unlockedEmployees[employeeType]
  );

  for (const employeeType of lockedEmployees) {
    // Conditions are now met, latch it
    if (areUnlockConditionsMet(employeeType, state)) {
      newUnlockedEmployees[employeeType] = true;
      hasNewUnlock = true;
    }
  }

  // Return updated object if new unlocks occurred, otherwise return original
  // (to prevent unnecessary re-renders from object reference changes)
  return hasNewUnlock ? newUnlockedEmployees : state.unlockedEmployees;
}
/**
 * Checks if all unlock conditions for an open source project are currently satisfied.
 *
 * @param {string} projectId - The project ID
 * @param {Object} state - The game state
 * @returns {boolean} True if all conditions are met, false otherwise
 *
 * @private
 */
function areOpenSourceUnlockConditionsMet(projectId, state) {
  const config = OPEN_SOURCE_PROJECTS_CONFIG[projectId];

  if (!config) {
    console.warn(`Unknown project ID: ${projectId}`);
    return false;
  }

  // If no unlock conditions defined, project is always unlocked
  if (!config.unlockConditions || config.unlockConditions.length === 0) {
    return true;
  }

  // ALL conditions must be met (AND logic)
  return config.unlockConditions.every((condition) =>
    checkCondition(condition, state)
  );
}

/**
 * Updates the unlock latch for open source projects, checking if any should be unlocked.
 *
 * Called from WRITE_CODE, BUY_EMPLOYEE, and GAME_TICK (same as employees).
 * Checks only LOCKED projects for new unlocks. Once unlocked, permanent.
 *
 * @param {Object} state - The NEW game state (after action changes)
 * @returns {Object} Updated unlockedOpenSourceProjects object (or original if no changes)
 *
 * @private
 */
function updateOpenSourceUnlockLatch(state) {
  const newUnlockedProjects = { ...state.unlockedOpenSourceProjects };
  let hasNewUnlock = false;

  // Only check LOCKED projects for new unlocks
  const lockedProjects = Object.keys(OPEN_SOURCE_PROJECTS_CONFIG).filter(
    (projectId) => !state.unlockedOpenSourceProjects[projectId]
  );

  for (const projectId of lockedProjects) {
    // Conditions are now met, latch it
    if (areOpenSourceUnlockConditionsMet(projectId, state)) {
      newUnlockedProjects[projectId] = true;
      hasNewUnlock = true;
    }
  }

  // Return updated object if new unlocks occurred, otherwise return original
  return hasNewUnlock ? newUnlockedProjects : state.unlockedOpenSourceProjects;
}

// GameProvider component to wrap the app and provide game state
export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const stateRef = useRef(state);
  const [saveStatus, setSaveStatus] = useState("loading");
  const [savePlayerId, setSavePlayerId] = useState(null);
  // When the last save was accepted (ms since epoch); null until a save
  // is accepted this session, or init loads an existing save (whose
  // savedAt is reported the same way). Drives the footer's "Saved Xs ago".
  const [lastSavedAt, setLastSavedAt] = useState(null);
  // Seconds until a rate-limited save retries; null when no retry is
  // pending. Drives the footer's "Retrying in Ns" countdown.
  const [retryInSeconds, setRetryInSeconds] = useState(null);

  // Keep a ref to the latest state for the save engine (avoids stale closures).
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // The save engine (guest-only, Slice 2). Created once; the provider owns
  // it because it owns the reducer state the engine reads and restores.
  const saveSyncRef = useRef(null);
  if (saveSyncRef.current === null) {
    saveSyncRef.current = new SaveSync({
      getState: () => stateRef.current,
      restore: (saveState) =>
        dispatch({ type: "RESTORE_SAVE", payload: { state: saveState } }),
      onStatus: (status) => setSaveStatus(status),
      onPlayerId: (id) => setSavePlayerId(id),
      onSavedAt: (timestampMs) => setLastSavedAt(timestampMs),
      onRetry: (seconds) => setRetryInSeconds(seconds),
    });
  }

  // Force an immediate save (the footer's "Save now" button), bypassing the
  // 60s heartbeat. The engine serializes, so calling while a save is in
  // flight just queues one after it.
  const saveNow = useCallback(() => {
    saveSyncRef.current.requestSave("manual");
  }, []);

  // Wrap dispatch so clicks are counted exactly. WRITE_CODE always applies
  // (it unconditionally adds LOC), so counting it here is exact; hires,
  // projects, and open-source levels are derived from state deltas by the
  // engine instead, so a reducer-rejected action is never counted.
  const trackedDispatch = useCallback(
    (action) => {
      dispatch(action);
      if (action.type === "WRITE_CODE") {
        saveSyncRef.current.recordClick();
      }
    },
    [dispatch]
  );

  // Start the save loop (mint/load, then the 60s heartbeat + page-hide saves).
  useEffect(() => {
    const engine = saveSyncRef.current;
    let cancelled = false;
    engine.start().catch((err) => {
      if (!cancelled) console.error("[save] failed to start:", err);
    });
    return () => {
      cancelled = true;
      engine.stop();
    };
  }, []);

  // Tell the engine about every state change so it can save on big actions
  // (a hire, a project completion, an open-source level).
  useEffect(() => {
    saveSyncRef.current.noteState(state);
  }, [state]);

  return (
    <GameContext.Provider
      value={{
        state,
        dispatch: trackedDispatch,
        saveStatus,
        savePlayerId,
        lastSavedAt,
        retryInSeconds,
        saveNow,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}
