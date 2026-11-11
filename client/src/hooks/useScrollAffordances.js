// useScrollAffordances: measures one scroller's real overflow from
// its native metrics and keeps it current.
//
// Lives in its own file (not in ScrollAffordances.jsx) because
// react-refresh only allows components in a component file — the same
// reason the game context lives in its own module. The pure rule it
// reads is in `utils/scrollAffordances.js` (ported from RuneSpace,
// `components/ui/ScrollAffordances.tsx`, issue #345).

import { useEffect, useState } from "react";
import {
  getVerticalScrollAffordances,
  NO_VERTICAL_SCROLL_AFFORDANCES,
  sameVerticalScrollAffordances,
} from "../utils/scrollAffordances.js";

function readAffordances(element) {
  return getVerticalScrollAffordances({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  });
}

/**
 * Measures one scroller's real overflow from its native metrics and
 * keeps it current. The element must be the same node for the life of
 * the component (give a swapped scroller a `key`); the hook
 * re-measures on mount, on native scroll, on window and
 * visual-viewport resize, whenever the scroller or one of its children
 * changes size (tab switches, async content, collapses, a hidden
 * ancestor becoming visible), and when children are added or removed.
 */
export function useScrollAffordances(ref, enabled = true) {
  const [affordances, setAffordances] = useState(
    NO_VERTICAL_SCROLL_AFFORDANCES,
  );

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      setAffordances(NO_VERTICAL_SCROLL_AFFORDANCES);
      return;
    }

    const update = () => {
      const next = readAffordances(element);
      setAffordances((previous) =>
        sameVerticalScrollAffordances(previous, next) ? previous : next,
      );
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    const observed = new Set();
    const syncObservedChildren = () => {
      if (!resizeObserver) return;
      const children = new Set(Array.from(element.children));
      for (const child of observed) {
        if (!children.has(child)) {
          resizeObserver.unobserve(child);
          observed.delete(child);
        }
      }
      for (const child of children) {
        if (!observed.has(child)) {
          resizeObserver.observe(child);
          observed.add(child);
        }
      }
    };

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(() => {
            syncObservedChildren();
            update();
          });

    resizeObserver?.observe(element);
    syncObservedChildren();
    mutationObserver?.observe(element, { childList: true });
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    update();

    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [enabled, ref]);

  return enabled ? affordances : NO_VERTICAL_SCROLL_AFFORDANCES;
}
