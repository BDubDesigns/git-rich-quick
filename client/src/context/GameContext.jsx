import { useReducer, useContext, createContext } from "react";
import { GiPlasticDuck } from "react-icons/gi";
import { BsBackpack } from "react-icons/bs";
import { BiCoffeeTogo } from "react-icons/bi";
import { FaPeopleGroup } from "react-icons/fa6";
import { MdEmail } from "react-icons/md";
import { FaGithub } from "react-icons/fa";
import { IoSettings } from "react-icons/io5";
import { MdRocketLaunch } from "react-icons/md";

/**
 * ========================================
 * ARCHITECTURE: Config + State Separation
 * ========================================
 *
 * All game balance data lives in IMMUTABLE CONFIG OBJECTS.
 * State stores only COUNTS and CURRENCY.
 *
 * This separation:
 * - Makes rebalancing easy (adjust config, game instantly rebalances)
 * - Keeps the reducer clean and predictable
 * - Prevents bugs from state-level balance changes
 *
 * NEVER add game balance constants to initialState or functions.
 * Add them to a CONFIG object instead. See GAME_BALANCE_CONFIG below.
 *
 * Pattern: `export const THING_CONFIG = Object.freeze({ ... })`
 */

const GameContext = createContext();
// ===== GAME BALANCE CONFIGURATIONS =====
export const GAME_BALANCE_CONFIG = Object.freeze({
  // ==== Game Mechanics ====
  TICK_INTERVAL: 1000, // Game tick interval in milliseconds
  BASE_LOC_PER_CLICK: 1, // Base lines of code per click
  UNLOCK_VISIBILITY_THRESHOLD: 0.1, // 10% progress to start showing locked employee card

  // ==== Starting Resources ====
  STARTING_MONEY: 0, // $0.00 in cents
  STARTING_LOC: 0, // Starting lines of code
});

// Immutable navigation tab configuration
export const NAV_TABS = Object.freeze([
  { id: "email", label: "Email", Icon: MdEmail },
  { id: "shop", label: "Shop", Icon: FaPeopleGroup },
  { id: "projects", label: "Projects", Icon: MdRocketLaunch },
  { id: "openSource", label: "Open Source", Icon: FaGithub },
  { id: "settings", label: "Settings", Icon: IoSettings },
]);

// Immutable employee configuration
// All costs are in CENTS to avoid floating-point errors in idle games
export const EMPLOYEE_CONFIGS = Object.freeze({
  intern: {
    name: "Intern",
    baseCost: 2500,
    locPerSecond: 1,
    costMultiplier: 1.1,
    Icon: GiPlasticDuck,
    color: "orange",
    // No unlock conditions, available from start.
    // We include an empty array for object structure consistency.
    unlockConditions: [],
    description:
      "Thinks git push --force is a Jedi mind trick. Will delete the production database if left unsupervised.",
  },
  junior: {
    name: "Junior Developer",
    baseCost: 20000,
    locPerSecond: 5,
    costMultiplier: 1.15,
    Icon: BsBackpack,
    color: "brown",
    // Unlock conditions
    unlockConditions: [{ type: "TOTAL_LOC", value: 100 }],
    description:
      "Knows 12 JavaScript frameworks but can't center a div. Will refactor your working code because it 'wasn't dry enough'.",
  },
  senior: {
    name: "Senior Developer",
    baseCost: 150000,
    locPerSecond: 20,
    costMultiplier: 1.2,
    Icon: BiCoffeeTogo,
    color: "green",
    // Multiple conditions (all must be met)
    unlockConditions: [
      { type: "TOTAL_LOC", value: 3000 },
      { type: "EMPLOYEE_COUNT", value: 10 },
    ],
    description:
      "Doesn't use a mouse. Writes code on a mechanical keyboard loud enough to wake the dead. Hates everything you just wrote.",
  },
});

// Immutable AI assistant configuration
// All costs are in CENTS to avoid floating-point errors in idle games
export const AI_ASSISTANT_CONFIGS = Object.freeze({
  noPilot: {
    name: "GitNub NoPilot",
    baseCost: 100000, // $1000.00
    multiplier: 0.05,
    costMultiplier: 1.5,
  },
});

