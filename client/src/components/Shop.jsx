import { useState } from "react";
import { useGameContext } from "../context/useGameContext";
import { EMPLOYEE_CONFIGS } from "../context/gameConfig";
import {
  getEmployeeBulkCost,
  isEmployeeUnlocked,
  getUnlockProgress,
  hasCrossedUnlockThreshold,
  resolveEmployeeIcon,
  activeStarBuff,
  flatEmployeeCounts,
} from "../context/gameLogic";
import { effectiveEmployeeMultiplier } from "../../../shared/game-balance.js";
import { SectionLayout } from "./SectionLayout.jsx";
import { Button } from "./Button.jsx";
import { EmployeeCard } from "./EmployeeCard.jsx";
import { LockedEmployeeCard } from "./LockedEmployeeCard.jsx";

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

          // Live golden-star production multiplier for this type: the
          // global Frenzy buff (Overclock / Throttling) times the
          // type-specific Employee buff (Sprint / Meeting) for this
          // type — the same product the production math uses, so the
          // card tints green (buffed) or red (debuffed) while any live
          // effect changes this type's production, and the tint clears
          // when the effect ends. 1 when nothing is live.
          //
          // The Project Manager boost is part of that multiplier for
          // the passive types (each manager adds +1% to all employee
          // passive LOC), so it is passed in here — a card tints green
          // whenever managers are owned, because the boost is
          // permanent. The boost types themselves show only their own
          // Sprint/Meeting multiplier: a Project Manager's card shows
          // its Sprint scaling the boost (+1% -> +5% at 5x), and a
          // Commit Specialist's card shows its Sprint scaling the
          // click bonus (+0.2 -> +1.0 at 5x). A Frenzy buff does not
          // change a manager's boost or a specialist's click bonus,
          // so it does not tint those cards.
          const effectMultiplier =
            employeeType === "projectManager" ||
            employeeType === "commitSpecialist"
              ? (activeStarBuff(state, "employee", employeeType)
                  ?.multiplier ?? 1)
              : effectiveEmployeeMultiplier(
                  state.activeStarEffects,
                  employeeType,
                  Date.now(),
                  flatEmployeeCounts(state)
                );

          return (
            <EmployeeCard
              key={employeeType}
              config={cardConfig}
              currentCost={currentCost}
              ownedCount={ownedCount}
              canAfford={canAfford}
              onPurchase={() => handleBuyEmployee(employeeType)}
              quantity={quantity}
              effectMultiplier={effectMultiplier}
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
