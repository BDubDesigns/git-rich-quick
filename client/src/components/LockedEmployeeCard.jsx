/**
 * Displays a locked employee with unlock requirements and progress bars.
 * Read-only display component—no purchase logic.
 *
 * @param {Object} props
 * @param {Object} props.config - Employee config from EMPLOYEE_CONFIGS
 * @param {Array} props.progress - Array from getUnlockProgress(). Should never be empty,
 *   since LockedEmployeeCard is only rendered for locked employees. Locked employees always
 *   have unlock conditions, so progress array is always populated.
 */

import { formatMoney } from "../utils/currency";

export function LockedEmployeeCard({ config, progress }) {
  // Format unlock condition for human-readable display
  const formatCondition = (condition) => {
    switch (condition.type) {
      case "TOTAL_LOC":
        return `Earn ${condition.required} total lines of code`;
      case "EMPLOYEE_COUNT":
        return `Hire ${condition.required} employees`;
      default:
        return "Complete an unknown objective";
    }
  };

  // Calculate if all conditions are met (derived state, not stored)
  // Guard against empty progress array as defensive measure, though in practice
  // this component is only rendered for locked employees with non-empty progress.
  const allConditionsMet =
    progress.length > 0 &&
    progress.every((progressItem) => progressItem.remaining === 0);

  return (
    <div className="panel locked px-3 pb-1 flex flex-col gap-1 m-0">
      {/* Top: Employee Name */}
      <div>
        <span className="text-sm font-bold">{config.name}</span>{" "}
        <span className="text-xs comment-text">
          {`// `}
          {config.locPerSecond} LOC per Sec
        </span>
      </div>

      {/* Row: Icon + Name + Count, Description, Button */}
      <div className="flex items-center gap-4">
        {/* Left: Icon + Name + Count */}
        {/* <div className="flex flex-col items-start gap-1 shrink-0">
          <config.Icon size={36} color="grey" />
        </div> */}
        {/* Unlock conditions section */}
        <div className="flex-1 space-y-2">
          <p className="text-xs font-semibold">Unlock requirements:</p>
          {progress.map((prog, idx) => {
            const percentage =
              prog.required > 0
                ? Math.min((prog.current / prog.required) * 100, 100)
                : 0;
            return (
              <div key={idx} className="space-y-1">
                <div className="flex flex-col justify-between items-center">
                  <span className="text-xs">
                    {formatCondition(prog)}
                    {prog.remaining > 0 && (
                      <span className="text-gray-400">
                        {" "}
                        ({prog.remaining} remaining)
                      </span>
                    )}
                  </span>
                </div>
                {/* Simple progress bar */}
                <div
                  className="h-4 bg-gray-700 rounded relative"
                  role="progressbar"
                  aria-valuenow={prog.current}
                  aria-valuemin="0"
                  aria-valuemax={prog.required}
                  aria-label={`Progress towards ${formatCondition(prog)}`}
                >
                  <div
                    className="h-4 bg-green-500 rounded transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-xs text-white">
                    {prog.current} / {prog.required}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Button with Price */}
        <button
          disabled={true}
          className={`flex flex-col items-center gap-1 shrink-0 px-3 py-2 rounded font-bold text-xs whitespace-nowrap bg-gray-700 text-gray-500 cursor-not-allowed`}
        >
          <div>LOCKED</div>
          <div>(${formatMoney(config.baseCost)})</div>
        </button>
      </div>
    </div>
  );
}