// Immutable freelance projects configuration
// All rewards are in CENTS to avoid floating-point errors in idle games
// Design: Smaller projects have higher $/LOC to reward clicking, larger projects have lower $/LOC to encourage bulk sales
export const FREELANCE_PROJECTS_CONFIG = Object.freeze({
  toDoListApp: {
    name: "To Do List App",
    description:
      "A simple to-do list application. Cuz that's never been done before. Ever.",
    loc: 50,
    reward: 3000, // $30.00 ($0.60/LOC - best deal, rewards grinding)
  },
  hobbyWebsite: {
    name: "Hobby Website",
    description:
      "A personal website for a client to showcase their hobbies. The world needs to know about Bob's passion for stamp collecting.",
    loc: 750,
    reward: 36000, // $360.00 ($0.48/LOC - middle ground)
  },
  paradigmShiftingBlockchainProject: {
    name: "Paradigm-Shifting Blockchain Project",
    description:
      "A very useful project that leverages the blockchain to convert hype, overpromises, and investor's money into your money.",
    loc: 2000,
    reward: 80000, // $800.00 ($0.40/LOC - lazy button, lower $/LOC)
  },
});

export const OPEN_SOURCE_PROJECTS_CONFIG = Object.freeze({
  overReactFramework: {
    name: "OverReact Framework",
    description:
      "An open-source JavaScript framework that makes building web applications unnecessarily complex and bloated.",
    // No unlock condition for this one, available from start
    levels: [
      { locCost: 100, bonus: { type: "CLICK_BOOST", value: 1 } },
      { locCost: 500, bonus: { type: "CLICK_BOOST", value: 2 } },
      { locCost: 3000, bonus: { type: "CLICK_BOOST", value: 4 } },
    ],
  },
  nodeRuntime: {
    name: "Node Runtime",
    description:
      "Uses a `node_modules` folder that's heavier than a black hole. It lets frontend developers write backend code, for better or for worse.",
    unlockCondition: {
      type: "EMPLOYEE_COUNT",
      employeeType: "junior",
      count: 5,
    },
    levels: [
      { locCost: 2000, bonus: { type: "PASSIVE_BOOST", value: 0.5 } },
      { locCost: 10000, bonus: { type: "PASSIVE_BOOST", value: 1 } },
      { locCost: 75000, bonus: { type: "PASSIVE_BOOST", value: 1.5 } },
    ],
  },
});

// Initial state of the game
// All monetary values are in CENTS to avoid floating-point errors
// Initial values are derived from GAME_BALANCE_CONFIG
const initialState = {
  // Core currencies
  linesOfCode: GAME_BALANCE_CONFIG.STARTING_LOC,
  totalLinesOfCode: 0, // cumulative LOC written over time, never decreases
  money: GAME_BALANCE_CONFIG.STARTING_MONEY,
  activeTab: "shop", // can be "shop", "projects", or "openSource"

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
      return {
        ...newState,
        unlockedEmployees: updateUnlockLatch(newState),
      };
    }
    // Buy an employee (intern, junior, or senior)
    case "BUY_EMPLOYEE": {
      const { employeeType } = action.payload;
      const config = EMPLOYEE_CONFIGS[employeeType];
      const employee = state.employees[employeeType];

      if (!config || !employee) {
        console.warn(`Unknown employee type: ${employeeType}`);
        return state;
      }

      const currentCost = getEmployeeCost(employeeType, state);

      if (state.money >= currentCost) {
        // Build newState with all changes from this action
        const newState = {
          ...state,
          money: state.money - currentCost,
          employees: {
            ...state.employees,
            [employeeType]: {
              ...employee,
              count: employee.count + 1,
            },
          },
        };

        // Check for unlocks instantly (buying changed employee count)
        return {
          ...newState,
          unlockedEmployees: updateUnlockLatch(newState),
        };
      }

      return state;
    }

    // Handle freelance project completion
    case "COMPLETE_PROJECT": {
      // deconstruct projectKey and get project data from config
      const { projectKey } = action.payload;
      const project = FREELANCE_PROJECTS_CONFIG[projectKey];

      if (!project) {
        console.warn(`Unknown project key: ${projectKey}`);
        return state;
      }
      // Check if player has enough LOC to complete the project
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

      // get next level config
      const nextLevelConfig = projectConfig.levels[projectState.level];
      const cost = nextLevelConfig.locCost;
      // check if player has enough LOC to contribute
      if (state.linesOfCode < cost) {
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
    // if action type doesn't make sense, just return current state
    default: {
      return state;
    }
  }
}

