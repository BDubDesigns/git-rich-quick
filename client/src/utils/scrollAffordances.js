/**
 * Vertical scroll affordances: the pure rule behind the up/down arrows
 * shown on a scrollable tab/pane when content hides above or below it.
 *
 * Ported from RuneSpace (`components/ui/scroll-affordances.ts`, issue
 * #345): the same 8px edge epsilon, the same "real overflow, never the
 * mere possibility of scrolling" rule, and the same equality helper so
 * an unchanged scroll does not re-render. The hook and the overlay in
 * `components/ScrollAffordances.jsx` are the same port's other half.
 *
 * Lives in a shared-only module (no react-icons), so the server suite
 * can import it directly — same precedent as unlockProgress.js.
 */

/** Distance, in CSS pixels, within which a scroller counts as "at" an edge. */
export const SCROLL_AFFORDANCE_EDGE_EPSILON = 8;

/** The native scroll metrics the rule reads, from a scroller. */
export const NO_VERTICAL_SCROLL_AFFORDANCES = {
  top: false,
  bottom: false,
};

/**
 * Which edges have genuinely hidden content beyond them. `top` means
 * content is scrolled out above the viewport; `bottom` means content
 * continues below it. A scroller whose content fits shows neither,
 * because both distances are then within the epsilon — the arrows
 * measure real overflow, never the mere possibility of scrolling.
 */
export function getVerticalScrollAffordances(
  metrics,
  epsilon = SCROLL_AFFORDANCE_EDGE_EPSILON,
) {
  const remainingBelow =
    metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return {
    top: metrics.scrollTop > epsilon,
    bottom: remainingBelow > epsilon,
  };
}

/** Equality, so an unchanged scroll does not re-render the panel. */
export function sameVerticalScrollAffordances(left, right) {
  return left.top === right.top && left.bottom === right.bottom;
}
