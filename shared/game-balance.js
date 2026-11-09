/**
 * Get Rich Quick GIT — shared game balance.
 *
 * Single source of truth for every number the game runs on. Imported by
 * both sides, so the client and the save server can never drift apart:
 * - Client: `client/src/context/GameContext.jsx` rebuilds its display
 *   configs (names, icons, descriptions) on top of these numbers.
 * - Server: `server/src/validate.js` runs the save validation against
 *   these numbers and the pure formulas below.
 *
 * Plain ESM, no React, no Node-only APIs, so both sides can import it.
 * Numbers verified against `GameContext.jsx` at master 86053c3.
 *
 * The save-state shape these helpers operate on (see
 * `save-schema-validation-spec.md`):
 *   employees: flat counts { intern, junior, senior }
 *   openSourceProjects: levels as plain numbers { overReactFramework, blocker }
 *   aiAssistants: flat counts { noPilot }
 */

export const BALANCE = Object.freeze({
  mechanics: Object.freeze({
    tickIntervalMs: 1000,
    baseLocPerClick: 1,
    startingMoney: 0, // cents
    startingLoc: 0,
  }),

  employees: Object.freeze({
    intern: Object.freeze({
      baseCost: 2500, // cents
      locPerSecond: 1,
      costMultiplier: 1.1,
      unlockConditions: Object.freeze([]),
    }),
    junior: Object.freeze({
      baseCost: 20000,
      locPerSecond: 5,
      costMultiplier: 1.15,
      unlockConditions: Object.freeze([
        Object.freeze({ type: "TOTAL_LOC", target: 100 }),
      ]),
    }),
    senior: Object.freeze({
      baseCost: 150000,
      locPerSecond: 20,
      costMultiplier: 1.2,
      unlockConditions: Object.freeze([
        Object.freeze({ type: "TOTAL_LOC", target: 3000 }),
        Object.freeze({ type: "TOTAL_EMPLOYEE_COUNT", target: 10 }),
      ]),
    }),
  }),

  aiAssistants: Object.freeze({
    // Defined in the client but never wired to a buy action or a formula,
    // so v1 freezes the count at 0. See the save spec's NoPilot flag.
    noPilot: Object.freeze({
      baseCost: 100000, // cents
      multiplier: 0.05,
      costMultiplier: 1.5,
    }),
  }),

  freelanceProjects: Object.freeze({
    toDoListApp: Object.freeze({ loc: 50, reward: 3000 }), // cents
    hobbyWebsite: Object.freeze({ loc: 750, reward: 36000 }),
    paradigmShiftingBlockchainProject: Object.freeze({
      loc: 2000,
      reward: 80000,
    }),
  }),

  openSource: Object.freeze({
    overReactFramework: Object.freeze({
      unlockConditions: Object.freeze([]),
      levels: Object.freeze([
        Object.freeze({
          locCost: 100,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 1 }),
        }),
        Object.freeze({
          locCost: 500,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 2 }),
        }),
        Object.freeze({
          locCost: 3000,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 4 }),
        }),
      ]),
    }),
    blocker: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_EMPLOYEE_COUNT",
          employeeType: "junior",
          target: 5,
        }),
      ]),
      levels: Object.freeze([
        Object.freeze({
          locCost: 2000,
          bonus: Object.freeze({ type: "PASSIVE_BOOST", value: 0.5 }),
        }),
        Object.freeze({
          locCost: 10000,
          bonus: Object.freeze({ type: "PASSIVE_BOOST", value: 1 }),
        }),
        Object.freeze({
          locCost: 75000,
          bonus: Object.freeze({ type: "PASSIVE_BOOST", value: 1.5 }),
        }),
      ]),
    }),
  }),
});

export const EMPLOYEE_TYPES = Object.freeze(["intern", "junior", "senior"]);
export const FREELANCE_PROJECT_KEYS = Object.freeze([
  "toDoListApp",
  "hobbyWebsite",
  "paradigmShiftingBlockchainProject",
]);
export const OPEN_SOURCE_IDS = Object.freeze([
  "overReactFramework",
  "blocker",
]);

/** Total employees across all types, from flat counts. */
export function totalEmployees(employeeCounts) {
  return EMPLOYEE_TYPES.reduce(
    (sum, type) => sum + (employeeCounts[type] ?? 0),
    0
  );
}