/**
 * ========================================
 * Helper Functions
 * ========================================
 * Utility functions for calculating and retrieving
 * game state values.
 * These functions provide convenient ways to derive
 * information from the current game state without modifying it.
 * ========================================
 */

/**
 * Determine whether an unlock unit has crossed the visibility threshold.
 *
 * For unlockType === "employee", this function calls getUnlockProgress(unlockUnit, state)
 * to obtain an array of progress conditions. Each condition is expected to have numeric
 * `current` and `required` properties; the progress for a condition is computed as
 * `condition.current / condition.required`. If any condition's progress is greater than
 * or equal to GAME_BALANCE_CONFIG.UNLOCK_VISIBILITY_THRESHOLD, the function returns true.
 *
 * For unknown unlockType values the function logs a warning and returns false.
 *
 * @param {string} unlockType - The type of unlock to check (e.g. "employee").
 * @param {*} unlockUnit - Identifier or descriptor of the unit being checked (passed to getUnlockProgress).
 * @param {Object} state - Global/state object; threshold value comes from GAME_BALANCE_CONFIG.
 * @returns {boolean} True if any condition meets or exceeds the visibility threshold; otherwise false.
 *
 * @see getUnlockProgress
 * @see GAME_BALANCE_CONFIG.UNLOCK_VISIBILITY_THRESHOLD
 */
export function hasCrossedUnlockThreshold(unlockType, unlockUnit, state) {
  if (unlockType === "employee") {
    const progress = getUnlockProgress(unlockUnit, state);

    // If no unlock conditions, employee is always visible
    if (progress.length === 0) {
      return true;
    }

    const threshold = GAME_BALANCE_CONFIG.UNLOCK_VISIBILITY_THRESHOLD;
    // Check if ANY condition has >= 10% progress
    // Guard against division by zero if a condition is misconfigured with required === 0
    return progress.some(
      (condition) =>
        condition.required > 0 &&
        condition.current / condition.required >= threshold
    );
  }
  // Handle other unlock types as needed in future
  console.warn(`Unknown unlock type: ${unlockType}`);
  return false;
}

/**
 * Calculates the current Clicks Per Second (CPS) based on click history.
 *
 * This function filters the clickHistory array to count only clicks
 * that occurred in the last second.
 *
 * @param {Array} clickHistory - Array of click timestamps
 * @returns {number} The calculated CPS value
 */
export function calculateCPS(clickHistory) {
  const now = Date.now();
  const oneSecondAgo = now - 1000;

  // Filter clicks in the past 1 second
  const recentClicks = clickHistory.filter(
    (timestamp) => timestamp > oneSecondAgo
  );

  return recentClicks.length;
}

/**
 * Calculates the total number of employees across all employee types.
 *
 * Iterates through all employees in the state and sums their individual counts
 * to get the total number of hired employees (interns, juniors, and seniors).
 *
 * @param {Object} state - The game state object containing employees data
 * @param {Object} state.employees - Object mapping employee types to their counts
 * @returns {number} The total count of all employees
 */
export function getTotalEmployeeCount(state) {
  return Object.values(state.employees).reduce(
    (total, employee) => total + employee.count,
    0
  );
}

/**
 * Private helper function to calculate total bonuses of a specific type.
 *
 * This function extracts the common logic from getTotalClickBonus and getTotalPassiveBonus.
 * It iterates through all open source projects and their unlocked levels, accumulating
 * bonuses that match the specified type.
 *
 * NOT exported - for internal use only by getTotalClickBonus and getTotalPassiveBonus.
 *
 * @param {Object} state - The game state object containing openSourceProjects data
 * @param {string} bonusType - The type of bonus to filter for (e.g., "CLICK_BOOST", "PASSIVE_BOOST")
 * @returns {number} The total accumulated bonus value for the specified type
 *
 * @private
 */
