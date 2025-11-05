import { forwardRef } from "react";

/**
 * StatDisplay
 *
 * Reusable component for displaying a single game statistic.
 * Handles layout, icon, label, and value formatting.
 *
 * Accepts a ref so parents can measure its position (e.g., for animations).
 *
 * This is separated because:
 * 1. Reduces repetitive JSX in the parent
 * 2. Makes stat styling consistent across the app
 * 3. Can be used in other contexts (e.g., modals, info panels)
 * 4. Accepts a ref for parents who need DOM measurements
 *
 * @param {string} label - Display label (e.g., "LOC", "Money")
 * @param {React.ReactNode} icon - Icon component to display
 * @param {string | number} value - Value to display
 * @param {React.Ref} ref - Ref to attach to the main element
 * @returns {React.ReactNode} - Formatted stat display
 */
export const StatDisplay = forwardRef(function StatDisplay(
  { label, icon, value },
  ref
) {
  return (
    <p ref={ref} className="flex-1">
      <b className="inline-flex items-center gap-1">
        {icon} {label}:
      </b>
      <p>{value}</p>
    </p>
  );
});
