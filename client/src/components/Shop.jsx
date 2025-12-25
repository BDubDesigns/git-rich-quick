import {
  useGameContext,
  EMPLOYEE_CONFIGS,
  getEmployeeCost,
  isEmployeeUnlocked,
  getUnlockProgress,
  hasCrossedUnlockThreshold,
} from "../context/GameContext";
import { SectionLayout } from "./SectionLayout.jsx";
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
    <SectionLayout sectionId="shop">
      {Object.entries(EMPLOYEE_CONFIGS).map(([employeeType, config]) => {
        const unlocked = isEmployeeUnlocked(employeeType, state);

        if (unlocked) {
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
    </SectionLayout>
  );
}
