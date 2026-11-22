/**
 * Displays a locked employee with unlock requirements and progress bars.
 * Read-only display component—no purchase logic.
 *
 * Collapsible like the unlocked cards (Brandon, Nov 21): collapsed (the
 * default) it is one row, the chevron, a lock, the name and the same
 * disabled LOCKED button with the first hire's price; expanded it is
 * the full JSDoc card with the unlock progress bars, as before.
 *
 * @param {Object} props
 * @param {Object} props.config - Employee config from EMPLOYEE_CONFIGS
 * @param {string} props.cardId - The employee type: the card's key in the
 *   Hire tab's open/collapsed store (useHireCardOpen).
 * @param {Array} props.progress - Array from getUnlockProgress(). Should never be empty,
 *   since LockedEmployeeCard is only rendered for locked employees. Locked employees always
 *   have unlock conditions, so progress array is always populated.
 */

// Number abbreviation (issue #42) — the shared formatter. formatMoney
// returns the string WITH the "$" attached, so the locked cost now shows
// "($25.00)" where it previously showed "(25.00)" with no $ sign.
import { useId } from "react";
import { FaLock } from "react-icons/fa";
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { Button } from "./Button.jsx";
import {
  JsDocBlock,
  JsDocLine,
  JsDocUnlockRequirements,
} from "./JsDocBlock.jsx";
import { Panel } from "./Panel.jsx";
import { CollapsedHireRow, ExpandedHireHeader } from "./HireCardToggle.jsx";
import { useHireCardOpen } from "../hooks/useHireCards.js";
import { employeeReturnsLine } from "../context/gameLogic.js";

export function LockedEmployeeCard({ cardId, config, progress, price = null }) {
  // The @returns line: the base bonus for this type. A Project Manager
  // shows "+1% passive per Manager" and a Commit Specialist "+0.2 LOC
  // per Click" instead of a LOC/s rate — see employeeReturnsLine
  // (gameLogic.js), shared with the unlocked card so both cards agree.
  const returnsLine = employeeReturnsLine(config);
  const [open, toggle] = useHireCardOpen(cardId);
  const detailId = useId();
  // The first hire's price through the shared cost (issue #157: AGI /
  // Union Drive move it too); base cost if absent.
  const priceText = `(${formatMoney(price ?? config.baseCost)})`;

  if (!open) {
    return (
      <CollapsedHireRow
        name={config.name}
        icon={
          <FaLock
            size={16}
            className="shrink-0 mx-[3px] text-gray-400"
            aria-hidden="true"
          />
        }
        detailId={detailId}
        onToggle={toggle}
        action={
          <Button disabled className="shrink-0 whitespace-nowrap tap-target-40">
            LOCKED {priceText}
          </Button>
        }
      />
    );
  }

  return (
    <Panel className="px-3 pb-1 flex flex-col gap-1 m-0">
      <div className="flex items-center gap-4">
        {/* Left: JSDoc block — name, description, cost multiplier, LOC/s,
            then the unlock requirements. The description is new here (the
            old locked card did not show it); the other locked cards show
            theirs, so this one does too. */}
        <div className="flex-1">
          <JsDocBlock
            title={config.name}
            description={config.description}
            header={
              <ExpandedHireHeader
                name={config.name}
                detailId={detailId}
                onToggle={toggle}
              />
            }
            bodyId={detailId}
          >
            <JsDocLine
              tag="@param"
              type="Cost"
              value={`x${formatNumber(config.costMultiplier)} per hire`}
            />
            <JsDocLine
              tag="@returns"
              type={returnsLine.type}
              value={returnsLine.value}
              valueClassName="text-green-400"
            />
            <JsDocUnlockRequirements progress={progress} />
          </JsDocBlock>
        </div>

        {/* Right: Button with Price — always disabled; the shared
            Button's grey disabled state is the LOCKED look. */}
        <Button disabled className="shrink-0">
          <div>LOCKED</div>
          <div>{priceText}</div>
        </Button>
      </div>
    </Panel>
  );
}
