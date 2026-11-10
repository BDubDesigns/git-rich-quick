/**
 * Pure game-logic helpers — derived values computed from state.
 *
 * These are framework-free functions (no React, no components), so they
 * live here instead of GameContext.jsx: a file that exports a component
 * must only export components (react-refresh). Configs come from
 * gameConfig.js; balance math comes from shared/game-balance.js.
 */

import * as shared from "../../../shared/game-balance.js";
import {
  GAME_BALANCE_CONFIG,
  EMPLOYEE_CONFIGS,
  OPEN_SOURCE_PROJECTS_CONFIG,
} from "./gameConfig.js";

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
 * `current` and `target` properties; the progress for a condition is computed as
 * `condition.current / condition.target`. If any condition's progress is greater than
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

/**
 * Private helper to check if any progress meets the visibility threshold.
 * @private
 */
function checkProgressAgainstThreshold(progress, threshold) {
  if (progress.length === 0) {
    // Defensive: empty progress means no conditions, so consider it met
    return true;
  }
  // Check if any condition meets or exceeds the threshold
  return progress.some(
    (condition) =>
      condition.target > 0 && condition.current / condition.target >= threshold
  );
}
// Checks if an unlockable has crossed the visibility threshold
export function hasCrossedUnlockThreshold(unlockType, unlockUnit, state) {
  const threshold = GAME_BALANCE_CONFIG.UNLOCK_VISIBILITY_THRESHOLD;

  // Handle employee unlock type
  if (unlockType === "employee") {
    const progress = getUnlockProgress(unlockUnit, state);
    return checkProgressAgainstThreshold(progress, threshold);
  }
  // Handle openSource unlock type
  if (unlockType === "openSource") {
    const progress = getUnlockProgressForOpenSource(unlockUnit, state);
    return checkProgressAgainstThreshold(progress, threshold);
  }

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
/**
 * The client stores counts as { type: { count } } and levels as
 * { id: { level } }; the shared formulas take flat maps, so adapt here.
 * These are thin adapters — the math lives in shared/game-balance.js,
 * which the save server also uses, so both sides stay identical.
 */
export function flatEmployeeCounts(state) {
  return Object.keys(state.employees).reduce((acc, key) => {
    acc[key] = state.employees[key].count;
    return acc;
  }, {});
}

function flatOpenSourceLevels(state) {
  return Object.keys(state.openSourceProjects).reduce((acc, key) => {
    acc[key] = state.openSourceProjects[key].level;
    return acc;
  }, {});
}

function getTotalBonusByType(state, bonusType) {
  return shared.totalBonusByType(flatOpenSourceLevels(state), bonusType);
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
  return shared.locPerClick(flatOpenSourceLevels(state));
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
  return shared.locPerSecond(
    flatEmployeeCounts(state),
    flatOpenSourceLevels(state)
  );
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
 * For each unlock condition, returns: current value, target value, and remaining.
 * Used by LockedEmployeeCard to display progress bars and remaining counts.
 *
 * @param {string} employeeType - The employee type to check
 * @param {Object} state - The game state
 * @returns {Array<Object>} Array of { type, current, target, remaining }
 *
 * @example
 * getUnlockProgress("junior", state)
 * // Returns: [
 * //   { type: "TOTAL_LOC", current: 45, target: 100, remaining: 55 }
 * // ]
 *
 * getUnlockProgress("senior", state)
 * // Returns: [
 * //   { type: "TOTAL_LOC", current: 2000, target: 3000, remaining: 1000 },
 * //   { type: "TOTAL_EMPLOYEE_COUNT", current: 5, target: 10, remaining: 5 }
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
      case "TOTAL_EMPLOYEE_COUNT":
        current = getTotalEmployeeCount(state);
        break;
      case "SPECIFIC_EMPLOYEE_COUNT":
        if (condition.employeeType && state.employees[condition.employeeType]) {
          current = state.employees[condition.employeeType].count;
        } else {
          console.warn(
            `Invalid employeeType in unlock condition: ${condition.employeeType}`
          );
          current = 0;
        }
        break;
      default:
        current = 0;
    }

    const target = condition.target;
    const remaining = Math.max(0, target - current);

    return {
      type: condition.type,
      current,
      target,
      remaining,
      ...(condition.type === "SPECIFIC_EMPLOYEE_COUNT" && {
        employeeType: condition.employeeType,
        employeeName: EMPLOYEE_CONFIGS[condition.employeeType].name,
      }),
    };
  });
}

