// Locked freelance project card (issue #19) — the JSDoc format of
// ProjectCard, with unlock-requirement progress bars instead of the
// Ship button. Rendered only once the project is visible (10%
// progress toward its unlock); invisible projects render nothing.
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { ProgressBar } from "./ProgressBar.jsx";
import { formatCondition } from "../utils/formatCondition.js";
import { Button } from "./Button.jsx";

export function LockedFreelanceProjectCard({ project, progress }) {
  return (
    <div className="panel locked px-3 pb-1 flex flex-col gap-1 m-0">
      <div className="flex items-center gap-4">
        {/* Left: Content */}
        <div className="flex-1">
          {/* JSDoc block with title, cost, and reward */}
          <div className="text-xs font-mono">
            <span className="comment-text">{`/** `}</span>
            <br />
            <span className="text-sm font-bold">{project.name}</span>
            <br />
            <span>{project.description}</span>
            <br />
            <span className="text-blue-400">@param</span>
            <span className="text-cyan-300"> {`{LOC}`}</span>
            <span className="text-gray-400">
              {" "}
              {formatNumber(project.loc)}
            </span>
            <br />
            <span className="text-blue-400"> @returns</span>
            <span className="text-cyan-300"> {`{Currency}`}</span>
            <span className="text-green-400">
              {" "}
              {formatMoney(project.reward)}
            </span>
            <br />

            {/* Unlock requirement progress bar */}
            <div>
              <p className="text-xs font-semibold mb-1">
                Unlock requirement:
              </p>
              {progress.map((prog, index) => (
                <ProgressBar
                  key={index}
                  current={prog.current}
                  target={prog.target}
                  label={formatCondition(prog)}
                />
              ))}
            </div>
            <span className="comment-text">{`*/`}</span>
          </div>
        </div>
        {/* Right: Locked Button — always disabled; the shared Button's
            grey disabled state is the LOCKED look. */}
        <Button disabled className="shrink-0">
          <div>LOCKED</div>
          <div>({formatNumber(project.loc)} LOC)</div>
        </Button>
      </div>
    </div>
  );
}
