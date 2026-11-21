/**
 * The Farm's stall focus chip (issue #230), as pure data so the server
 * test suite can pin it. Tapping a stall opens its controls at the
 * stall: a full-width chip in the grid, directly under the tapped
 * stall's row. It is in flow (not a floating popover), so it can never
 * clip at a screen edge, and it works at any width. Then the section's
 * scroller brings the stall and the chip into view together.
 */

/**
 * The stall index the chip renders after: the last stall in the
 * selected stall's row (or the last stall, for a short final row).
 * Null when nothing is selected.
 */
export function stallChipAfterIndex(selectedStall, stallCount, gridCols) {
  if (selectedStall === null || selectedStall === undefined) return null;
  if (selectedStall < 0 || selectedStall >= stallCount) return null;
  const rowEnd = Math.floor(selectedStall / gridCols) * gridCols + gridCols - 1;
  return Math.min(rowEnd, stallCount - 1);
}

/** Breathing room kept around the stall and chip when scrolling, px. */
export const STALL_FOCUS_MARGIN_PX = 8;

/**
 * How far to scroll (px, positive is down) so the stall's top and the
 * chip's bottom are both in view. Zero when they already are. If the
 * pair is taller than the view, the stall's top wins, so the stall you
 * tapped never scrolls away.
 */
export function stallFocusScrollDelta(stallTop, chipBottom, viewTop, viewBottom) {
  const top = stallTop - STALL_FOCUS_MARGIN_PX;
  const bottom = chipBottom + STALL_FOCUS_MARGIN_PX;
  if (top < viewTop) return top - viewTop;
  if (bottom > viewBottom) return Math.min(bottom - viewBottom, top - viewTop);
  return 0;
}