function getTotalBonusByType(state, bonusType) {
  let totalBonus = 0;
  for (const projectId in OPEN_SOURCE_PROJECTS_CONFIG) {
    const projectState = state.openSourceProjects[projectId];
    const projectConfig = OPEN_SOURCE_PROJECTS_CONFIG[projectId];
    for (let i = 0; i < projectState.level; i++) {
      const levelBonus = projectConfig.levels[i].bonus;
      if (levelBonus.type === bonusType) {
        totalBonus += levelBonus.value;
      }
    }
  }
  return totalBonus;
}

/**
 * Calculates the total click bonus from all open source projects based on their current levels.
 *
 * This is a convenience wrapper around getTotalBonusByType filtered for click bonuses.
 * See getTotalBonusByType for implementation details.
 *
 * @param {Object} state - The game state object containing openSourceProjects data
 * @returns {number} The total accumulated click bonus value from all projects
 */
export function getTotalClickBonus(state) {
  return getTotalBonusByType(state, "CLICK_BOOST");
}

/**
 * Calculates the total passive bonus from all open source projects based on their current levels.
 *
 * This is a convenience wrapper around getTotalBonusByType filtered for passive bonuses.
 * See getTotalBonusByType for implementation details.
 *
 * @param {Object} state - The game state object containing openSourceProjects data
 * @returns {number} The total accumulated passive bonus value from all projects
 */
export function getTotalPassiveBonus(state) {
  return getTotalBonusByType(state, "PASSIVE_BOOST");
}

/**
 * Calculates the total lines of code (LOC) generated from a single click.
 *
 * This formula combines the base LOC per click with all active click bonuses
 * from open source projects. Uses the same calculation pattern as passive LOC:
 * Final LOC = Base LOC × (1 + Total Click Bonus Multiplier)
 *
 * @param {Object} state - The game state object
 * @returns {number} Total LOC generated from one click, including bonuses
 *
 * @example
 * // With no bonuses:
 * calculateLOCPerClick(state) // returns 10
 *
 * // With click bonuses totaling 0.3:
 * calculateLOCPerClick(state) // returns 13 (10 * 1.3)
 */
export function calculateLOCPerClick(state) {
  const baseLOC = GAME_BALANCE_CONFIG.BASE_LOC_PER_CLICK;
  const clickBonus = getTotalClickBonus(state);
  return baseLOC * (1 + clickBonus);
}

/**
 * Calculates the total lines of code (LOC) generated per second from all employees.
 *
 * This formula combines the base passive LOC generation (from all employees)
 * with all active passive bonuses from open source projects. Uses the same
 * calculation pattern as click LOC: Final LOC = Base LOC × (1 + Total Passive Bonus Multiplier)
 *
 * @param {Object} state - The game state object
 * @returns {number} Total LOC generated per second from employees, including bonuses
 *
 * @example
 * // With 3 interns (3 LOC/sec each) and no bonuses:
 * calculateLOCPerSecond(state) // returns 9 (3 * 3 * 1.0)
 *
 * // Same setup with passive bonuses totaling 0.15:
 * calculateLOCPerSecond(state) // returns 10.35 (9 * 1.15)
 */
