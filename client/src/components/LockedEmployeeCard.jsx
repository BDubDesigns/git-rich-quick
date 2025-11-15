import { createElement } from "react";
import "./LockedEmployeeCard.css";

/**
 * Displays a locked employee with unlock requirements and progress bars.
 * Read-only display component—no purchase logic.
 *
 * @param {Object} props
 * @param {Object} props.config - Employee config from EMPLOYEE_CONFIGS
 * @param {Array} props.progress - Array from getUnlockProgress().
 *   Can be empty if the employee has no unlock conditions (e.g., intern).
 *   When empty, .every() returns true (vacuously true), so allConditionsMet
 *   will be true and the card displays the LOCKED badge with no progress bars.
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
  // Guard against empty progress array: only true if conditions exist AND all are met
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
            <div className="requirement-progress">
              <div
                className="progress-fill"
                style={{
                  width:
                    prog.required > 0
                      ? `${(prog.current / prog.required) * 100}%`
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
