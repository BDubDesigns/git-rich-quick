import { formatMoney } from "../utils/currency";
import { ActionButton } from "./ActionButton.jsx";

export function OpenSourceCard({
  project,
  currentLevel,
  currentBonus,
  nextBonus,
  locCost,
  isMaxed,
  canContribute,
  onContribute,
}) {
  return (
    <div className="panel px-3 pb-1 flex flex-col gap-1 m-0">
      {/* Two-column layout */}
      <div className="flex items-center gap-4">
        {/* Left: Content */}
        <div className="flex-1">
          {/* JSDoc block with title, description, current bonus, next bonus, cost */}
          <div className="flex-1">
            {/* Row: Rewards and Cost */}
            <div className="text-xs font-mono">
              {/* Top: Project Name */}
              <span className="comment-text">{`/** `}</span>
              <br />
              <span className="text-sm font-bold">
                {project.name} v.{currentLevel}.0
              </span>
              <br />
              <span>{project.description}</span>
              <br />
              <span className="text-blue-400">@param</span>
              <span className="text-cyan-300"> {`{LOC}`}</span>
              <span className="text-gray-400">
                {" "}
                {locCost} LOC needed for v.{currentLevel + 1}.0
              </span>
              <br />

              {/* current bonus, if any */}
              {currentBonus && (
                <>
                  <span className="text-blue-400"> @returns</span>
                  <span className="text-cyan-300">
                    {" "}
                    {`{` + currentBonus.type + `}`}
                  </span>
                  <span className="text-green-400">
                    {" "}
                    Earning {currentBonus.value} boost to {currentBonus.type}{" "}
                    now
                  </span>
                  <br />
                </>
              )}

              {/* next bonus or maxed out */}
              {!isMaxed ? (
                <div>
                  <span className="text-blue-400">@returns</span>
                  <span className="text-cyan-300">{`{Bonus}`}</span>
                  <span className="text-green-400">
                    {" "}
                    +{nextBonus.value} {nextBonus.type}
                  </span>
                </div>
              ) : (
                <div className="comment-text">// MAXED OUT</div>
              )}

              {/* ending comment tag */}
              <span className="comment-text">{`*/`}</span>
            </div>
          </div>
        </div>

        {/* Right: Icon + Level, Contribute Button */}
        <div className="flex flex-col items-center gap-2 shrink-0 py-2">
          {/* Icon + Level number */}
          <project.icon size={36} color={project.color} />
          <div className="text-xs text-gray-400">v{currentLevel}.0</div>

          {/* Contribute/Maxed Button */}
          <ActionButton
            onClick={onContribute}
            disabled={!canContribute || isMaxed}
            floatText={!isMaxed ? `+${nextBonus.value} ${nextBonus.type}` : ""}
            icon={<project.icon size={20} />}
            fullWidth={false}
          >
            {!isMaxed ? (
              <>
                <div>Contribute!</div>
                <div>({locCost} LOC)</div>
              </>
            ) : (
              <div>Maxed Out</div>
            )}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
