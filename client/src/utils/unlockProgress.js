/**
 * Unlock progress + visibility — pure helpers, no client-only imports.
 *
 * These were in client/src/context/gameLogic.js, but gameLogic imports
 * the display config (gameConfig.js), which imports react-icons for tab
 * and employee icons. The save server's test environment installs only
 * the server workspace, so anything it imports must stay free of npm
 * packages. The unlock math only needs the conditions, which live in
 * shared BALANCE, and the display names, which live in shared too — so
 * these helpers live here (shared-only) and gameLogic re-exports them,
 * keeping one implementation for the Shop, the email adapters, and the
 * server-side unlock checks.
 *
 * Behavior is identical to the gameLogic versions: same progress shape
 * ({ type, current, target, remaining, employeeType?, employeeName? }),
 * same visibility rule (ANY condition at UNLOCK_VISIBILITY_THRESHOLD),
 * same defensive empty-progress-means-visible rule.
 */

import {
  BALANCE,
  EMPLOYEE_DISPLAY_NAMES,
  UNLOCK_VISIBILITY_THRESHOLD,
} from "../../../shared/game-balance.js";

/**
 * Total number of employees across all employee types.
 */
export function getTotalEmployeeCount(state) {
  return Object.values(state.employees).reduce(
    (total, employee) => total + employee.count,
    0
  );
}

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

/**
 * Progress toward unlocking an employee: one entry per unlock condition,
 * each { type, current, target, remaining } (plus employeeType /
 * employeeName for SPECIFIC_EMPLOYEE_COUNT). Empty when the employee has
 * no unlock conditions.
 */
export function getUnlockProgress(employeeType, state) {
  const config = BALANCE.employees[employeeType];

  if (!config || !config.unlockConditions || config.unlockConditions.length === 0) {
    return []; // No unlock conditions, no progress to show
  }

  return progressForConditions(config.unlockConditions, state);
}

/**
 * Progress toward unlocking an open-source project. Same shape as
 * getUnlockProgress; conditions come from BALANCE.openSource.
 */
export function getUnlockProgressForOpenSource(projectId, state) {
  const config = BALANCE.openSource[projectId];

  if (!config || !config.unlockConditions || config.unlockConditions.length === 0) {
    return []; // No unlock conditions
  }

  return progressForConditions(config.unlockConditions, state);
}

/** Shared condition -> progress mapping for both unlock types. */
function progressForConditions(unlockConditions, state) {
  return unlockConditions.map((condition) => {
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
        employeeName: EMPLOYEE_DISPLAY_NAMES[condition.employeeType],
      }),
    };
  });
}

/**
 * Whether an unlockable has crossed the visibility threshold: any one
 * condition at UNLOCK_VISIBILITY_THRESHOLD (10%) of its target.
 */
export function hasCrossedUnlockThreshold(unlockType, unlockUnit, state) {
  // Handle employee unlock type
  if (unlockType === "employee") {
    const progress = getUnlockProgress(unlockUnit, state);
    return checkProgressAgainstThreshold(progress, UNLOCK_VISIBILITY_THRESHOLD);
  }
  // Handle openSource unlock type
  if (unlockType === "openSource") {
    const progress = getUnlockProgressForOpenSource(unlockUnit, state);
    return checkProgressAgainstThreshold(progress, UNLOCK_VISIBILITY_THRESHOLD);
  }

  console.warn(`Unknown unlock type: ${unlockType}`);
  return false;
}
