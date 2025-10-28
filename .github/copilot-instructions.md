# Git Rich Quick - AI Agent Coding Guidelines

Git Rich Quick is an **idle game** built with **React + Vite** where players "commit code" to earn money and hire developers. This guide helps AI agents make productive contributions aligned with the game's architecture and conventions.

## Quick Start

- **Build:** `npm run build` (from `client/` directory)
- **Dev:** `npm run dev` (from `client/` directory)
- **Lint:** `npm run lint` (from `client/` directory)
- **Stack:** Monorepo (client: React 19 + Vite + Tailwind CSS; server: TBD)
- **Key Files:** `client/src/context/GameContext.jsx` (all game logic), `client/src/App.jsx` (main component)

## Architecture: Config + State Separation Pattern

**This is the core architectural principle—understand this first.**

All game balance data lives in **immutable config objects** in `GameContext.jsx`. State stores only **counts and currency**. This separation:

- Makes rebalancing easy (adjust config, game instantly rebalances)
- Keeps the reducer clean and predictable
- Prevents bugs from state-level balance changes

### Config Objects (Immutable)

Located at the top of `GameContext.jsx`:

```javascript
// All costs are in CENTS to avoid floating-point errors
export const EMPLOYEE_CONFIGS = {
  intern: {
    name: "Intern",
    baseCost: 1000,
    locPerSecond: 1,
    costMultiplier: 1.1,
    icon: <Icon />,
  },
  junior: {
    name: "Junior Developer",
    baseCost: 5000,
    locPerSecond: 5,
    costMultiplier: 1.15,
    icon: <Icon />,
  },
  senior: {
    name: "Senior Developer",
    baseCost: 20000,
    locPerSecond: 20,
    costMultiplier: 1.2,
    icon: <Icon />,
  },
};

export const FREELANCE_PROJECTS_CONFIG = {
  toDoListApp: { name: "To Do List App", loc: 100, reward: 5000 },
  // ... more projects
};

export const OPEN_SOURCE_PROJECTS_CONFIG = {
  overReactFramework: {
    name: "OverReact Framework",
    levels: [
      { locCost: 1000, bonus: { type: "CLICK_BOOST", value: 0.1 } },
      { locCost: 5000, bonus: { type: "CLICK_BOOST", value: 0.2 } },
    ],
  },
  // ... more projects
};
```

### State (Counts Only)

State in the reducer only tracks quantities and currencies:

```javascript
const initialState = {
  linesOfCode: 0,
  totalLinesOfCode: 0, // cumulative, never decreases
  money: 50000, // in cents (50000 = $500.00)
  employees: {
    intern: { count: 0 },
    junior: { count: 0 },
    senior: { count: 0 },
  },
  aiAssistants: { noPilot: { count: 0 } },
  freelanceProjectsCompleted: { toDoListApp: 0, hobbyWebsite: 0 /* ... */ },
  openSourceProjects: {
    overReactFramework: { level: 0 },
    nodeRuntime: { level: 0 },
  },
};
```

**When adding new game features:** Create a config object in `GameContext.jsx`, then add state storage for it. Never hardcode balance values in components or reducer logic.

## Game Mechanics

### Currency: Cents, Not Dollars

All internal calculations use **cents (integers)** to avoid floating-point errors in long-running idle games:

- `1000` cents = `$10.00`
- Use `formatMoney()` from `client/src/utils/currency.js` for display
- Functions: `dollarsToCents()`, `centsToDollars()`

### LOC Generation (Two Paths)

1. **Click LOC:** `calculateLOCPerClick(state)` — Base 10 LOC × (1 + click bonuses from open-source projects)
2. **Passive LOC:** `calculateLOCPerSecond(state)` — Employees' production × (1 + passive bonuses from open-source projects)

Both fire on `GAME_TICK` (every 1 second in `App.jsx`) or `WRITE_CODE` (player clicks "Commit Code").

### Employee Cost Formula

Costs **scale exponentially** with each purchase:

```
Cost = baseCost × (costMultiplier ^ employee.count)
```

Use `getEmployeeCost(employeeType, state)` to retrieve current cost. This prevents the reducer from recalculating and keeps balance easily tunable.

### Open-Source Projects (Bonus System)

Projects grant **multiplicative bonuses** to LOC generation. Two bonus types:

- `CLICK_BOOST`: Increases LOC per click (e.g., `value: 0.1` = 10% bonus)
- `PASSIVE_BOOST`: Increases LOC per second (e.g., `value: 0.05` = 5% bonus)

Use helper functions (exported from `GameContext.jsx`):

- `getTotalClickBonus(state)` — Sum of all unlocked click bonuses
- `getTotalPassiveBonus(state)` — Sum of all unlocked passive bonuses

## Game Loop

