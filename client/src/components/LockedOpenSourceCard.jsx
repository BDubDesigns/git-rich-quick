// Number abbreviation (issue #42) — the shared formatter.
import { formatNumber } from "../../../shared/formatNumber.js";
import {
  DOUBLING_PROJECT_EMPLOYEE,
  EMPLOYEE_DISPLAY_NAMES,
  doublingTrackMultiplier,
  formatCooldownSeconds,
  isDoublingProject,
  launchPadCooldownSeconds,
  moonshotOddsText,
  projectManagerBoostFraction,
  starBrokerCooldownSeconds,
} from "../../../shared/game-balance.js";
import { bridgeRoundOfferText } from "../utils/bridgeRound.js";
import { Button } from "./Button.jsx";
import {
  JsDocBlock,
  JsDocLine,
  JsDocUnlockRequirements,
} from "./JsDocBlock.jsx";
import { Panel } from "./Panel.jsx";

export function LockedOpenSourceCard({
  projectId,
  project,
  progress,
  nextBonus,
  locCost,
  // Bridge Round (issue #192): the owned store ranks, which name the
  // round the bridge rents. Defaults to Bootstrapped.
  storeRanks = {},
}) {
  // StarBroker has no numeric bonus — v1.0 buys stars on an 8m
  // cooldown — so the bonus line names the cooldown, not "+0 STAR".
  // A track upgrade (issue #118, retuned in #170) has a multiplier
  // bonus, so its line names the first level's multiplier (from the
  // shared formula) instead of a raw bonus value.
  const isStarBroker = projectId === "starBroker";
  const isDoubling = isDoublingProject(projectId);
  const doublingEmployeeName = isDoubling
    ? EMPLOYEE_DISPLAY_NAMES[DOUBLING_PROJECT_EMPLOYEE[projectId]]
    : null;
  return (
    <Panel className="locked px-3 pb-1 flex flex-col gap-1 m-0">
      {/* Two-column layout */}
      <div className="flex items-center gap-4">
        {/* Left: Content */}
        <div className="flex-1">
          <JsDocBlock
            title={`${project.name} v.0.0`}
            description={project.description}
          >
            <JsDocLine
              tag="@param"
              type="LOC"
              value={`${formatNumber(locCost)} LOC needed for v.1.0`}
            />
            <JsDocLine
              tag="@returns"
              type="Bonus"
              value={
                projectId === "bridgeRound"
                  ? bridgeRoundOfferText(storeRanks)
                  : isStarBroker
                  ? `Cooldown ${formatCooldownSeconds(starBrokerCooldownSeconds(1))} between bought stars`
                  : projectId === "moonshot"
                    ? moonshotOddsText()
                    : projectId === "launchPad"
                      ? `Buy red stars, cooldown ${formatCooldownSeconds(launchPadCooldownSeconds(1))} (shared with StarBroker)`
                      : projectId === "scrumMaster"
                        ? `Each ${doublingEmployeeName} boosts passive LOC +${formatNumber(projectManagerBoostFraction({ projectManager: 1 }, 1, { scrumMaster: 1 }) * 100)}%`
                        : isDoubling
                    ? `${doublingEmployeeName} output x${formatNumber(doublingTrackMultiplier(projectId, 1))}`
                    : `+${formatNumber(nextBonus.value)} ${nextBonus.type}`
              }
              valueClassName="text-green-400"
            />
            <JsDocUnlockRequirements progress={progress} />
          </JsDocBlock>
        </div>
        {/* Right: Locked Button — always disabled; the shared Button's
            grey disabled state is the LOCKED look. */}
        <Button disabled className="shrink-0">
          <div>LOCKED</div>
          <div>({formatNumber(locCost)} LOC)</div>
        </Button>
      </div>
    </Panel>
  );
}
