import { useReducer, useContext, createContext } from "react";
import { GiPlasticDuck } from "react-icons/gi";
import { HiOutlineBriefcase, HiStar } from "react-icons/hi2";

const GameContext = createContext();

// Immutable employee configuration
// All costs are in CENTS to avoid floating-point errors in idle games
export const EMPLOYEE_CONFIGS = {
  intern: {
    name: "Intern",
    baseCost: 1000, // $10.00
    locPerSecond: 1,
    costMultiplier: 1.1,
    icon: <GiPlasticDuck size={20} />,
  },
  junior: {
    name: "Junior Developer",
    baseCost: 5000, // $50.00
    locPerSecond: 5,
    costMultiplier: 1.15,
    icon: <HiOutlineBriefcase size={20} />,
  },
  senior: {
    name: "Senior Developer",
    baseCost: 20000, // $200.00
    locPerSecond: 20,
    costMultiplier: 1.2,
    icon: <HiStar size={20} />,
  },
};

// Immutable AI assistant configuration
// All costs are in CENTS to avoid floating-point errors in idle games
export const AI_ASSISTANT_CONFIGS = {
  noPilot: {
    name: "GitNub NoPilot",
    baseCost: 100000, // $1000.00
    multiplier: 0.05,
    costMultiplier: 1.5,
  },
};

// Immutable freelance projects configuration
// All rewards are in CENTS to avoid floating-point errors in idle games
export const FREELANCE_PROJECTS_CONFIG = {
  toDoListApp: {
    name: "To Do List App",
    description:
      "A simple to-do list application. Cuz that's never been done before. Ever.",
    loc: 100,
    reward: 5000, // $50.00
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
};

export const OPEN_SOURCE_PROJECTS_CONFIG = {
  overReactFramework: {
    name: "OverReact Framework",
    description:
      "An open-source JavaScript framework that makes building web applications unnecessarily complex and bloated.",
    // No unlock condition for this one, available from start
    levels: [
      { locCost: 1000, bonus: { type: "CLICK_BOOST", value: 0.1 } },
      { locCost: 5000, bonus: { type: "CLICK_BOOST", value: 0.2 } },
      { locCost: 30000, bonus: { type: "CLICK_BOOST", value: 0.3 } },
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
      { locCost: 2000, bonus: { type: "PASSIVE_BOOST", value: 0.05 } },
      { locCost: 10000, bonus: { type: "PASSIVE_BOOST", value: 0.07 } },
      { locCost: 75000, bonus: { type: "PASSIVE_BOOST", value: 0.1 } },
    ],
  },
};

// Initial state of the game
const initialState = {
  // Core currencies
  linesOfCode: 0,
  totalLinesOfCode: 0,
  money: 50000, // $500.00 in cents

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
    case "WRITE_CODE":
      const clickBonus = getTotalClickBonus(state);
      const locPerClick = 10 * (1 + clickBonus);
      return {
        // spread the state to keep other properties unchanged
        ...state,
        // increment linesOfCode by dynamic locPerClick
        linesOfCode: state.linesOfCode + locPerClick,
      };

    // Buy an employee (intern, junior, or senior)
    case "BUY_EMPLOYEE": {
      const { employeeType } = action.payload;
      const config = EMPLOYEE_CONFIGS[employeeType];
      const employee = state.employees[employeeType];

      if (!config || !employee) {
        console.warn(`Unknown employee type: ${employeeType}`);
        return state;
      }

      // Calculate current cost in cents (increases with each purchase)
      // Round to nearest cent to avoid floating-point errors
      const currentCost = Math.round(
        config.baseCost * Math.pow(config.costMultiplier, employee.count)
      );

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
      const locFromEmployees = getCurrentLOCPerSecond(state);
      const passiveBonus = getTotalPassiveBonus(state);
      const totalPassiveLOC = locFromEmployees * (1 + passiveBonus);

      // Add passive LOC to total and current and log to console
      console.log(
        `Generated ${totalPassiveLOC.toFixed(
          2
        )} LOC this tick. Breakdown: ${locFromEmployees.toFixed(
          2
        )} LOC from employees, +${(locFromEmployees * passiveBonus).toFixed(
          2
        )} LOC from bonuses.`
      );
      return {
        ...state,
        linesOfCode: state.linesOfCode + totalPassiveLOC,
        totalLinesOfCode: state.totalLinesOfCode + totalPassiveLOC,
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
 * Utility functions for calculating and retrieving game state values.
 * These functions provide convenient ways to derive information from the
 * current game state without modifying it.
 */

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
 * Calculates the total click bonus from all open source projects based on their current levels.
 *
 * Iterates through each project in the configuration, and for each project level that has been
 * unlocked, accumulates any bonuses of type "CLICK_BOOST" into the total bonus value.
 *
 * @param {Object} state - The game state object containing openSourceProjects data
 * @param {Object} state.openSourceProjects - Object mapping project IDs to their current state (includes level property)
 * @returns {number} The total accumulated click bonus value from all projects
 */
export function getTotalClickBonus(state) {
  let totalBonus = 0;
  for (const projectId in OPEN_SOURCE_PROJECTS_CONFIG) {
    const projectState = state.openSourceProjects[projectId];
    const projectConfig = OPEN_SOURCE_PROJECTS_CONFIG[projectId];
    for (let i = 0; i < projectState.level; i++) {
      const levelBonus = projectConfig.levels[i].bonus;
      if (levelBonus.type === "CLICK_BOOST") {
        totalBonus += levelBonus.value;
      }
    }
  }
  return totalBonus;
}

/**
 * Calculates the total passive bonus from all open source projects based on their current levels.
 *
 * Iterates through each project and its levels, summing up all bonuses of type "PASSIVE_BOOST".
 *
 * @param {Object} state - The game state object containing open source projects data
 * @param {Object} state.openSourceProjects - Collection of open source projects with their current levels
 * @returns {number} The total accumulated passive bonus value from all projects
 */
export function getTotalPassiveBonus(state) {
  let totalBonus = 0;
  for (const projectId in OPEN_SOURCE_PROJECTS_CONFIG) {
    const projectState = state.openSourceProjects[projectId];
    const projectConfig = OPEN_SOURCE_PROJECTS_CONFIG[projectId];
    for (let i = 0; i < projectState.level; i++) {
      const levelBonus = projectConfig.levels[i].bonus;
      if (levelBonus.type === "PASSIVE_BOOST") {
        totalBonus += levelBonus.value;
      }
    }
  }
  return totalBonus;
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