/**
 * Calculates progress toward unlocking an open source project.
 *
 * Similar to getUnlockProgress() for employees, but pulls conditions from
 * the project config instead of the employee config.
 *
 * @param {string} projectId - The project ID (e.g., "blocker")
 * @param {Object} state - The game state
 * @returns {Array<Object>} Array of { type, current, target, remaining }
 */
export function getUnlockProgressForOpenSource(projectId, state) {
  const config = OPEN_SOURCE_PROJECTS_CONFIG[projectId];

  if (
    !config ||
    !config.unlockConditions ||
    config.unlockConditions.length === 0
  ) {
    return []; // No unlock conditions
  }

  return config.unlockConditions.map((condition) => {
    let current = 0;

    switch (condition.type) {
      case "TOTAL_LOC":
        current = state.totalLinesOfCode;
        break;
      case "TOTAL_EMPLOYEE_COUNT":
        current = getTotalEmployeeCount(state);
        break;
      case "SPECIFIC_EMPLOYEE_COUNT":
        if (condition.employeeType && state.employees[condition.employeeType]) {
          current = state.employees[condition.employeeType].count;
        } else {
          console.warn(
            `Invalid employeeType in unlock condition: ${condition.employeeType}`
          );
          current = 0;
        }
        break;
      default:
        current = 0;
    }

    const target = condition.target;
    const remaining = Math.max(0, target - current);

    return {
      type: condition.type,
      current,
      target,
      remaining,
      ...(condition.type === "SPECIFIC_EMPLOYEE_COUNT" && {
        employeeType: condition.employeeType,
        employeeName: EMPLOYEE_CONFIGS[condition.employeeType].name,
      }),
    };
  });
}

/**
 * Determines if an open source project is permanently unlocked.
 *
 * Reads the permanent unlock record. Once unlocked, always unlocked.
 *
 * @param {string} projectId - The project ID
 * @param {Object} state - The game state
 * @returns {boolean} True if project has been unlocked
 */
export function isOpenSourceProjectUnlocked(projectId, state) {
  return state.unlockedOpenSourceProjects[projectId];
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
  return shared.baseLocPerSecond(flatEmployeeCounts(state));
}

// Get Employee Cost
export function getEmployeeCost(employeeType, state) {
  const employee = state.employees[employeeType];

  if (!EMPLOYEE_CONFIGS[employeeType] || !employee) {
    console.warn(`Unknown employee type: ${employeeType}`);
    return 0;
  }

  // Calculate current cost in cents (increases with each purchase)
  return shared.employeeCost(employeeType, employee.count);
}

// Total cost in cents of buying `quantity` hires of a type, starting
// from the currently owned count. The sum of the next `quantity`
// individual costs (each successive hire costs more than the previous)
// — the same sum the save server recomputes for money accounting, so
// the price the Hire button shows and the price the reducer charges
// can never disagree. Quantity 1 is exactly getEmployeeCost.
export function getEmployeeBulkCost(employeeType, state, quantity) {
  const employee = state.employees[employeeType];

  if (!EMPLOYEE_CONFIGS[employeeType] || !employee) {
    console.warn(`Unknown employee type: ${employeeType}`);
    return 0;
  }

  return shared
    .employeePurchaseCosts(employeeType, employee.count, quantity)
    .reduce((sum, cost) => sum + cost, 0);
}
