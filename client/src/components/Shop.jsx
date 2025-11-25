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
import { CodeComment } from "./CodeComment.jsx";

export function Shop() {
  const { state, dispatch } = useGameContext();

  const handleBuyEmployee = (employeeType) => {
    dispatch({
      type: "BUY_EMPLOYEE",
      payload: { employeeType },
    });
  };

  return (
    <div className="primary-text">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1e1e1e] border-t border-[#0078d4] text-sm text-[#cccccc] w-fit">
        <span className="text-[#c5c53f]">JS</span>
        <h2 className="m-0">Hire Devs</h2>
        <button className="ml-auto text-[#858585] hover:text-[#ffffff]">
          ×
        </button>
      </div>

      <CodeComment>
        Here you can hire developers to write LOC for you. It's a one time fee
        per developer, even though that doesn't make any sense. Don't pretend
        anything about software development makes sense; you pull that thread,
        no sweater.
      </CodeComment>
      <div className="flex flex-col gap-4">
        {Object.entries(EMPLOYEE_CONFIGS).map(([employeeType, config]) => {
          const unlocked = isEmployeeUnlocked(employeeType, state);

          if (unlocked) {
            // Already unlocked: show purchasable card
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

          // Not yet unlocked: show locked card with progress
          const progress = getUnlockProgress(employeeType, state);
          const hasCrossedThreshold = hasCrossedUnlockThreshold(
            "employee",
            employeeType,
            state
          );

          return (
            <div
              key={employeeType}
              className={!hasCrossedThreshold ? "hidden" : ""}
            >
              <LockedEmployeeCard config={config} progress={progress} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
