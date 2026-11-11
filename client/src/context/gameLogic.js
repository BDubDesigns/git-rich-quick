/**
 * Pure game-logic helpers — derived values computed from state.
 *
 * These are framework-free functions (no React, no components), so they
 * live here instead of GameContext.jsx: a file that exports a component
 * must only export components (react-refresh). Configs come from
 * gameConfig.js; balance math comes from shared/game-balance.js.
 */

import * as shared from "../../../shared/game-balance.js";
import { formatNumber } from "../../../shared/formatNumber.js";
import { COSMETICS_CONFIG, EMPLOYEE_CONFIGS } from "./gameConfig.js";

// Unlock progress + visibility live in a pure shared-only module (see
// client/src/utils/unlockProgress.js) so the save server's tests can
// import them without the display config's react-icons. Re-exported here
// so existing consumers (Shop, Projects, GameContext) keep importing
// from gameLogic.
export {
  getTotalEmployeeCount,
  getUnlockProgress,
  getUnlockProgressForOpenSource,
  getUnlockProgressForFreelanceProject,
  hasCrossedUnlockThreshold,
  sortOpenSourceProjectIds,
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
 * Commit Specialists add +0.2 LOC per specialist, and the bonus gets the
 * same OverReact click boost as the base manual click: the total is
 * floor((base + 0.2 x N) x (1 + click bonus)). The FINAL total is floored
 * to a whole number (Brandon: a click must never yield or commit a
 * fractional amount — never 5093.1, always 5093), so 10 specialists
 * = +2, 15 = +3, 25 = +5 once the total is floored (at no OverReact).
 * A Sprint on Commit Specialists multiplies their per-click bonus (+1.0
 * per specialist at 5x) before the Click buff multiplies the total —
 * and the Click buff multiplies the whole click total, CS bonus
 * included, because it scales the floored total from locPerClick.
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
  const csSprint = activeStarBuff(state, "employee", "commitSpecialist");
  const base = shared.locPerClick(
    flatOpenSourceLevels(state),
    flatEmployeeCounts(state),
    csSprint ? csSprint.multiplier : 1
  );
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
 * The Project Manager boost is already inside the base rate (shared
 * locPerSecond): each manager multiplies the whole passive rate by
 * (1 + 0.01 x N). A Sprint on Project Managers scales the boost
 * contribution itself (the rate employeeBuffTypeRate returns for that
 * type), so a 5x Sprint makes each manager give +5% while it is live.
 * A Commit Specialist contributes nothing to passive LOC, so a Sprint
 * on them adds nothing here — their bonus lives on clicks.
 *
 * The FINAL total is floored to a whole number, the same rule as the
 * click total (Brandon: a tick must never commit a fractional amount).
 * The shared base rate is already floored, but a live buff's extra can
 * re-fractionalize the total (a Sprint scales a fractional type rate),
 * so the floor sits on the final total here, not on any component.
 *
 * @param {Object} state - The game state object
 * @returns {number} Total LOC generated per second from employees, including bonuses
 *
 * @example
 * // With 3 interns (1 LOC/sec each) and no bonuses:
 * calculateLOCPerSecond(state) // returns 3
 *
 * // Same setup with passive bonuses totaling 0.5 (Blocker L1):
 * calculateLOCPerSecond(state) // returns 4 (3 * 1.5 = 4.5, floored)
 */
export function calculateLOCPerSecond(state) {
  const employeeCounts = flatEmployeeCounts(state);
  const openSourceLevels = flatOpenSourceLevels(state);
  const base = shared.locPerSecond(employeeCounts, openSourceLevels);

  // Employee buffs: each scales one type's contribution to the base rate.
  let total = base;
  for (const type of shared.EMPLOYEE_TYPES) {
    const buff = activeStarBuff(state, "employee", type);
    if (!buff) continue;
    const typeRate = shared.employeeBuffTypeRate(
      type,
      employeeCounts,
      openSourceLevels
    );
    total += (buff.multiplier - 1) * typeRate;
  }

  // Frenzy scales the whole passive rate (including any Employee extra).
  const frenzy = activeStarBuff(state, "frenzy");
  if (frenzy) total *= frenzy.multiplier;
  // Floor the final total (Brandon: a tick must never commit a
  // fractional amount). The shared base rate is already floored, but a
  // live buff's extra can re-fractionalize the total, so the floor
  // sits here, on the final total.
  return Math.floor(total);
}

/**
 * The `@returns` line for an employee card's jsdoc block, as plain data
 * the card renders: the bonus type and its base value, plus the boosted
 * value when a star buff (or the Project Manager boost) makes the
 * effective multiplier differ from 1. One implementation for both
 * EmployeeCard and LockedEmployeeCard (DRY): a Project Manager shows
 * "+1% passive per Manager" and a Commit Specialist "+0.2 LOC per
 * Click" instead of the normal "{N} LOC per Sec", because neither has
 * a per-second rate — their value is the boost they give. The suffix
 * is green for a buff (>1x) and red for a debuff (<1x), matching the
 * card tint; when the multiplier is exactly 1 there is no suffix, so
 * the card reads exactly like an unbuffed one.
 *
 * @param {object} config - the employee config (EMPLOYEE_CONFIGS[type])
 * @param {number} effectMultiplier - the type's effective multiplier
 *   (1 when nothing is live; a Project Manager's own Sprint/Meeting
 *   multiplier for the PM card, a Commit Specialist's for the CS card,
 *   effectiveEmployeeMultiplier for the other types)
 * @returns {{ type: string, value: string, suffix: string,
 *   suffixClassName: string }}
 */
export function employeeReturnsLine(config, effectMultiplier = 1) {
  let type;
  let value;
  let boostedValue;
  if (config.passiveBoostPerEmployee !== undefined) {
    type = "PASSIVE";
    value = `+${formatNumber(config.passiveBoostPerEmployee * 100)}% passive per Manager`;
    boostedValue = `+${formatNumber(config.passiveBoostPerEmployee * effectMultiplier * 100)}% per Manager`;
  } else if (config.clickBonusPerEmployee !== undefined) {
    type = "CLICK";
    value = `+${formatNumber(config.clickBonusPerEmployee)} LOC per Click`;
    boostedValue = `+${formatNumber(config.clickBonusPerEmployee * effectMultiplier)} LOC per Click`;
  } else if (config.autoShip) {
    // Release Manager: no LOC/s rate and no click bonus — its value
    // is the auto-ship. One ship per assigned manager per interval
    // (see RELEASE_MANAGER_CONFIG); star buffs do not change the
    // timer, so there is no boosted value — the suffix stays empty.
    type = "SHIP";
    value = `Ships 1 project per ${shared.formatCooldownSeconds(shared.RELEASE_MANAGER_CONFIG.shipIntervalSeconds)}`;
    boostedValue = value;
  } else {
    type = "LOC";
    value = `${formatNumber(config.locPerSecond)} LOC per Sec`;
    boostedValue = `${formatNumber(config.locPerSecond * effectMultiplier)} LOC per Sec`;
  }
  return {
    type,
    value,
    suffix: effectMultiplier !== 1 ? ` → ${boostedValue}` : "",
    suffixClassName:
      effectMultiplier > 1
        ? "text-green-400"
        : effectMultiplier < 1
          ? "text-red-400"
          : "",
  };
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

/** The player's StarBroker level (0 = cannot buy stars). */
export function getStarBrokerLevel(state) {
  return state.openSourceProjects.starBroker?.level ?? 0;
}

/**
 * The player's BASE passive LOC/s (employees + Blocker bonus, no
 * star buffs). The StarBroker buy cost is 30x this rate — the same
 * shared locPerSecond the server prices a buy from — so the cost the
 * Buy Star button shows and the cost the server charges can never
 * disagree (unlike calculateLOCPerSecond, which includes live buffs).
 */
export function getBaseLocPerSecond(state) {
  return shared.locPerSecond(flatEmployeeCounts(state), flatOpenSourceLevels(state));
}

/**
 * The icon (component + color) an employee type renders with right
 * now (issue #11). When a cosmetic is equipped for the type's slot,
 * the cosmetic's icon replaces the config default; otherwise the
 * default. Callers render `<Icon size={n} color={color} />` from the
 * result. Equipped cosmetics are trusted here — the reducer only
 * stores valid equips, and the server rejects an invalid one — so a
 * missing entry in COSMETICS_CONFIG falls back to the default
 * instead of crashing the card.
 */
export function resolveEmployeeIcon(employeeType, state) {
  const config = EMPLOYEE_CONFIGS[employeeType];
  if (!config) return { Icon: null, color: null };
  const cosmeticId =
    state.equippedCosmetics?.[config.cosmeticSlot] ?? null;
  const cosmetic = cosmeticId ? COSMETICS_CONFIG[cosmeticId] : null;
  if (!cosmetic) return { Icon: config.Icon, color: config.color };
  return { Icon: cosmetic.Icon, color: cosmetic.color };
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

/**
 * Determines if a freelance project is permanently unlocked.
 *
 * Reads the permanent unlock record. Once unlocked, always unlocked.
 * The To Do List App has no unlock conditions, so it starts unlocked.
 *
 * @param {string} projectKey - The project key
 * @param {Object} state - The game state
 * @returns {boolean} True if project has been unlocked
 */
export function isFreelanceProjectUnlocked(projectKey, state) {
  return state.unlockedFreelanceProjects[projectKey];
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
