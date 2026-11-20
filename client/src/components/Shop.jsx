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
  flatOpenSourceLevels,
} from "../context/gameLogic";
import {
  doublingMultiplier,
  effectiveEmployeeMultiplier,
} from "../../../shared/game-balance.js";
import { SectionLayout } from "./SectionLayout.jsx";
import { Button } from "./Button.jsx";
import { EmployeeCard } from "./EmployeeCard.jsx";
import { LockedEmployeeCard } from "./LockedEmployeeCard.jsx";
import { ReleaseManagerShippingSummary } from "./ReleaseManagerShippingSummary.jsx";
import { NightShiftCard } from "./NightShiftCard.jsx";
import { HighlightAnchor } from "./HighlightAnchor.jsx";
import { SortControl } from "./SortControl.jsx";
import { useSortMode } from "../hooks/useSortMode.js";
import { sortEmployeeTypes } from "../utils/unlockProgress.js";

// Bulk-buy quantities for the Hire buttons. One selector for the whole
// list; the selected quantity applies to every Hire button (its total
// cost, its label, and how many it hires). Default x1.
const BULK_QUANTITIES = [1, 5, 10, 25, 100];

export function Shop() {
  const { state, dispatch } = useGameContext();
  const [quantity, setQuantity] = useState(1);
  // Sort mode (issue #181): the shared Default / Cheapest control, its
  // own device preference. Cheapest orders by the card's own cost at
  // the selected quantity, so it re-sorts as hires raise prices.
  const [sortMode] = useSortMode("shop");
  const employeeTypes = sortEmployeeTypes(
    Object.keys(EMPLOYEE_CONFIGS),
    state,
    sortMode,
    quantity
  );

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
              ariaPressed={quantity === q}
            >
              x{q}
            </Button>
          ))}
        </div>
        <SortControl tab="shop" />
      </div>
      {employeeTypes.map((employeeType) => {
        const config = EMPLOYEE_CONFIGS[employeeType];
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
          //
          // The doubling upgrades (issue #118) multiply on top: a
          // type's card tints green while its doubling project is
          // leveled, because the output really is doubled. The
          // Release Manager's ship timer is not changed by any star
          // buff (no Sprint/Meeting/Frenzy scaling — the timer is
          // fixed), but Ship Happens doubles the ships per interval,
          // so its card tints from the doubling multiplier alone.
          const openSourceLevels = flatOpenSourceLevels(state);
          const effectMultiplier =
            employeeType === "releaseManager"
              ? doublingMultiplier("releaseManager", openSourceLevels)
              : employeeType === "projectManager" ||
                  employeeType === "commitSpecialist"
                ? (activeStarBuff(state, "employee", employeeType)
                    ?.multiplier ?? 1) *
                  doublingMultiplier(employeeType, openSourceLevels)
                : effectiveEmployeeMultiplier(
                    state.activeStarEffects,
                    employeeType,
                    Date.now(),
                    flatEmployeeCounts(state),
                    openSourceLevels
                  );

          return (
            <HighlightAnchor key={employeeType} tab="shop" itemId={employeeType}>
              <EmployeeCard
                config={cardConfig}
                currentCost={currentCost}
                ownedCount={ownedCount}
                canAfford={canAfford}
                onPurchase={() => handleBuyEmployee(employeeType)}
                quantity={quantity}
                effectMultiplier={effectMultiplier}
              />
              {/* Release Manager shipping summary (issue #163): the
                  in / out / net readout and the unassigned count. The
                  assignment controls live on the project cards. Hidden
                  while no manager is owned. */}
              {employeeType === "releaseManager" && (
                <ReleaseManagerShippingSummary />
              )}
            </HighlightAnchor>
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
            {/* Email links (issue #173): a teaser lands here, on the
                unlock progress bars. */}
            <HighlightAnchor tab="shop" itemId={employeeType}>
              <LockedEmployeeCard config={config} progress={progress} />
            </HighlightAnchor>
          </div>
        );
      })}
      {/* Night Shift (issue #149): the offline-production upgrade. */}
      <NightShiftCard />
    </SectionLayout>
  );
}
