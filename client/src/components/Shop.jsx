import { useGameContext, EMPLOYEE_CONFIGS } from "../context/GameContext";
import { formatMoney } from "../utils/currency.js";
import { ActionButton } from "./ActionButton.jsx";
import { getTotalClickBonus } from "../context/GameContext.jsx";
// Import createElement to dynamically recreate icon components with custom sizes
import { createElement } from "react";

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
          const currentCost = Math.round(
            config.baseCost * Math.pow(config.costMultiplier, employee.count)
          );
          const canAfford = state.money >= currentCost;

          return (
            <div
              key={employeeType}
              className="border rounded-md border-gray-300 p-4 flex flex-col"
            >
              <h3>{config.name}</h3>
              <p className="flex justify-center w-full">
                {/* Recreate icon component with size 48 instead of default 20 for better visibility */}
                {createElement(config.icon.type, {
                  ...config.icon.props,
                  size: 48,
                })}
                {/* We spread the original icon's props to preserve any additional properties */}
              </p>
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
