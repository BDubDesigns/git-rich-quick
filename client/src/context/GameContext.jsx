import { useReducer, useContext, createContext } from "react";
const GameContext = createContext();

// Immutable generator configuration
export const GENERATOR_CONFIGS = {
  intern: {
    name: "Intern",
    baseCost: 10,
    locPerSecond: 1,
    costMultiplier: 1.1,
  },
  junior: {
    name: "Junior Developer",
    baseCost: 50,
    locPerSecond: 5,
    costMultiplier: 1.15,
  },
  senior: {
    name: "Senior Developer",
    baseCost: 200,
    locPerSecond: 20,
    costMultiplier: 1.2,
  },
};

// Immutable AI assistant configuration
export const AI_ASSISTANT_CONFIGS = {
  noPilot: {
    name: "GitNub NoPilot",
    baseCost: 1000,
    multiplier: 0.05,
    costMultiplier: 1.5,
  },
};

// Immutable freelance projects configuration
export const FREELANCE_PROJECTS_CONFIG = {
  toDoListApp: {
    name: "To Do List App",
    description:
      "A simple to-do list application. Cuz that's never been done before. Ever.",
    loc: 100,
    reward: 50,
  },
  hobbyWebsite: {
    name: "Hobby Website",
    description:
      "A personal website for a client to showcase their hobbies. The world needs to know about Bob's passion for stamp collecting.",
    loc: 750,
    reward: 150,
  },
  paradigmShiftingBlockchainProject: {
    name: "Paradigm-Shifting Blockchain Project",
    description:
      "A very useful project that leverages the blockchain to convert hype, overpromises, and investor's money into your money.",
    loc: 2000,
    reward: 500,
  },
};

// Initial state of the game
const initialState = {
  // Core currencies
  linesOfCode: 0,
  totalLinesOfCode: 0,
  money: 500,

  // Generators (count only - config comes from GENERATOR_CONFIGS)
  generators: {
    // eventually these will be populated from GENERATOR_CONFIGS
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
};

function gameReducer(state, action) {
  switch (action.type) {
    case "WRITE_CODE":
      // Player clicks the "Write Code" button
      return {
        // spread the state to keep other properties unchanged
        ...state,
        // increment linesOfCode by 10 for now, later by a dynamic value
        linesOfCode: state.linesOfCode + 10,
      };

    // Buy a generator (intern, junior, or senior)
    case "BUY_GENERATOR": {
      const { generatorType } = action.payload;
      const config = GENERATOR_CONFIGS[generatorType];
      const generator = state.generators[generatorType];

      if (!config || !generator) {
        console.warn(`Unknown generator type: ${generatorType}`);
        return state;
      }

      // Calculate current cost (increases with each purchase)
      const currentCost =
        config.baseCost * Math.pow(config.costMultiplier, generator.count);

      // Check if player has enough money
      if (state.money >= currentCost) {
        return {
          ...state,
          money: state.money - currentCost,
          generators: {
            ...state.generators,
            [generatorType]: {
              ...generator,
              count: generator.count + 1,
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

    // Game tick: called every second to generate LOC from generators
    case "GAME_TICK": {
      // Calculate passive LOC generation
      let passiveLOC = 0;
      Object.entries(state.generators).forEach(([generatorType, generator]) => {
        const config = GENERATOR_CONFIGS[generatorType];
        passiveLOC += config.locPerSecond * generator.count;
      });

      // Add passive LOC to total and current
      return {
        ...state,
        linesOfCode: state.linesOfCode + passiveLOC,
        totalLinesOfCode: state.totalLinesOfCode + passiveLOC,
      };
    }

    // if action type doesn't make sense, just return current state
    default: {
      return state;
    }
  }
}

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGameContext() {
  const context = useContext(GameContext);

  if (!context) {
    throw new Error("useGameContext must be used within a GameProvider");
  }

  return context;
}
