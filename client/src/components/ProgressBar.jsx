// Number abbreviation (issue #42) — the shared formatter, so unlock
// progress (current / target / remaining) abbreviates large LOC targets.
import { formatNumber } from "../../../shared/formatNumber.js";

export function ProgressBar({ current, target, label }) {
  const percentage = target > 0 ? Math.min((current / target) * 100, 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex flex-col justify-between items-start">
        <span className="text-xs">
          {label}
          {current < target && (
            <span className="text-gray-400">
              {" "}
              ({formatNumber(target - current)} remaining)
            </span>
          )}
        </span>
      </div>
      {/* Progress bar */}
      <div
        className="h-4 bg-gray-700 rounded relative"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin="0"
        aria-valuemax={target}
        aria-label={label}
      >
        <div
          className="h-4 bg-green-500 rounded transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-xs text-white">
          {formatNumber(current)} / {formatNumber(target)}
        </span>
      </div>
    </div>
  );
}
