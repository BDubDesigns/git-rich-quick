import { useGameContext, EMPLOYEE_CONFIGS } from "../context/GameContext";
import { formatMoney } from "../utils/currency.js";
import { ActionButton } from "./ActionButton.jsx";

export function Shop() {
  const { state, dispatch } = useGameContext();

  const handleBuyEmployee = (employeeType) => {
    dispatch({
      type: "BUY_EMPLOYEE",
      payload: { employeeType },
    });
  };

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
              <p>Owned: {employee.count}</p>
              <p>Production: {config.locPerSecond} LOC/sec</p>
              <p>Cost: ${formatMoney(currentCost)}</p>
              <ActionButton
                onClick={() => handleBuyEmployee(employeeType)}
                disabled={!canAfford}
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
