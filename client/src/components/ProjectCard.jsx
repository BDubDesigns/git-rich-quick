// Number abbreviation (issue #42) — the shared formatter. formatMoney
// returns the string WITH the "$" attached, so the manual "$" prefixes
// on the reward are dropped (they would double up to "$$").
import {
  formatMoney,
  formatNumber,
} from "../../../shared/formatNumber.js";

import { ActionButton } from "./ActionButton.jsx";
import { HiOutlineBanknotes } from "react-icons/hi2";
import { JsDocBlock, JsDocLine } from "./JsDocBlock.jsx";
import { Panel } from "./Panel.jsx";
import { Button } from "./Button.jsx";
import { ProjectRateLine } from "./ProjectRateLine.jsx";

/**
 * Release Manager assignment row (issue #163), inside the project's
 * card: minus / plus move one manager on or off this project, with the
 * count assigned here, the LOC/s those managers burn, and the cash/s
 * they earn. The reducer (SET_RELEASE_MANAGER_ASSIGNMENT) enforces the
 * rules too: never below 0, never more assigned than owned.
 */
function ReleaseManagerRow({ projectName, rm }) {
  const assigned = rm.assigned ?? 0;
  const canRemove = assigned > 0;
  const canAdd = (rm.unassigned ?? 0) > 0;
  return (
    <div className="flex items-center gap-2 text-sm border-t border-gray-600 pt-1 mb-1">
      <span className="flex-1 text-xs text-gray-300">
        Release Managers
        <span className="block text-gray-400">
          -{formatNumber(rm.locPerSecond ?? 0)} LOC/s,{" "}
          <span className="text-green-400">
            +{formatMoney(rm.cashPerSecond ?? 0)}/s
          </span>
        </span>
      </span>
      <Button
        onClick={() => rm.onChange(assigned - 1)}
        disabled={!canRemove}
        className={canRemove ? "" : "game-button--inactive"}
        aria-label={`Unassign a manager from ${projectName}`}
      >
        −
      </Button>
      <span
        className="w-8 text-center"
        aria-label={`${projectName} assigned managers`}
      >
        {formatNumber(assigned)}
      </span>
      <Button
        onClick={() => rm.onChange(assigned + 1)}
        disabled={!canAdd}
        className={canAdd ? "" : "game-button--inactive"}
        aria-label={`Assign a manager to ${projectName}`}
      >
        +
      </Button>
    </div>
  );
}

export function ProjectCard({
  project,
  onComplete,
  canComplete,
  completionCount,
  releaseManager = null,
  payout = null,
  // "hype" (Hype Train live: green glow and sparkles), "derailed"
  // (Derailment: a red dim), or null (issue #157).
  hypeTone = null,
}) {
  // Payout readout (issue #176): what a ship actually pays and the
  // effective rate, Client Network included (projectPayoutLines). A
  // card with no readout falls back to the base reward and no rate.
  const payoutText = payout?.payout ?? formatMoney(project.reward);
  return (
    <Panel
      className={`px-3 pb-1 flex flex-col gap-1 m-0 ${
        hypeTone === "hype"
          ? "hype-train"
          : hypeTone === "derailed"
            ? "hype-derailed"
            : ""
      }`}
      data-hype={hypeTone ?? undefined}
    >
      <div className="flex items-center gap-4">
        {/* Left: Content */}
        <div className="flex-1">
          <JsDocBlock title={project.name} description={project.description}>
            <JsDocLine
              tag="@param"
              type="LOC"
              value={formatNumber(project.loc)}
            />
            <JsDocLine
              tag="@returns"
              type="Currency"
              value={payoutText}
              valueClassName="text-green-400"
            />
            <ProjectRateLine payout={payout} />
          </JsDocBlock>
        </div>

        {/* Right: Button with Price */}
        {/* Left: Icon + Name + Count */}
        <div className="flex flex-col items-center gap-1 shrink-0 py-2">
          <project.icon size={36} color={project.color} />
          <div className="text-xs text-gray-400">
            x{formatNumber(completionCount)}
          </div>
          <ActionButton
            onClick={onComplete}
            disabled={!canComplete}
            floatText={`+${payoutText}`}
            icon={<HiOutlineBanknotes size={20} />}
            fullWidth={false}
          >
            <div>Ship!</div>
            <div>({formatNumber(project.loc)} LOC)</div>
          </ActionButton>
        </div>
      </div>
      {/* Only once a Release Manager is owned: with none there is
          nothing to assign. */}
      {releaseManager && (
        <ReleaseManagerRow projectName={project.name} rm={releaseManager} />
      )}
    </Panel>
  );
}
