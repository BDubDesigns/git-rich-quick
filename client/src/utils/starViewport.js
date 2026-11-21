/**
 * Viewport robustness for the golden stars and the phone portrait lock
 * (issue #194), as pure functions and constants so the server test
 * suite pins them without React.
 *
 * A star's position is rolled once, at spawn, inside the viewport of
 * that moment. Rotating a phone or resizing a window can leave that
 * point outside the new viewport (an x of 700 on a 390px wide portrait
 * screen), and the star was lost. The star's STATE is never changed by
 * a viewport change: its lifetime and fade timers are keyed to the star
 * object, so rewriting it would restart them. Instead the star is
 * RENDERED at its spawn position clamped into the current viewport, and
 * the claim label is anchored at that same clamped point. Its timers
 * keep running from the original spawn, untouched.
 */

/** Keep a star this far from every viewport edge, px (randomStarPosition's margin). */
export const STAR_EDGE_MARGIN_PX = 12;

/**
 * The phone-landscape boundary for the rotate prompt. Mirrored exactly
 * in index.css (.rotate-prompt); a test keeps the two identical.
 *
 * - (orientation: landscape): wider than tall.
 * - (max-height: 500px): phone height in landscape. Phones are 320 to
 *   about 480 CSS px tall in landscape (the largest iPhones are 430);
 *   the smallest tablet in landscape (iPad mini) is 744, so 500 leaves
 *   room on both sides.
 * - (hover: none) and (pointer: coarse): a touch-first device, so a
 *   short desktop or laptop browser window (mouse, trackpad) never
 *   sees the prompt, however it is resized.
 */
export const PHONE_LANDSCAPE_QUERY =
  "(orientation: landscape) and (max-height: 500px) and (hover: none) and (pointer: coarse)";

/** One axis: keep [pos, pos + size] inside [margin, extent - margin] when it fits. */
function clampAxis(value, extent, size, margin) {
  const max = Math.max(margin, extent - size - margin);
  const safe = Number.isFinite(value) ? value : margin;
  return Math.min(Math.max(safe, margin), max);
}

/**
 * `position` ({ x, y, ...rest }, the star's top-left) clamped so the
 * whole star sits inside `viewport` ({ width, height }) with the edge
 * margin. Other fields (red, ...) pass through. A position already
 * inside comes back with the same x and y. In a viewport smaller than
 * the star plus margins, the star pins to the margin (top-left), never
 * to a negative coordinate.
 */
export function clampStarPosition(position, viewport, size, margin = STAR_EDGE_MARGIN_PX) {
  if (!position) return position;
  return {
    ...position,
    x: clampAxis(position.x, viewport.width, size, margin),
    y: clampAxis(position.y, viewport.height, size, margin),
  };
}

/** The current window viewport, as clampStarPosition reads it. */
export function windowViewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}
