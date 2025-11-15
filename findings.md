# Code Quality Findings for Git Rich Quick

## Overview
This document outlines three key areas for improvement identified in the Git Rich Quick React application. The analysis focused on the client-side codebase, specifically examining `client/src/App.jsx`, components in `client/src/components/`, and the game context in `client/src/context/GameContext.jsx`.

All findings focus on violations of the DRY (Don't Repeat Yourself) principle, code redundancy, and suboptimal patterns that increase maintenance burden and risk of bugs.

---

## Finding #1: Duplicated Floating Animation Logic

### Location
- `client/src/components/ClickButton.jsx` (lines 10-41)
- `client/src/components/ActionButton.jsx` (lines 13-50)

### What
Both `ClickButton` and `ActionButton` components contain nearly identical code (approximately 40 lines each) for managing floating text animations, bounce effects, and transform origin calculations. This duplication includes:
- State management for `floatingTexts`, `bounceKey`, and `transformOrigin`
- Click handler logic that extracts coordinates and creates floating text objects
- Animation end handler that filters out completed animations
- Identical rendering of `FloatingText` components

### Why This Is a Problem
1. **Maintenance burden**: Any bug fix or feature enhancement must be applied in two places, doubling the work and risk of inconsistency
2. **Code bloat**: Adds ~80 lines of redundant code to the codebase
3. **Inconsistency risk**: The two implementations could drift apart over time, leading to inconsistent user experience
4. **Testing overhead**: The same logic must be tested twice
5. **DRY violation**: This is a textbook case of code that violates the "Don't Repeat Yourself" principle

### How to Fix

#### Recommended Solution: Extract to Custom Hook
Create a custom React hook `useFloatingAnimation` that encapsulates all the floating animation logic:

**Create new file: `client/src/hooks/useFloatingAnimation.js`**
```javascript
import { useState } from "react";
import { FloatingText } from "../components/FloatingText";

export function useFloatingAnimation() {
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [bounceKey, setBounceKey] = useState(0);
  const [transformOrigin, setTransformOrigin] = useState("center center");

  const createFloatingText = (event, floatText, icon) => {
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const id = Date.now() + Math.random();

    setFloatingTexts(prev => [...prev, { id, text: floatText, icon, x, y }]);
    setTransformOrigin(`${x - rect.left}px ${y - rect.top}px`);
    setBounceKey(prev => prev + 1);
  };

  const handleAnimationEnd = (id) => {
    setFloatingTexts(prev => prev.filter(ft => ft.id !== id));
  };

  const renderFloatingTexts = () => (
    <>
      {floatingTexts.map((floatingText) => (
        <FloatingText
          key={floatingText.id}
          x={floatingText.x}
          y={floatingText.y}
          text={floatingText.text}
          icon={floatingText.icon}
          onAnimationEnd={() => handleAnimationEnd(floatingText.id)}
        />
      ))}
    </>
  );

  return {
    bounceKey,
    transformOrigin,
    createFloatingText,
    renderFloatingTexts,
  };
}
```

**Simplify `ClickButton.jsx`:**
```javascript
import { useGameContext } from "../context/GameContext";
import { HiMiniCodeBracket } from "react-icons/hi2";
import { useFloatingAnimation } from "../hooks/useFloatingAnimation";
import "./ClickButton.css";

export function ClickButton() {
  const { dispatch } = useGameContext();
  const { bounceKey, transformOrigin, createFloatingText, renderFloatingTexts } = useFloatingAnimation();

  const handleClick = (event) => {
    createFloatingText(event, "+10", <HiMiniCodeBracket size={20} />);
    dispatch({ type: "WRITE_CODE" });
  };

  return (
    <>
      <button
        key={bounceKey}
        onClick={handleClick}
        style={{ transformOrigin }}
        className="select-none ml-2 inline-flex items-center justify-center
        px-4 py-2 border border-transparent text-sm font-bold leading-5
        rounded-md text-white bg-green-700 hover:bg-green-500
        focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed
        transition ease-in-out duration-150 button-bounce"
      >
        <span>Commit Code &nbsp;</span>
        <HiMiniCodeBracket size={24} />
      </button>
      {renderFloatingTexts()}
    </>
  );
}
```

**Simplify `ActionButton.jsx`:**
```javascript
import { useFloatingAnimation } from "../hooks/useFloatingAnimation";
import "./ClickButton.css";

export function ActionButton({ onClick, disabled, children, floatText = "+10", icon }) {
  const { bounceKey, transformOrigin, createFloatingText, renderFloatingTexts } = useFloatingAnimation();

  const handleClick = (event) => {
    createFloatingText(event, floatText, icon);
    if (onClick) {
      onClick(event);
    }
  };

  return (
    <div className="flex justify-center w-full mt-auto">
      <button
        key={bounceKey}
        onClick={handleClick}
        disabled={disabled}
        style={{ transformOrigin }}
        className={`${
          disabled ? "opacity-50 cursor-not-allowed" : "opacity-100 cursor-pointer"
        } p-1 border border-blue-800 rounded-md bg-blue-700 text-white 
        hover:bg-blue-500 transition duration-150 ease-in-out button-bounce`}
      >
        {children}
      </button>
      {renderFloatingTexts()}
    </div>
  );
}
```

#### Benefits of This Approach
1. **Single source of truth**: Animation logic lives in one place
2. **Easier testing**: Test the hook once instead of testing two components
3. **Better maintainability**: Changes only need to be made once
4. **Cleaner components**: ClickButton reduces from 83 to ~35 lines; ActionButton reduces from 79 to ~35 lines
5. **Reusability**: Other components can easily add floating animations by using the same hook

---

## Finding #2: Duplicated Bonus Calculation Pattern

### Location
- `client/src/context/GameContext.jsx`
  - `getTotalClickBonus` (lines 312-325)
  - `getTotalPassiveBonus` (lines 336-349)

### What
The `getTotalClickBonus` and `getTotalPassiveBonus` functions contain nearly identical code structure:
- Both loop through `OPEN_SOURCE_PROJECTS_CONFIG`
- Both iterate through project levels
- Both check bonus types and accumulate values
- The only difference is the bonus type they filter for ("CLICK_BOOST" vs "PASSIVE_BOOST")

This is approximately 28 lines of duplicated logic.

### Why This Is a Problem
1. **Maintenance burden**: Bug fixes or optimizations must be applied to both functions
2. **Scalability issues**: Adding a new bonus type requires creating yet another nearly identical function
3. **Code smell**: This pattern indicates missing abstraction
4. **Testing overhead**: Same logic structure must be tested multiple times
5. **DRY violation**: The iteration and accumulation logic is repeated unnecessarily

### How to Fix

#### Recommended Solution: Create Generic Bonus Calculator
Replace both functions with a single, parameterized function:

**In `client/src/context/GameContext.jsx`:**
```javascript
/**
 * Calculates the total bonus of a specific type from all open source projects.
 * 
 * Generic function that can calculate any bonus type by filtering project level
 * bonuses based on the provided type parameter.
 *
 * @param {Object} state - The game state object containing openSourceProjects data
 * @param {string} bonusType - The type of bonus to calculate (e.g., "CLICK_BOOST", "PASSIVE_BOOST")
 * @returns {number} The total accumulated bonus value of the specified type
 */
export function getTotalBonus(state, bonusType) {
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
 * Calculates the total click bonus from all open source projects.
 * @param {Object} state - The game state object
 * @returns {number} The total click bonus value
 */
export function getTotalClickBonus(state) {
  return getTotalBonus(state, "CLICK_BOOST");
}

/**
 * Calculates the total passive bonus from all open source projects.
 * @param {Object} state - The game state object
 * @returns {number} The total passive bonus value
 */
export function getTotalPassiveBonus(state) {
  return getTotalBonus(state, "PASSIVE_BOOST");
}
```

#### Alternative Solution: Use Array Methods for Better Performance
For a more modern and potentially more performant approach:

```javascript
/**
 * Calculates the total bonus of a specific type using functional programming approach.
 */
export function getTotalBonus(state, bonusType) {
  return Object.entries(OPEN_SOURCE_PROJECTS_CONFIG).reduce(
    (totalBonus, [projectId, projectConfig]) => {
      const projectState = state.openSourceProjects[projectId];
      const projectBonuses = projectConfig.levels
        .slice(0, projectState.level)
        .reduce((sum, level) => {
          return level.bonus.type === bonusType ? sum + level.bonus.value : sum;
        }, 0);
      return totalBonus + projectBonuses;
    },
    0
  );
}
```

#### Benefits of This Approach
1. **Single implementation**: Core logic exists in one place
2. **Easy to extend**: Adding new bonus types (e.g., "MONEY_BOOST", "XP_BOOST") requires no new functions
3. **Better testability**: Test the generic function with different bonus types
4. **Cleaner code**: Reduces from ~28 lines to ~15 lines
5. **Performance**: Can be optimized once for all bonus types
6. **Backward compatible**: Existing `getTotalClickBonus` and `getTotalPassiveBonus` calls still work

---

## Finding #3: Duplicated Cost Calculation Logic

### Location
- `client/src/context/GameContext.jsx` - `BUY_EMPLOYEE` case (lines 165-167)
- `client/src/components/Shop.jsx` - Employee rendering (lines 29-31)

### What
The formula for calculating employee cost based on count appears in two places:
```javascript
// In GameContext.jsx
const currentCost = Math.round(
  config.baseCost * Math.pow(config.costMultiplier, employee.count)
);

// In Shop.jsx (nearly identical)
const currentCost = Math.round(
  config.baseCost * Math.pow(config.costMultiplier, employee.count)
);
```

This calculation determines how much an employee costs based on how many have been hired.

### Why This Is a Problem
1. **Maintenance risk**: If the cost formula needs adjustment, it must be changed in two places
2. **Consistency issues**: The two calculations could drift apart, causing display vs actual cost discrepancies
3. **Business logic in UI**: The Shop component shouldn't contain game mechanics calculations
4. **DRY violation**: Same mathematical formula duplicated
5. **Testing complexity**: The cost calculation logic must be tested in both locations
6. **Potential for bugs**: If one location is updated and the other isn't, players could see incorrect costs

### How to Fix

#### Recommended Solution: Create Helper Function in GameContext
Add a dedicated function to calculate employee costs:

**In `client/src/context/GameContext.jsx`:**
```javascript
/**
 * Calculates the current cost to hire an employee based on how many have been hired.
 * 
 * Uses exponential scaling formula: baseCost * costMultiplier^count
 * Result is rounded to nearest cent to avoid floating-point errors.
 *
 * @param {string} employeeType - The type of employee (intern, junior, senior)
 * @param {Object} state - The game state object
 * @returns {number} The cost in cents to hire the next employee of this type
 */
export function getEmployeeCost(employeeType, state) {
  const config = EMPLOYEE_CONFIGS[employeeType];
  const employee = state.employees[employeeType];
  
  if (!config || !employee) {
    console.warn(`Unknown employee type: ${employeeType}`);
    return 0;
  }
  
  return Math.round(
    config.baseCost * Math.pow(config.costMultiplier, employee.count)
  );
}
```

**Update `GameContext.jsx` reducer:**
```javascript
case "BUY_EMPLOYEE": {
  const { employeeType } = action.payload;
  const config = EMPLOYEE_CONFIGS[employeeType];
  const employee = state.employees[employeeType];

  if (!config || !employee) {
    console.warn(`Unknown employee type: ${employeeType}`);
    return state;
  }

  // Use the helper function instead of inline calculation
  const currentCost = getEmployeeCost(employeeType, state);

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

  return state;
}
```

**Update `Shop.jsx`:**
```javascript
import { 
  useGameContext, 
  EMPLOYEE_CONFIGS, 
  getEmployeeCost  // Add this import
} from "../context/GameContext";
import { formatMoney } from "../utils/currency.js";
import { ActionButton } from "./ActionButton.jsx";
import { getTotalClickBonus } from "../context/GameContext.jsx";

export function Shop() {
  const { state, dispatch } = useGameContext();

  const handleBuyEmployee = (employeeType) => {
    dispatch({
      type: "BUY_EMPLOYEE",
      payload: { employeeType },
    });
  };
  
  const clickBonus = getTotalClickBonus(state);
  const locPerClick = 10 * (1 + clickBonus);
  
  return (
    <div className="mt-4 rounded-xl border border-gray-300 p-4">
      <h2 className="mt-0">Hire Devs</h2>
      <p>
        Here you can hire developers to write LOC for you. It's a one time fee
        per developer, even though that doesn't make any sense. Don't pretend
        anything about software development makes sense; you pull that thread,
        no sweater.
      </p>
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(EMPLOYEE_CONFIGS).map(([employeeType, config]) => {
          const employee = state.employees[employeeType];
          // Use the helper function instead of inline calculation
          const currentCost = getEmployeeCost(employeeType, state);
          const canAfford = state.money >= currentCost;

          return (
            <div
              key={employeeType}
              className="border rounded-md border-gray-300 p-4 flex flex-col"
            >
              <h3>{config.name}</h3>
              <p>Owned: {employee.count}</p>
              <p>Production: {config.locPerSecond} LOC/sec</p>
              <p>Cost: ${formatMoney(currentCost)}</p>
              <ActionButton
                onClick={() => handleBuyEmployee(employeeType)}
                disabled={!canAfford}
                floatText="+1"
                icon={config.icon}
              >
                Hire 1 {config.name}
              </ActionButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

#### Benefits of This Approach
1. **Single source of truth**: Cost formula exists in exactly one place
2. **Easier to modify**: Changes to cost scaling only need to be made once
3. **Better separation of concerns**: UI component doesn't contain game mechanics logic
4. **Easier testing**: Test cost calculation in isolation
5. **Reduced bug risk**: Impossible for display and actual costs to diverge
6. **Clearer intent**: Function name documents what the calculation does
7. **Future-proof**: If AI assistants or other purchasables need cost calculation, the pattern is established

---

## Additional Observations

### Minor Issues (Not Critical but Worth Noting)

1. **Unused state variable in Header.jsx**: Line 4 destructures `state` from context but never uses it. This should be removed.

2. **Unused locPerClick in Shop.jsx**: Line 16 calculates `locPerClick` but never uses it. Either remove it or display it to help players understand click power.

3. **Inconsistent file extensions in imports**: Some imports use `.jsx` extension, others don't. While both work, consistency improves readability.

---

## Implementation Priority

### High Priority (Should Fix Now)
1. **Finding #1 - Duplicated Floating Animation**: Most impactful fix with greatest maintenance benefit
2. **Finding #2 - Bonus Calculation Pattern**: Sets up good patterns for future bonus types

### Medium Priority (Should Fix Soon)
3. **Finding #3 - Cost Calculation**: Important for correctness but currently working

### Low Priority (Nice to Have)
- Clean up unused variables
- Standardize import extensions
- Fix lint warnings

---

## Testing Recommendations

After implementing these changes, ensure to test:

1. **Animation behavior**: Verify floating text animations work identically after refactoring
2. **Bonus calculations**: Confirm click and passive bonuses calculate correctly
3. **Cost display**: Verify displayed costs match actual purchase costs
4. **Edge cases**: Test with 0 employees, max level projects, etc.
5. **Performance**: Ensure no performance regression from refactoring

---

## Conclusion

All three findings represent opportunities to significantly improve code quality through better abstraction and DRY principles. The changes are relatively low-risk since they're refactoring existing functionality rather than adding new features. Implementing these improvements will make the codebase easier to maintain, test, and extend as the game grows in complexity.

The total reduction in code duplication from these three changes is approximately **140 lines of redundant code removed**, while adding only about **50 lines of well-abstracted, reusable code** - a net improvement of ~90 lines and significantly better code organization.