1. **App.jsx** sets `setInterval(() => dispatch({ type: "GAME_TICK" }), 1000)` — fires every second
2. **Reducer** handles `GAME_TICK` → calls `calculateLOCPerSecond()` → adds to `linesOfCode` and `totalLinesOfCode`
3. **Player clicks** dispatch `WRITE_CODE` → calls `calculateLOCPerClick()` → adds to `linesOfCode`
4. **Components** read from `state` and dispatch actions on user interaction

## Component Patterns

### Floating Text & Bounce Animation

Both `ClickButton.jsx` and `ActionButton.jsx` implement:

1. **Floating text:** Small text that floats away from click point (e.g., "+10 LOC")
2. **Bounce animation:** Button scales on click (defined in `ClickButton.css`)

The `FloatingText.jsx` component handles animation logic. Reuse `ActionButton.jsx` for any button that needs this effect.

### Component Structure

- **Header, Footer:** Static UI
- **ButtonBox:** Contains `ClickButton` (main "Commit Code" button)
- **Shop:** Buy employees; maps over `EMPLOYEE_CONFIGS` to render employee cards
- **Projects:** Buy freelance projects; maps over `FREELANCE_PROJECTS_CONFIG`
- **OpenSource:** Contribute LOC to open-source projects; maps over `OPEN_SOURCE_PROJECTS_CONFIG`

Components use `useGameContext()` to access `state` and `dispatch`. All balance data comes from configs, not hardcoded in components.

## Reducer Actions Reference

- `WRITE_CODE`: Player clicked "Commit Code" button
- `BUY_EMPLOYEE`: Purchase an employee (checks affordability)
- `COMPLETE_PROJECT`: Complete a freelance project (deducts LOC, adds money)
- `GAME_TICK`: Timer tick; passive LOC generation
- `CONTRIBUTE_TO_PROJECT`: Unlock next level of open-source project (deducts LOC, increments level)

Each action updates state immutably and validates conditions (e.g., enough money/LOC).

## Adding New Features

### Checklist for New Game Element

1. **Create config object** in `GameContext.jsx` (e.g., `POWER_UPS_CONFIG`)
2. **Add to initialState** in `GameContext.jsx` (e.g., `powerUps: { speedBoost: { level: 0 } }`)
3. **Add reducer case** (e.g., `case "BUY_POWER_UP"`)
4. **Export helper functions** if calculations are needed (e.g., `getTotalPowerUpBonus()`)
5. **Create component** that maps over config and dispatches actions
6. **Import component** in `App.jsx` or parent container

Example: Adding a "Coffee Machine" that costs money and boosts passive LOC:

```javascript
// In GameContext.jsx
export const COFFEE_MACHINES_CONFIG = {
  basic: { name: "Basic Coffee", baseCost: 10000, passiveBoost: 0.1 },
};
// Add to initialState
coffeeMachines: { basic: { count: 0 } }
// Add reducer case
case "BUY_COFFEE_MACHINE": { /* ... */ }
// Export helper
export function getTotalCoffeeBoost(state) { /* ... */ }
```

Then use in a component. Balance adjustments = config changes only.

## Development Workflow

1. **Edit configs** → Game rebalances immediately (if HMR works) or on reload
2. **Test game balance** in browser; adjust multipliers/costs in configs
3. **Add new features** following the Config + State pattern
4. **Run lint:** `npm run lint` (ESLint checks for issues)
5. **Build for production:** `npm run build`

## Known Limitations & TODOs

- **Server placeholder:** `server/README.md` exists but server not implemented
- **No persistence:** Game state resets on page reload (no LocalStorage/backend save)
- **Unlock system pending:** Code to show/hide employees based on milestone (10 interns before junior visible) exists but not fully integrated
- **Floating popups:** Random reward popups (every 20 sec–2 min) are in ideas but not implemented

## Naming Conventions

- **employeeType:** Key like `"intern"`, `"junior"`, `"senior"` (maps to `EMPLOYEE_CONFIGS`)
- **projectId:** Key like `"toDoListApp"`, `"overReactFramework"` (maps to config)
- **LOC:** "Lines of Code" (in-game currency)
- **Costs/rewards in cents:** Always (e.g., `baseCost: 1000` = $10.00)
- **Bonus values as decimals:** `0.1` = 10% multiplier, not `10`

## Debugging Tips

- **Check GameContext exports:** Ensure new configs, helpers, and actions are exported
- **State validation:** Log `state` in reducer to verify immutability (use spread operator `...`)
- **Cost calculations:** Verify decimal precision; use `Math.round()` for cents
- **Component mapping:** If a config changes but components don't update, check if component imports the config correctly
- **Animation key:** Incrementing `bounceKey` forces React to re-render button and re-trigger CSS animation on every click

## References

- **Game Architecture Docs:** `dev/README.md` (full development plan and design rationale)
- **Completed Guides:** `dev/completed/` (specific feature implementation guides)
- **Main Game State:** `client/src/context/GameContext.jsx`
- **App Entry:** `client/src/App.jsx`
