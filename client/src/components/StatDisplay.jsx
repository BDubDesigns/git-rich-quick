import { forwardRef } from "react";

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
 * @param {React.Ref} ref - Ref to attach to the main element
 * @returns {React.ReactNode} - Formatted stat display
 */
export const StatDisplay = forwardRef(function StatDisplay(
  { icon, value, label },
  ref
) {
  return (
    <div ref={ref} className="flex flex-col items-center w-20">
      <span>{icon}</span>

      <span className="">{value}</span>

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
