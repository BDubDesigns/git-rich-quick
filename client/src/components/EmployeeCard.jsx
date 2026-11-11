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
  // Live golden-star production multiplier for this type: the global
  // Frenzy buff (Overclock 7x / Throttling 0.5x) TIMES the
  // type-specific Employee buff (Sprint 2x / Meeting 0.5x) — the same
  // product the production math uses. 1 when nothing is live. The card
  // tints green (buffed) or red (debuffed) while the effective rate
  // differs from the base, and the @returns line shows the boosted
  // amount next to the base amount — a visual indicator only,
  // production itself is unchanged here.
  effectMultiplier = 1,
}) {
  const tintClass =
    effectMultiplier > 1
      ? "buffed"
      : effectMultiplier < 1
        ? "debuffed"
        : "";
  // The boosted per-employee rate: base LOC/s times the same combined
  // multiplier as the tint. Shown only while an effect is live (a
  // multiplier of exactly 1 means production is unchanged, including
  // a Frenzy bad cancelled by an Employee good). Green when the rate
  // is higher than base, red when lower.
  const boostedLocPerSecond = config.locPerSecond * effectMultiplier;
  const boostedSuffix =
    effectMultiplier === 1
      ? null
      : ` → ${formatNumber(boostedLocPerSecond)} LOC per Sec`;
  const boostedClassName =
    effectMultiplier > 1 ? "text-green-400" : "text-red-400";
  return (
    <div className={`panel px-3 pb-1 flex flex-col gap-1 m-0 ${tintClass}`}>
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
              suffix={boostedSuffix}
              suffixClassName={boostedClassName}
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
            <div>({formatMoney(currentCost)})</div>
          </BouncyButton>
        </div>
      </div>
    </div>
  );
}
