import { useEffect, useRef, useState } from "react";
import { useGameContext } from "../context/useGameContext.js";
import { highlightMatches } from "../navigation/highlight.js";

/** How long the flash runs (ms); matches .highlight-flash in index.css. */
const FLASH_MS = 1600;

/**
 * The landing spot of an email link (issue #173). Wrap a card in it
 * with the tab and item id the card stands for; when the pending
 * highlight target is this card, it scrolls the card into view,
 * flashes it once, and consumes the target (CONSUME_HIGHLIGHT), so a
 * re-render never flashes again. A tab-level anchor passes no itemId.
 *
 * It is a layout-neutral wrapper (no box of its own): the card inside
 * stays the Panel. The flash is the .highlight-flash class, an
 * outline that fades.
 */
export function HighlightAnchor({ tab, itemId = null, children }) {
  const { state, dispatch } = useGameContext();
  const ref = useRef(null);
  const [flashKey, setFlashKey] = useState(null);
  const pending = state.highlightTarget;
  const matches = highlightMatches(pending, tab, itemId);
  const pendingKey = matches ? pending.key : null;

  // Consume: scroll, start the flash, clear the target (once per key).
  useEffect(() => {
    if (pendingKey === null) return;
    ref.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setFlashKey(pendingKey);
    dispatch({ type: "CONSUME_HIGHLIGHT", payload: { key: pendingKey } });
  }, [pendingKey, dispatch]);

  // End the flash. Keyed on the flash itself, not the target: the
  // target clears right after it is consumed, and that must not
  // cancel the fade.
  useEffect(() => {
    if (flashKey === null) return undefined;
    const timer = setTimeout(() => setFlashKey(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashKey]);

  return (
    <div
      ref={ref}
      className={flashKey !== null ? "highlight-flash" : undefined}
      data-highlight-anchor={itemId ? `${tab}:${itemId}` : tab}
    >
      {children}
    </div>
  );
}
