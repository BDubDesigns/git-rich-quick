// Number abbreviation (issue #42) — the shared formatter. formatMoney
// returns the string WITH the "$" attached, so the hire cost now shows
// "($25.00)" where it previously showed "(25.00)" with no $ sign.
import {
  formatMoney,
  formatNumber,
} from "../../../shared/formatNumber.js";

import { BouncyButton } from "./BouncyButton.jsx";

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
      {/* Top: Employee Name */}
      <div>
        <span className="text-sm font-bold">{config.name}</span>{" "}
        <span className="text-xs comment-text">
          {`// `}
          {formatNumber(config.locPerSecond)} LOC per Sec
        </span>
      </div>

      {/* Row: Icon + Name + Count, Description, Button */}
      <div className="flex items-center gap-4">
        {/* Left: Icon + Name + Count */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <config.Icon size={36} color={config.color} />
          <div className="text-xs text-gray-400">
            x{formatNumber(ownedCount)}
          </div>
        </div>
        {/* Center: Description */}
        <div className="flex-1">
          <p className="text-xs text-gray-300">{config.description}</p>
        </div>

        {/* Right: Hire button — a game-action button, so it bounces and
            floats "+{quantity}" plus the employee's own icon on hire,
            like the other game action buttons. currentCost is the TOTAL
            for `quantity` hires (see getEmployeeBulkCost); the label
            says how many that buys. */}
        <BouncyButton
          onClick={onPurchase}
          disabled={!canAfford}
          floatText={`+${quantity}`}
          icon={<config.Icon size={20} color={config.color} />}
          className="shrink-0"
        >
          <div>{quantity > 1 ? `Hire x${quantity}` : "Hire"}</div>
          <div>(${formatMoney(currentCost)})</div>
        </BouncyButton>
      </div>
    </div>
  );
}
