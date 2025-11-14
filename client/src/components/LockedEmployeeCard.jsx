import { createElement } from "react";
import "./LockedEmployeeCard.css";

/**
 * Displays a locked employee with unlock requirements and progress bars.
 * Read-only display component—no purchase logic.
 *
 * @param {Object} props
 * @param {Object} props.config - Employee config from EMPLOYEE_CONFIGS
 * @param {Array} props.progress - Array from getUnlockProgress().
 *   ASSUMPTION: Never empty—this component is only rendered when
 *   hasCrossedUnlockThreshold() returns true, which guarantees
 *   at least one condition exists. This allows safe use of .every()
 *   on the progress array.
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
  const allConditionsMet = progress.every((p) => p.remaining === 0);

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
