// Number abbreviation (issue #42) — the shared formatter. formatMoney
// returns the string WITH the "$" attached, so the hire cost now shows
// "($25.00)" where it previously showed "(25.00)" with no $ sign.
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";

import { BouncyButton } from "./BouncyButton.jsx";
import { JsDocBlock, JsDocLine } from "./JsDocBlock.jsx";
import { Panel } from "./Panel.jsx";
import { employeeReturnsLine } from "../context/gameLogic.js";
import {
  starEffectName,
  starRewardDetail,
} from "../../../shared/game-balance.js";

/**
 * The AGI / Union Drive price line (issue #157), or null when neither
 * is live: `@deprecated {Price} was $50.00 (AGI: Hires 50% off)`. The
 * old price is the price without the effect; the button already shows
 * the live one. Green for AGI, red for Union Drive.
 */
function hireDealLine(hireCostMultiplier, listCost) {
  if (hireCostMultiplier === 1 || !Number.isFinite(listCost)) return null;
  const good = hireCostMultiplier < 1;
  return {
    value: `was ${formatMoney(listCost)}`,
    suffix: ` (${starEffectName("hiring", good)}: ${starRewardDetail({
      effect: "hiring",
      multiplier: hireCostMultiplier,
    })})`,
    suffixClassName: good ? "text-green-400" : "text-red-400",
  };
}

export function EmployeeCard({
  config,
  currentCost,
  ownedCount,
  canAfford,
  onPurchase,
  quantity = 1,
  // Live golden-star production multiplier for this type: the global
  // Frenzy buff (Overclock / Throttling) TIMES the type-specific
  // Employee buff (Sprint / Meeting) — the same product the
  // production math uses. 1 when nothing is live. The card tints green
  // (buffed) or red (debuffed) while the effective rate differs from
  // the base, and the @returns line shows the boosted amount next to
  // the base amount — a visual indicator only, production itself is
  // unchanged here. For the boost types (Project Manager, Commit
  // Specialist) this is the type's own Sprint/Meeting multiplier.
  effectMultiplier = 1,
  // AGI / Union Drive (issue #157): the live hire cost multiplier (1
  // when neither is live) and the price without it, so the card can
  // show the old price next to the one the Hire button charges.
  hireCostMultiplier = 1,
  listCost = null,
}) {
  const tintClass =
    effectMultiplier > 1
      ? "buffed"
      : effectMultiplier < 1
        ? "debuffed"
        : "";
  // The @returns line: the base bonus for this type, plus the boosted
  // amount while an effect is live (a multiplier of exactly 1 means
  // production is unchanged, including a Frenzy bad cancelled by an
  // Employee good). Green when the rate is higher than base, red when
  // lower. A Project Manager shows "+1% passive per Manager" and a
  // Commit Specialist "+0.2 LOC per Click" instead of a LOC/s rate —
  // see employeeReturnsLine (gameLogic.js), shared with the locked
  // card so both cards agree.
  const returnsLine = employeeReturnsLine(config, effectMultiplier);
  const hireDeal = hireDealLine(hireCostMultiplier, listCost);
  return (
    <Panel className={`px-3 pb-1 flex flex-col gap-1 m-0 ${tintClass}`}>
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
              type={returnsLine.type}
              value={returnsLine.value}
              valueClassName="text-green-400"
              suffix={returnsLine.suffix || null}
              suffixClassName={returnsLine.suffixClassName}
            />
            {hireDeal && (
              <JsDocLine
                tag="@deprecated"
                type="Price"
                value={hireDeal.value}
                suffix={hireDeal.suffix}
                suffixClassName={hireDeal.suffixClassName}
              />
            )}
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
    </Panel>
  );
}
