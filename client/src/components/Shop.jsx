import { useState } from "react";
import { useGameContext } from "../context/useGameContext";
import { EMPLOYEE_CONFIGS } from "../context/gameConfig";
import {
  activeStarBuff,
  getEmployeeBulkCost,
  isEmployeeUnlocked,
  getUnlockProgress,
  hasCrossedUnlockThreshold,
  resolveEmployeeIcon,
} from "../context/gameLogic";
import { SectionLayout } from "./SectionLayout.jsx";
import { Button } from "./Button.jsx";
import { EmployeeCard } from "./EmployeeCard.jsx";
import { LockedEmployeeCard } from "./LockedEmployeeCard.jsx";
import { CosmeticsPanel } from "./CosmeticsPanel.jsx";

// Bulk-buy quantities for the Hire buttons. One selector for the whole
// list; the selected quantity applies to every Hire button (its total
// cost, its label, and how many it hires). Default x1.
const BULK_QUANTITIES = [1, 5, 10, 25, 100];

export function Shop() {
  const { state, dispatch } = useGameContext();
  const [quantity, setQuantity] = useState(1);

  const handleBuyEmployee = (employeeType) => {
    dispatch({
      type: "BUY_EMPLOYEE",
      payload: { employeeType, quantity },
    });
  };

  return (
    <SectionLayout sectionId="shop">
      {/* Bulk-buy quantity selector — one selector for the whole list.
          The selected quantity is the plain bright button; the rest are
          the darker inactive members of the group (the nav's convention). */}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Buy quantity"
      >
        {BULK_QUANTITIES.map((q) => (
          <Button
            key={q}
            onClick={() => setQuantity(q)}
            className={quantity === q ? "" : "game-button--inactive"}
          >
            x{q}
          </Button>
        ))}
      </div>
      {Object.entries(EMPLOYEE_CONFIGS).map(([employeeType, config]) => {
        const unlocked = isEmployeeUnlocked(employeeType, state);

        if (unlocked) {
          // Total cost of buying `quantity` hires (each successive hire
          // costs more). Unaffordable for the whole batch greys the
          // button out, same as a single unaffordable hire.
          const currentCost = getEmployeeBulkCost(
            employeeType,
            state,
            quantity
          );
          const canAfford = state.money >= currentCost;
          const ownedCount = state.employees[employeeType].count;

          // Cosmetics (issue #11): the card renders the equipped
          // cosmetic's icon instead of the config default. The
          // resolved Icon/color ride on a config copy, so
          // EmployeeCard itself needs no cosmetic logic — it just
          // renders config.Icon, which is now the cosmetic's icon
          // (the hire float icon follows the same override).
          const { Icon, color } = resolveEmployeeIcon(employeeType, state);
          const cardConfig = { ...config, Icon, color };

          // Live golden-star Employee buff for this type (Sprint 2x /
          // Meeting 0.5x), or null when none is active. The card tints
          // green (buffed) or red (debuffed) while it is live, so the
          // player sees at a glance that this type's production is
          // changed. activeStarBuff drops expired entries, so the
          // tint clears when the effect ends.
          const buff = activeStarBuff(state, "employee", employeeType);

          return (
            <EmployeeCard
              key={employeeType}
              config={cardConfig}
              currentCost={currentCost}
              ownedCount={ownedCount}
              canAfford={canAfford}
              onPurchase={() => handleBuyEmployee(employeeType)}
              quantity={quantity}
              effectMultiplier={buff ? buff.multiplier : null}
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
      {/* Cosmetics (issue #11): the equip UI, below the employee
          list so the effect of equipping is visible right above it. */}
      <CosmeticsPanel />
    </SectionLayout>
  );
}
