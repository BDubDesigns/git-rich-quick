import { WORK_MODES } from "../utils/workMode.js";

/**
 * The Write code / Manage agents toggle (issue #267, slice 1). It sits
 * directly above the Commit area once Series A is owned (the caller
 * decides; utils/workMode.js owns the rule and the device preference).
 *
 * Two real buttons in a group, aria-pressed on the chosen one, 44px
 * tall for a thumb. The chosen segment is the game's button blue (the
 * shared Button's rgb(29, 78, 216)); the other is the recessed main
 * background, so the pair reads as one control and not two buttons.
 */
export function WorkModeToggle({ mode, onChange, className = "" }) {
  return (
    <div
      role="group"
      aria-label="Work mode"
      data-work-mode-toggle
      className={`flex h-11 overflow-hidden rounded-lg border border-[#3c3c3c] bg-[#181818] p-0.5 text-sm font-semibold ${className}`}
    >
      {WORK_MODES.map((option) => {
        const active = mode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (!active) onChange(option.id);
            }}
            className={`flex-1 whitespace-nowrap rounded-md px-3 transition-colors ${
              active
                ? "bg-blue-700 text-white shadow-sm"
                : "bg-transparent text-gray-400 hover:bg-[#252526] hover:text-gray-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
