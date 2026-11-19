// Locked freelance project card (issue #19) — the JSDoc format of
// ProjectCard, with unlock-requirement progress bars instead of the
// Ship button. Rendered only once the project is visible (10%
// progress toward its unlock); invisible projects render nothing.
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { Button } from "./Button.jsx";
import {
  JsDocBlock,
  JsDocLine,
  JsDocUnlockRequirements,
} from "./JsDocBlock.jsx";
import { Panel } from "./Panel.jsx";
import { ProjectRateLine } from "./ProjectRateLine.jsx";

export function LockedFreelanceProjectCard({ project, progress, payout = null }) {
  // Payout readout (issue #176): the teaser shows the rate too, so a
  // player can plan around a project before it unlocks.
  const payoutText = payout?.payout ?? formatMoney(project.reward);
  return (
    <Panel className="locked px-3 pb-1 flex flex-col gap-1 m-0">
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
            <JsDocUnlockRequirements progress={progress} />
          </JsDocBlock>
        </div>
        {/* Right: Locked Button — always disabled; the shared Button's
            grey disabled state is the LOCKED look. */}
        <Button disabled className="shrink-0">
          <div>LOCKED</div>
          <div>({formatNumber(project.loc)} LOC)</div>
        </Button>
      </div>
    </Panel>
  );
}
