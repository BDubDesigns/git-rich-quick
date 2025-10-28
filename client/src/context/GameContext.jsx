import { useReducer, useContext, createContext } from "react";
import { GiPlasticDuck } from "react-icons/gi";
import { BsBackpack } from "react-icons/bs";
import { BiCoffeeTogo } from "react-icons/bi";

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

  // ==== Starting Resources ====
  STARTING_MONEY: 0, // $0.00 in cents
  STARTING_LOC: 0, // Starting lines of code
});

// Immutable employee configuration
// All costs are in CENTS to avoid floating-point errors in idle games
export const EMPLOYEE_CONFIGS = Object.freeze({
  intern: {
    name: "Intern",
    baseCost: 2500, // $25.00
    locPerSecond: 1,
    costMultiplier: 1.1,
    icon: <GiPlasticDuck size={20} color="orange" />,
  },
  junior: {
    name: "Junior Developer",
    baseCost: 20000, // $200.00
    locPerSecond: 5,
    costMultiplier: 1.15,
    icon: <BsBackpack size={20} color="brown" />,
  },
  senior: {
    name: "Senior Developer",
    baseCost: 20000, // $200.00
    locPerSecond: 20,
    costMultiplier: 1.2,
    icon: <BiCoffeeTogo size={20} color="green" />,
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
export const FREELANCE_PROJECTS_CONFIG = Object.freeze({
  toDoListApp: {
    name: "To Do List App",
    description:
      "A simple to-do list application. Cuz that's never been done before. Ever.",
    loc: 50,
    reward: 2500, // $25.00
  },
  hobbyWebsite: {
    name: "Hobby Website",
    description:
      "A personal website for a client to showcase their hobbies. The world needs to know about Bob's passion for stamp collecting.",
    loc: 750,
    reward: 15000, // $150.00
  },
  paradigmShiftingBlockchainProject: {
    name: "Paradigm-Shifting Blockchain Project",
    description:
      "A very useful project that leverages the blockchain to convert hype, overpromises, and investor's money into your money.",
    loc: 2000,
    reward: 50000, // $500.00
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
      { locCost: 500, bonus: { type: "CLICK_BOOST", value: 1 } },
      { locCost: 3000, bonus: { type: "CLICK_BOOST", value: 2 } },
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

  // Click tracking for CPS calculation
  clickHistory: [], // Array of timestamps: [{ timestamp: Date.now(), count: 1 }, ...]
  currentCPS: 1110, // Cached CPS for display

  // Employees (count only - config comes from EMPLOYEE_CONFIGS)
  employees: {
    // eventually these will be populated from EMPLOYEE_CONFIGS
    // dynamically, but for now, for testing, we hard code
    intern: { count: 0 },
    junior: { count: 0 },
    senior: { count: 0 },
  },

  // AI Assistants (count only - config comes from AI_ASSISTANT_CONFIGS)
  aiAssistants: {
    // eventually these will be populated from AI_ASSISTANT_CONFIGS
    // dynamically, but for now, for testing, we hard code
    noPilot: { count: 0 },
  },

  freelanceProjectsCompleted: {
    // track number of times each project is completed
    // eventually these will be populated from FREELANCE_PROJECTS_CONFIG
    // dynamically, but for now, for testing, we hard code
    toDoListApp: 0,
    hobbyWebsite: 0,
    paradigmShiftingBlockchainProject: 0,
  },

  openSourceProjects: {
    // track levels of each open source project
    // eventually these will be populated from OPEN_SOURCE_PROJECTS_CONFIG
    overReactFramework: { level: 0 },
    nodeRuntime: { level: 0 },
  },
};

function gameReducer(state, action) {
  switch (action.type) {
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
      return {
        // spread the state to keep other properties unchanged
        ...state,
        // increment linesOfCode by dynamic locPerClick
        linesOfCode: state.linesOfCode + locPerClick,
        totalLinesOfCode: state.totalLinesOfCode + locPerClick,
        clickHistory: cleanedHistory,
        currentCPS: calculateCPS(cleanedHistory),
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

      // Calculate current cost
      const currentCost = getEmployeeCost(employeeType, state);

      // Check if player has enough money
      if (state.money >= currentCost) {
        return {
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
      }

      // Not enough money
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
        };
      } else {
        // Not enough LOC
        return state;
      }
    }

    // Game tick: called every second to generate LOC from employees
    case "GAME_TICK": {
      // Calculate passive LOC generation
      const totalPassiveLOC = calculateLOCPerSecond(state);
      // Clean up old click history
      const cleanedHistory = state.clickHistory.filter(
        (ts) => ts > Date.now() - 10000
      );
      // Add passive LOC to total and current
      return {
        ...state,
        linesOfCode: state.linesOfCode + totalPassiveLOC,
        totalLinesOfCode: state.totalLinesOfCode + totalPassiveLOC,
        clickHistory: cleanedHistory,
        currentCPS: calculateCPS(cleanedHistory),
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

/** * Calculates the current Clicks Per Second (CPS) based on click history.
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
