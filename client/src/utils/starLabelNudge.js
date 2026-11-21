/**
 * Keeping the star claim label on screen (issue #209), as a pure
 * function so the server test suite pins it.
 *
 * The star label is centered on the tap (hotfix #202) and is wide, so a
 * star near a screen edge put half the pill off screen. The fix is a
 * NUDGE, never a re-placement: the pill keeps left/top at the tap, and
 * only when the centered pill would overflow does it shift sideways by
 * the minimum distance that brings it inside the viewport with the
 * margin. A pill that fits is not moved at all. (PR #197's clamp reset
 * every float's left and could strand it at a side; nothing here
 * touches left, and a failed measurement leaves the nudge at 0, which is
 * exactly the centered placement.) The click float never uses this.
 */

/** The margin the star label keeps from each viewport edge, px. */
export const STAR_LABEL_EDGE_MARGIN_PX = 8;

/**
 * The horizontal shift (px, positive is right) that brings a rendered
 * pill spanning [left, right] inside [margin, viewportWidth - margin].
 * 0 when it already fits. A pill wider than the room (it cannot be,
 * the label caps at 100vw - 16px) is aligned to the left margin.
 */
export function starLabelNudgeX(left, right, viewportWidth, margin = STAR_LABEL_EDGE_MARGIN_PX) {
  if (![left, right, viewportWidth].every(Number.isFinite)) return 0;
  const minLeft = margin;
  const maxRight = viewportWidth - margin;
  if (right - left > maxRight - minLeft) return minLeft - left;
  if (left < minLeft) return minLeft - left;
  if (right > maxRight) return maxRight - right;
  return 0;
}
