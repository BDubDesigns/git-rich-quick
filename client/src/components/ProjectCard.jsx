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

export function ProjectCard({
  project,
  onComplete,
  canComplete,
  completionCount,
}) {
  return (
    <div className="panel px-3 pb-1 flex flex-col gap-1 m-0">
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
              value={formatMoney(project.reward)}
              valueClassName="text-green-400"
            />
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
            floatText={`+${formatMoney(project.reward)}`}
            icon={<HiOutlineBanknotes size={20} />}
            fullWidth={false}
          >
            <div>Ship!</div>
            <div>({formatNumber(project.loc)} LOC)</div>
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
