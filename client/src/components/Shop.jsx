import {
  useGameContext,
  EMPLOYEE_CONFIGS,
  getEmployeeCost,
  isEmployeeUnlocked,
  getUnlockProgress,
  hasCrossedUnlockThreshold,
} from "../context/GameContext";
import { EmployeeCard } from "./EmployeeCard.jsx";
import { LockedEmployeeCard } from "./LockedEmployeeCard.jsx";

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
          const unlocked = isEmployeeUnlocked(employeeType, state);

          if (unlocked) {
            // Already purchased: show purchasable card
            const currentCost = getEmployeeCost(employeeType, state);
            const canAfford = state.money >= currentCost;
            const ownedCount = state.employees[employeeType].count;

            return (
              <EmployeeCard
                key={employeeType}
                config={config}
                currentCost={currentCost}
                ownedCount={ownedCount}
                canAfford={canAfford}
                onPurchase={() => handleBuyEmployee(employeeType)}
              />
            );
          }

          // Not yet purchased: show locked card with progress
          const progress = getUnlockProgress(employeeType, state);
          const hasCrossedThreshold = hasCrossedUnlockThreshold(
            "employee",
            employeeType,
            state
          );

          // If we haven't crossed threshold, don't show card
          if (!hasCrossedThreshold) {
            return null; // Don't render anything for this employee
          }

          return (
            <LockedEmployeeCard
              key={employeeType}
              config={config}
              progress={progress}
            />
          );
        })}
      </div>
    </div>
  );
}
