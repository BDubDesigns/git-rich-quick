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
import { SectionTitleBar } from "./SectionTitleBar.jsx";

export function Shop() {
  const { state, dispatch } = useGameContext();

  const handleBuyEmployee = (employeeType) => {
    dispatch({
      type: "BUY_EMPLOYEE",
      payload: { employeeType },
    });
  };

  const handleToggleDescription = () => {
    dispatch({
      type: "TOGGLE_SECTION_DESC_VISIBILITY",
      payload: { sectionId: "shop" },
    });
  };

  const isDescriptionVisible = state.uiState.sections.shop.isDescriptionVisible;

  return (
    <div className="primary-text">
      <SectionTitleBar
        title="Hire Devs"
        isDescriptionVisible={isDescriptionVisible}
        onToggle={handleToggleDescription}
      />

      {isDescriptionVisible && (
        <CodeComment>
          Here you can hire developers to write LOC for you. It's a one time fee
          per developer, even though that doesn't make any sense. Don't pretend
          anything about software development makes sense; you pull that thread,
          no sweater.
        </CodeComment>
      )}
      <div className="flex flex-col gap-2">
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