/** Sum of one bonus type across all unlocked open-source levels. */
export function totalBonusByType(openSourceLevels, bonusType) {
  let total = 0;
  for (const projectId of OPEN_SOURCE_IDS) {
    const level = openSourceLevels[projectId] ?? 0;
    const config = BALANCE.openSource[projectId];
    for (let i = 0; i < level; i += 1) {
      const bonus = config.levels[i].bonus;
      if (bonus.type === bonusType) total += bonus.value;
    }
  }
  return total;
}

export function clickBonus(openSourceLevels) {
  return totalBonusByType(openSourceLevels, "CLICK_BOOST");
}

export function passiveBonus(openSourceLevels) {
  return totalBonusByType(openSourceLevels, "PASSIVE_BOOST");
}

/** LOC earned by one click, given the open-source levels. */
export function locPerClick(openSourceLevels) {
  return BALANCE.mechanics.baseLocPerClick * (1 + clickBonus(openSourceLevels));
}

/** Base passive LOC/sec from employees, before the passive bonus. */
export function baseLocPerSecond(employeeCounts) {
  return EMPLOYEE_TYPES.reduce(
    (sum, type) =>
      sum + BALANCE.employees[type].locPerSecond * (employeeCounts[type] ?? 0),
    0
  );
}

/** Total passive LOC/sec, including the Blocker passive bonus. */
export function locPerSecond(employeeCounts, openSourceLevels) {
  return baseLocPerSecond(employeeCounts) * (1 + passiveBonus(openSourceLevels));
}

/**
 * Cost in cents of the next hire of a type, when `count` are already owned.
 * Mirrors `getEmployeeCost` in the client: round(base * multiplier ^ count).
 */
export function employeeCost(employeeType, count) {
  const config = BALANCE.employees[employeeType];
  return Math.round(
    config.baseCost * Math.pow(config.costMultiplier, count)
  );
}

/** Cost in cents of buying `n` hires of a type, starting from `fromCount`. */
export function employeePurchaseCosts(employeeType, fromCount, n) {
  const costs = [];
  for (let i = 0; i < n; i += 1) {
    costs.push(employeeCost(employeeType, fromCount + i));
  }
  return costs;
}

/** Total LOC cost of raising a project from `fromLevel` to `toLevel`. */
export function openSourceLevelCosts(projectId, fromLevel, toLevel) {
  const config = BALANCE.openSource[projectId];
  let total = 0;
  for (let level = fromLevel; level < toLevel; level += 1) {
    total += config.levels[level].locCost;
  }
  return total;
}

/**
 * Whether one unlock condition is met by a save-shaped state.
 * Unknown condition types fail closed (locked), same as the client.
 */
export function conditionMet(condition, state) {
  switch (condition.type) {
    case "TOTAL_LOC":
      return state.totalLinesOfCode >= condition.target;
    case "TOTAL_EMPLOYEE_COUNT":
      return totalEmployees(state.employees) >= condition.target;
    case "SPECIFIC_EMPLOYEE_COUNT":
      return (
        (state.employees[condition.employeeType] ?? 0) >= condition.target
      );
    default:
      return false;
  }
}

/** Whether every unlock condition for an employee type is met. */
export function employeeUnlockConditionsMet(employeeType, state) {
  const config = BALANCE.employees[employeeType];
  if (!config) return false;
  return config.unlockConditions.every((condition) =>
    conditionMet(condition, state)
  );
}

/** Whether every unlock condition for an open-source project is met. */
export function openSourceUnlockConditionsMet(projectId, state) {
  const config = BALANCE.openSource[projectId];
  if (!config) return false;
  return config.unlockConditions.every((condition) =>
    conditionMet(condition, state)
  );
}

/** The save state a brand-new player starts from. Unlocks derive from the configs. */
export function initialSaveState() {
  const unlockedEmployees = {};
  for (const type of EMPLOYEE_TYPES) {
    unlockedEmployees[type] =
      BALANCE.employees[type].unlockConditions.length === 0;
  }
  const unlockedOpenSourceProjects = {};
  for (const projectId of OPEN_SOURCE_IDS) {
    unlockedOpenSourceProjects[projectId] =
      BALANCE.openSource[projectId].unlockConditions.length === 0;
  }
  return {
    linesOfCode: BALANCE.mechanics.startingLoc,
    totalLinesOfCode: 0,
    money: BALANCE.mechanics.startingMoney,
    employees: { intern: 0, junior: 0, senior: 0 },
    aiAssistants: { noPilot: 0 },
    freelanceProjectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    openSourceProjects: { overReactFramework: 0, blocker: 0 },
    unlockedEmployees,
    unlockedOpenSourceProjects,
  };
}
