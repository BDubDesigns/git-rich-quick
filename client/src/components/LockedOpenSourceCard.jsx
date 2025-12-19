import { formatMoney } from "../utils/currency";
import { ProgressBar } from "./ProgressBar.jsx";

export function LockedOpenSourceCard({
  project,
  unlockCondition,
  currentProgress,
  nextBonus,
  locCost,
}) {
  return (
    <div className="panel locked px-3 pb-1 flex flex-col gap-1 m-0">
      {/* Two-column layout */}
      <div className="flex items-center gap-4">
        {/* Left: Content */}
        <div className="flex-1">
          {/* JSDoc block with title, cost, and first-level bonus */}
          <div className="flex-1">
            {/* Row: Rewards and Cost */}
            <div className="text-xs font-mono">
              {/* JSDoc header */}
              <span className="comment-text">{`/** `}</span>
              <br />
              <span className="text-sm font-bold">{project.name} v.0.0</span>
              <br />
              <span className="text-blue-400">@param</span>
              <span className="text-cyan-300"> {`{LOC}`}</span>
              <span className="text-gray-400">
                {" "}
                {locCost} LOC needed for v.1.0
              </span>
              <br />
              <span className="text-blue-400">@returns</span>
              <span className="text-cyan-300">{`{Bonus}`}</span>
              <span className="text-green-400">
                {" "}
                +{nextBonus.value} {nextBonus.type}
              </span>
              <br />
              {/* ending comment tag */}
              <span className="comment-text">{`*/`}</span>
            </div>
          </div>

          {/* Unlock requirement progress bar */}
          <div className="mt-2 pt-2 border-t border-gray-600">
            <p className="text-xs font-semibold mb-1">Unlock requirement:</p>
            <ProgressBar
              current={currentProgress}
              required={unlockCondition.count}
              label={`Hire ${unlockCondition.count} ${unlockCondition.employeeType}s`}
            />
          </div>
        </div>

        {/* Right: Locked Button */}
        <button
          disabled={true}
          className={`flex flex-col items-center gap-1 shrink-0 px-3 py-2 rounded font-bold text-sm whitespace-nowrap bg-gray-700 text-gray-500 cursor-not-allowed`}
        >
          <div>LOCKED</div>
          <div>({locCost} LOC)</div>
        </button>
      </div>
    </div>
  );
}
