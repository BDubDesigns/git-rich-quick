import { createContext, useReducer, useContext } from "react";
const GameContext = createContext();

// Immutable generator configuration
export const GENERATOR_CONFIGS = {
  intern: {
    name: "Intern",
    baseCost: 10,
    locPerSecond: 1,
    costMultiplier: 1.15,
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
    costMultiplier: 1.15,
  },
};

const AI_ASSISTANT_CONFIGS = {
  noPilot: {
    name: "GitNub NoPilot",
    baseCost: 1000,
    multiplier: 0.05,
    costMultiplier: 1.5,
  },
};

const initialState = {
  // Core currencies
  linesOfCode: 0,
  money: 0,

  // Generators (count only - config comes from GENERATOR_CONFIGS)
  generators: {
    intern: { count: 0 },
    junior: { count: 0 },
    senior: { count: 0 },
  },

  // Freelance Projects
  freelanceProjects: {
    toDoListApp: {
      name: "To Do List App",
      description: "A simple to-do list application.",
      loc: 100,
      reward: 50,
    },
    hobbyWebsite: {
      name: "Hobby Website",
      description: "A personal website to showcase hobbies.",
      loc: 200,
      reward: 150,
    },
    uselessBlockchainProject: {
      name: "Useless Blockchain Project",
      description: "A blockchain project with no real use.",
      loc: 300,
      reward: 300,
    },
  },

  // AI Assistants
  noPilotSeats: 0,
  codeRaccoonSeats: 0,
  noPilotCost: 100,
  codeRaccoonBaseCost: 150,
  codeRaccoonDiscountPerSeat: 0.05,
};

function gameReducer(state, action) {
  switch (action.type) {
    // Example: Player clicks the "Write Code" button
    case "WRITE_CODE":
      return {
        ...state,
        linesOfCode: state.linesOfCode + 10,
      };

    // Example: Game tick runs (happens every 1 second)
    case "GAME_TICK": {
      // Calculate passive LOC generation from all generators
      let passiveLOC = 0;
      Object.keys(state.generators).forEach((generatorType) => {
        const config = GENERATOR_CONFIGS[generatorType];
        const count = state.generators[generatorType].count;
        passiveLOC += count * config.locPerSecond;
      });

      return {
        ...state,
        linesOfCode: state.linesOfCode + passiveLOC,
      };
    }

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

    // Example: Player converts LOC to money
    case "COMPLETE_PROJECT": {
      const moneyEarned = action.payload * state.locToMoneyRate;
      return {
        ...state,
        linesOfCode: state.linesOfCode - action.payload,
        money: state.money + moneyEarned,
      };
    }

    // Default: if action type doesn't match any case
    default:
      return state;
  }
}
