// Number abbreviation (issue #42) — the shared formatter.
import { formatNumber } from "../../../shared/formatNumber.js";
import { Button } from "./Button.jsx";
import {
  JsDocBlock,
  JsDocLine,
  JsDocUnlockRequirements,
} from "./JsDocBlock.jsx";

export function LockedOpenSourceCard({
  project,
  progress,
  nextBonus,
  locCost,
}) {
  return (
    <div className="panel locked px-3 pb-1 flex flex-col gap-1 m-0">
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
              value={`+${formatNumber(nextBonus.value)} ${nextBonus.type}`}
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
    </div>
  );
}
