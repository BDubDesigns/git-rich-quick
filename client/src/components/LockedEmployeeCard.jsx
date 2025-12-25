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
import { ProgressBar } from "./ProgressBar.jsx";

export function LockedEmployeeCard({ config, progress }) {
  // Format unlock condition for human-readable display
  const formatCondition = (condition) => {
    switch (condition.type) {
      case "TOTAL_LOC":
        return `Earn ${condition.required} total lines of code`;
      case "TOTAL_EMPLOYEE_COUNT":
        return `Hire ${condition.required} employees`;
      case "SPECIFIC_EMPLOYEE_COUNT":
        return `Hire ${condition.required} ${condition.employeeType}${condition.required > 1 ? "s" : ""}`;
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
    <div className="panel px-3 pb-1 flex flex-col gap-1 m-0">
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
            return (
              <ProgressBar
                key={idx}
                current={prog.current}
                required={prog.required}
                label={formatCondition(prog)}
              />
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
