import { createElement } from "react";
import "./LockedEmployeeCard.css";

/**
 * Displays a locked employee with unlock requirements and progress.
 *
 * @param {Object} props
 * @param {string} props.employeeType - Key like "junior", "senior"
 * @param {Object} props.config - Employee config from EMPLOYEE_CONFIGS
 * @param {Array} props.progress - Array from getUnlockProgress():
 *   [{ type, current, required, remaining }, ...]
 */
export function LockedEmployeeCard({ employeeType, config, progress }) {
  // Format a single condition for human-readable display
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

  // Check if all conditions are met (ready to unlock)
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

      {/* Unlock conditions */}
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
                  width: `${(prog.current / prog.required) * 100}%`,
                }}
              />
            </div>
            {/* Current / Required display */}
            <p className="progress-text">
              {prog.current} / {prog.required}
            </p>
          </div>
        ))}
      </div>

      {/* Message when ready to unlock */}
      {allConditionsMet && (
        <p className="unlock-ready-message">
          🎉 All requirements met! Purchase {config.name} when ready.
        </p>
      )}
    </div>
  );
}
