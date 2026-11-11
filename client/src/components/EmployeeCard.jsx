// Number abbreviation (issue #42) — the shared formatter. formatMoney
// returns the string WITH the "$" attached, so the hire cost now shows
// "($25.00)" where it previously showed "(25.00)" with no $ sign.
import {
  formatMoney,
  formatNumber,
} from "../../../shared/formatNumber.js";

import { BouncyButton } from "./BouncyButton.jsx";
import { JsDocBlock, JsDocLine } from "./JsDocBlock.jsx";

export function EmployeeCard({
  config,
  currentCost,
  ownedCount,
  canAfford,
  onPurchase,
  quantity = 1,
}) {
  return (
    <div className="panel px-3 pb-1 flex flex-col gap-1 m-0">
      <div className="flex items-center gap-4">
        {/* Left: JSDoc block — name, description, cost multiplier, LOC/s.
            The multiplier is the per-hire cost scaling (cost =
            base * multiplier ^ owned), shown so the player can see how
            fast the price climbs: intern x1.1, junior x1.15, senior x1.2. */}
        <div className="flex-1">
          <JsDocBlock title={config.name} description={config.description}>
            <JsDocLine
              tag="@param"
              type="Cost"
              value={`x${formatNumber(config.costMultiplier)} per hire`}
            />
            <JsDocLine
              tag="@returns"
              type="LOC"
              value={`${formatNumber(config.locPerSecond)} LOC per Sec`}
              valueClassName="text-green-400"
            />
          </JsDocBlock>
        </div>

        {/* Right: Icon + Count, Hire button — a game-action button, so it
            bounces and floats "+{quantity}" plus the employee's own icon
            on hire, like the other game action buttons. currentCost is
            the TOTAL for `quantity` hires (see getEmployeeBulkCost); the
            label says how many that buys. */}
        <div className="flex flex-col items-center gap-1 shrink-0 py-2">
          <config.Icon size={36} color={config.color} />
          <div className="text-xs text-gray-400">
            x{formatNumber(ownedCount)}
          </div>
          <BouncyButton
            onClick={onPurchase}
            disabled={!canAfford}
            floatText={`+${quantity}`}
            icon={<config.Icon size={20} color={config.color} />}
          >
            <div>{quantity > 1 ? `Hire x${quantity}` : "Hire"}</div>
            <div>(${formatMoney(currentCost)})</div>
          </BouncyButton>
        </div>
      </div>
    </div>
  );
}
