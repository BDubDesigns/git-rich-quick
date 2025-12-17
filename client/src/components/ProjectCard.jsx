import { formatMoney } from "../utils/currency";

import { ActionButton } from "./ActionButton.jsx";
import { HiOutlineBanknotes } from "react-icons/hi2";

export function ProjectCard({
  project,
  onComplete,
  canComplete,
  completionCount,
}) {
  return (
    <div className="panel px-3 pb-1 flex flex-col gap-1 m-0">
      {/* Top: Project Name */}
      <div>
        <span className="text-sm font-bold">{project.name}</span>{" "}
        <span className="text-xs comment-text">
          {`// `} pays ${formatMoney(project.reward)}
        </span>
      </div>
      {/* Row: Rewards and Cost */}
      <div className="text-xs font-mono">
        <span className="text-blue-400">@param</span>
        <span className="text-cyan-300"> {`{LOC}`}</span>
        <span className="text-gray-400"> {project.loc}</span>
        <br />
        <span className="text-blue-400"> @returns</span>
        <span className="text-cyan-300"> {`{Currency}`}</span>
        <span className="text-green-400"> ${formatMoney(project.reward)}</span>
      </div>

      {/* Row: Icon + Name + Completion Count, Description, Button */}
      <div className="flex items-center gap-4">
        {/* Left: Icon + Name + Count */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <project.icon size={36} color={project.color} />
          <div className="text-xs text-gray-400">x{completionCount}</div>
        </div>
        {/* Center: Description */}
        <div className="flex-1">
          <p className="text-xs text-gray-300">{project.description}</p>
        </div>

        {/* Right: Button with Price */}
        <ActionButton
          onClick={onComplete}
          disabled={!canComplete}
          floatText={`+$${formatMoney(project.reward)}`}
          icon={<HiOutlineBanknotes size={20} />}
          fullWidth={false}
        >
          <div>Ship!</div>
          <div>({project.loc} LOC)</div>
        </ActionButton>
      </div>
    </div>
  );
}
