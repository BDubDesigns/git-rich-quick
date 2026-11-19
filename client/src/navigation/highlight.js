/**
 * Email deep links (issue #173): the ONE navigation mechanism.
 *
 * Clicking an email link dispatches NAVIGATE_TO_TARGET with the
 * email's target ({ tab, itemId }). The reducer (navigateToTarget)
 * switches to that tab and records a highlight target, stamped with a
 * fresh key. The destination card is wrapped in a HighlightAnchor
 * (components/HighlightAnchor.jsx), which asks highlightMatches
 * whether the target is its own; the one that matches scrolls itself
 * into view, flashes, and dispatches CONSUME_HIGHLIGHT with the key.
 * consumeHighlight clears the target, so a re-render, a remount or
 * coming back to the tab later never flashes again. A manual tab
 * switch also clears it (clearHighlight), so a target no card picked
 * up (an item that is not on screen) cannot flash by surprise later.
 *
 * Pure functions over the reducer state, no React and no npm imports,
 * so the server test suite can import them directly. `highlightTarget`
 * is UI state: it is never saved.
 */

import { sanitizeEmailTarget } from "../../../shared/game-balance.js";

/** The fresh default: no highlight pending. */
export const NO_HIGHLIGHT = null;

/**
 * Follow a link: switch to the target's tab and record the highlight.
 * The key counts up per navigation (highlightSeq, UI state like the
 * target), so the same link clicked twice flashes twice. A missing or
 * malformed target changes nothing: the state comes back as-is.
 */
export function navigateToTarget(state, target) {
  const clean = sanitizeEmailTarget(target);
  if (!clean) return state;
  const seq = Number.isInteger(state.highlightSeq) ? state.highlightSeq : 0;
  const key = seq + 1;
  return {
    ...state,
    activeTab: clean.tab,
    highlightSeq: key,
    highlightTarget: { ...clean, key },
  };
}

/**
 * Whether a pending highlight is for the card at (tab, itemId). A
 * tab-level anchor passes itemId null and matches a tab-only target.
 */
export function highlightMatches(highlightTarget, tab, itemId = null) {
  if (!highlightTarget || typeof highlightTarget !== "object") return false;
  return (
    highlightTarget.tab === tab &&
    (highlightTarget.itemId ?? null) === (itemId ?? null)
  );
}

/**
 * Consume the highlight with this key: it is cleared, so it flashes
 * once. A stale key (a newer link was clicked since) leaves the newer
 * target alone; nothing pending returns the state unchanged.
 */
export function consumeHighlight(state, key) {
  const pending = state.highlightTarget;
  if (!pending || pending.key !== key) return state;
  return { ...state, highlightTarget: NO_HIGHLIGHT };
}

/** Drop any pending highlight (a manual tab switch). */
export function clearHighlight(state) {
  if (!state.highlightTarget) return state;
  return { ...state, highlightTarget: NO_HIGHLIGHT };
}
