import { forwardRef } from "react";
import "./StatBump.css";

/**
 * StatDisplay
 *
 * Reusable component for displaying a single game statistic.
 * Handles layout, icon, and value formatting.
 *
 * Accepts a ref so parents can measure its position (e.g., for animations).
 *
 * This is separated because:
 * 1. Reduces repetitive JSX in the parent
 * 2. Makes stat styling consistent across the app
 * 3. Can be used in other contexts (e.g., modals, info panels)
 * 4. Accepts a ref for parents who need DOM measurements
 *
 * @param {React.ReactNode} icon - Icon component to display
 * @param {string | number} value - Value to display
 * @param {string} [label] - Tiny label under the value (e.g. "LOC").
 *   Omitted when the stat needs no label.
 * @param {"loc" | "money" | "rate"} [bump] - The gain color of the
 *   value's bump (issue #214), or omitted for none.
 * @param {number} [bumpKey] - The latest bump's key: a new key remounts
 *   the value and restarts the bump. 0 means no bump.
 * @param {number} [flashKey] - The latest production tick's key (issue
 *   #229): a new key restarts the value's quiet tick flash. 0 means none.
 * @param {React.Ref} ref - Ref to attach to the main element
 * @returns {React.ReactNode} - Formatted stat display
 */
export const StatDisplay = forwardRef(function StatDisplay(
  { icon, value, label, bump, bumpKey = 0, flashKey = 0 },
  ref
) {
  return (
    <div ref={ref} className="flex flex-col items-center w-20">
      <span>{icon}</span>

      {/* The value; bumps on a big gain (issue #214, StatBump.css). */}
      <span
        key={bumpKey}
        className={
          bump && bumpKey ? `stat-value stat-bump stat-bump--${bump}` : "stat-value"
        }
        data-value={value}
      >
        {value}
        {/* The tick flash (issue #229, TickBar.css): a copy of the value
            fading out over it, keyed by the tick so each tick restarts
            it without remounting the value (a bump in flight keeps
            playing). */}
        {flashKey > 0 && (
          <span key={flashKey} className="stat-tick-flash" aria-hidden="true">
            {value}
          </span>
        )}
      </span>

      {/* Tiny label under the value (issue #103): the four stats were
          icon-only, so a new player had to guess which number was
          which. */}
      {label != null && (
        <span className="text-[10px] leading-tight text-gray-400">
          {label}
        </span>
      )}
    </div>
  );
});