export function calculateLOCPerSecond(state) {
  const basePassiveLOC = getCurrentLOCPerSecond(state);
  const passiveBonus = getTotalPassiveBonus(state);
  return basePassiveLOC * (1 + passiveBonus);
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
 * @param {string} condition.type - Type of condition (e.g., "TOTAL_LOC", "EMPLOYEE_COUNT")
 * @param {number} condition.value - The threshold value
 * @param {Object} state - The game state to check against
 * @returns {boolean} True if condition is satisfied, false otherwise
 *
 * @private
 */
function checkCondition(condition, state) {
  switch (condition.type) {
    case "TOTAL_LOC":
      // Player has earned enough cumulative LOC
      return state.totalLinesOfCode >= condition.value;

    case "EMPLOYEE_COUNT":
      // Player has hired enough total employees
      return getTotalEmployeeCount(state) >= condition.value;

    // Future condition types can be added here:
    // case "MONEY":
    //   return state.money >= condition.value;
    // case "PROJECTS_COMPLETED":
    //   return Object.values(state.freelanceProjectsCompleted).reduce((sum, count) => sum + count, 0) >= condition.value;

    default:
      // Unknown condition type—this indicates a config error (typo or invalid type).
      // FAIL SAFELY: Return false to keep the unlock locked. This forces the error
      // to surface during testing (employee stays locked when it shouldn't). Better
      // to catch the typo now than have the employee silently unlock to wrong conditions.
      console.error(`Unknown unlock condition type: ${condition.type}`);
      return false;
  }
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
 * Determines if an employee type is permanently unlocked.
 *
 * This function reads the permanent unlock record. Once an employee is unlocked,
 * this returns true forever (even if conditions later drop below threshold).
 *
 * This is the function UI components call. Never call areUnlockConditionsMet()
 * from components—always call this.
 *
 * @param {string} employeeType - The employee type to check (e.g., "intern", "junior", "senior")
 * @param {Object} state - The game state
 * @returns {boolean} True if employee has been unlocked, false if still locked
 *
 * @example
 * const { state } = useGameContext();
 * if (isEmployeeUnlocked("senior", state)) {
 *   // Show purchasable EmployeeCard
 * } else {
 *   // Show LockedEmployeeCard
 * }
 */
export function isEmployeeUnlocked(employeeType, state) {
  return state.unlockedEmployees[employeeType];
}

/**
 * Calculates progress toward unlocking an employee.
 *
 * For each unlock condition, returns: current value, required value, and remaining.
 * Used by LockedEmployeeCard to display progress bars and remaining counts.
 *
 * @param {string} employeeType - The employee type to check
 * @param {Object} state - The game state
 * @returns {Array<Object>} Array of { type, current, required, remaining }
 *
 * @example
 * getUnlockProgress("junior", state)
 * // Returns: [
 * //   { type: "TOTAL_LOC", current: 45, required: 100, remaining: 55 }
 * // ]
 *
 * getUnlockProgress("senior", state)
 * // Returns: [
 * //   { type: "TOTAL_LOC", current: 2000, required: 3000, remaining: 1000 },
 * //   { type: "EMPLOYEE_COUNT", current: 5, required: 10, remaining: 5 }
 * // ]
 */
export function getUnlockProgress(employeeType, state) {
  const config = EMPLOYEE_CONFIGS[employeeType];

  if (
    !config ||
    !config.unlockConditions ||
    config.unlockConditions.length === 0
  ) {
    return []; // No unlock conditions, no progress to show
  }

  return config.unlockConditions.map((condition) => {
    let current = 0;

    switch (condition.type) {
      case "TOTAL_LOC":
        current = state.totalLinesOfCode;
        break;
      case "EMPLOYEE_COUNT":
        current = getTotalEmployeeCount(state);
        break;
      default:
        current = 0;
    }

    const required = condition.value;
    const remaining = Math.max(0, required - current);

    return {
      type: condition.type,
      current,
      required,
      remaining,
    };
  });
}

// Calculate current LOC per second from all employees
/**
 * Calculates the total lines of code (LOC) generated per second based on current employees.
 *
 * @param {Object} state - The game state object containing employee data
 * @param {Object} state.employees - Object mapping employee types to employee objects
 * @param {number} state.employees[employeeType].count - Number of employees of a given type
 * @returns {number} Total lines of code generated per second across all employees
 */
export function getCurrentLOCPerSecond(state) {
  let locPerSecond = 0;
  Object.entries(state.employees).forEach(([employeeType, employee]) => {
    const config = EMPLOYEE_CONFIGS[employeeType];
    locPerSecond += config.locPerSecond * employee.count;
  });
  return locPerSecond;
}

// Get Employee Cost
export function getEmployeeCost(employeeType, state) {
  const config = EMPLOYEE_CONFIGS[employeeType];
  const employee = state.employees[employeeType];

  if (!config || !employee) {
    console.warn(`Unknown employee type: ${employeeType}`);
    return 0;
  }

  // Calculate current cost in cents (increases with each purchase)
  return Math.round(
    config.baseCost * Math.pow(config.costMultiplier, employee.count)
  );
}
// GameProvider component to wrap the app and provide game state
export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}

// Custom hook to use the GameContext
export function useGameContext() {
  const context = useContext(GameContext);

  if (!context) {
    throw new Error("useGameContext must be used within a GameProvider");
  }

  return context;
}
