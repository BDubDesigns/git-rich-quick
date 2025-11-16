import { createElement } from "react";
import "./LockedEmployeeCard.css";

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
    <div
      className={`locked-employee-card ${
        allConditionsMet ? "ready-to-unlock" : ""
      }`}
    >
      {/* Header: Employee info */}
      <div className="locked-employee-header">
        <div className="locked-employee-icon">
          {createElement(config.icon.type, {
            ...config.icon.props,
            size: 48,
          })}
        </div>
        <h3 className="locked-employee-name">{config.name}</h3>
        <span className="locked-badge">LOCKED</span>
      </div>

      {/* Unlock conditions section */}
      <div className="unlock-conditions">
        <p className="unlock-label">Unlock requirements:</p>
        {progress.map((prog, idx) => (
          // Use array index as key because:
          // 1. Progress array is derived directly from config.unlockConditions (stable order)
          // 2. Future conditions may have duplicate types (e.g., multiple EMPLOYEE_COUNT conditions)
          //    so type alone cannot be a unique identifier
          // 3. Array is never filtered/reordered dynamically
          <div key={idx} className="unlock-requirement">
            <p className="requirement-text">
              {formatCondition(prog)}
              {prog.remaining > 0 && (
                <span className="requirement-remaining">
                  {" "}
                  ({prog.remaining} remaining)
                </span>
              )}
            </p>
            {/* Progress bar */}
            <div
              className="requirement-progress"
              role="progressbar"
              aria-valuenow={prog.current}
              aria-valuemin="0"
              aria-valuemax={prog.required}
              aria-label={`Progress towards ${formatCondition(prog)}`}
            >
              <div
                className="progress-fill"
                style={{
                  width:
                    prog.required > 0
                      ? `${Math.min(
                          (prog.current / prog.required) * 100,
                          100
                        )}%`
                      : "0%",
                }}
              />
            </div>
            {/* Current / Required */}
            <p className="progress-text">
              {prog.current} / {prog.required}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
