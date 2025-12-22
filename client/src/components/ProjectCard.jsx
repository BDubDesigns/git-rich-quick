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
      <div className="flex items-center gap-4">
        {/* Left: Content */}
        <div className="flex-1">
          {/* Row: Rewards and Cost */}
          <div className="text-xs font-mono">
            {/* Top: Project Name */}
            <span className="comment-text">{`/** `}</span>
            <br />
            <span className="text-sm font-bold">{project.name}</span>
            <br />
            <span>{project.description}</span>
            <br />
            <span className="text-blue-400">@param</span>
            <span className="text-cyan-300"> {`{LOC}`}</span>
            <span className="text-gray-400"> {project.loc}</span>
            <br />
            <span className="text-blue-400"> @returns</span>
            <span className="text-cyan-300"> {`{Currency}`}</span>
            <span className="text-green-400">
              {" "}
              ${formatMoney(project.reward)}
            </span>
            <br />
            <span className="comment-text">{`*/`}</span>
          </div>
        </div>

        {/* Right: Button with Price */}
        {/* Left: Icon + Name + Count */}
        <div className="flex flex-col items-center gap-1 shrink-0 py-2">
          <project.icon size={36} color={project.color} />
          <div className="text-xs text-gray-400">x{completionCount}</div>
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
    </div>
  );
}
