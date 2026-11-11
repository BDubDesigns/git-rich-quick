/**
 * Pure game-logic helpers — derived values computed from state.
 *
 * These are framework-free functions (no React, no components), so they
 * live here instead of GameContext.jsx: a file that exports a component
 * must only export components (react-refresh). Configs come from
 * gameConfig.js; balance math comes from shared/game-balance.js.
 */

import * as shared from "../../../shared/game-balance.js";
import { EMPLOYEE_CONFIGS } from "./gameConfig.js";

// Unlock progress + visibility live in a pure shared-only module (see
// client/src/utils/unlockProgress.js) so the save server's tests can
// import them without the display config's react-icons. Re-exported here
// so existing consumers (Shop, Projects, GameContext) keep importing
// from gameLogic.
export {
  getTotalEmployeeCount,
  getUnlockProgress,
  getUnlockProgressForOpenSource,
  hasCrossedUnlockThreshold,
} from "../utils/unlockProgress.js";

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
 * A golden-star Click buff (AI Accelerator / Hallucination) multiplies the
 * click value while it is live. See activeStarBuff.
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
  const base = shared.locPerClick(flatOpenSourceLevels(state));
  const clickBuff = activeStarBuff(state, "click");
  return clickBuff ? base * clickBuff.multiplier : base;
}

/**
 * Calculates the total lines of code (LOC) generated per second from all employees.
 *
 * This formula combines the base passive LOC generation (from all employees)
 * with all active passive bonuses from open source projects. Uses the same
 * calculation pattern as click LOC: Final LOC = Base LOC × (1 + Total Passive Bonus Multiplier)
 *
 * Golden-star buffs apply on top of the base rate, the same way the save
 * server credits them (see validate.js): an Employee buff (Sprint /
 * Meeting) scales one type's contribution, and a Frenzy buff (Overclock /
 * Throttling) scales the whole passive rate — so the two multiply, they
 * do not add.
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
  const employeeCounts = flatEmployeeCounts(state);
  const openSourceLevels = flatOpenSourceLevels(state);
  const base = shared.locPerSecond(employeeCounts, openSourceLevels);
  const passiveBonusValue = shared.passiveBonus(openSourceLevels);

  // Employee buffs: each scales one type's contribution to the base rate.
  let total = base;
  for (const type of shared.EMPLOYEE_TYPES) {
    const buff = activeStarBuff(state, "employee", type);
    if (!buff) continue;
    const typeRate =
      shared.BALANCE.employees[type].locPerSecond *
      (employeeCounts[type] ?? 0) *
      (1 + passiveBonusValue);
    total += (buff.multiplier - 1) * typeRate;
  }

  // Frenzy scales the whole passive rate (including any Employee extra).
  const frenzy = activeStarBuff(state, "frenzy");
  if (frenzy) total *= frenzy.multiplier;
  return total;
}

/**
 * The currently live golden-star buff for an effect, or null. A buff is
 * live when it is in state.activeStarEffects and has not expired yet.
 * Only one buff per (effect, employeeType) can be live at a time — a new
 * one replaces the old — so the first match is the live one. Expired
 * entries are dropped by the GAME_TICK, but the expiry check here keeps
 * a buff from applying in the gap between its expiry and the next tick.
 */
export function activeStarBuff(state, effect, employeeType = null) {
  const now = Date.now();
  const buffs = state.activeStarEffects ?? [];
  for (const buff of buffs) {
    if (buff.effect !== effect) continue;
    if (effect === "employee" && buff.employeeType !== employeeType) continue;
    if (buff.expiresAtMs <= now) continue;
    return buff;
  }
  return null;
}

/** The player's Constellation level (0 = no golden stars). */
export function getConstellationLevel(state) {
  return state.openSourceProjects.constellation?.level ?? 0;
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
