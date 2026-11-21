import { useLayoutEffect, useRef } from "react";
import { starLabelNudgeX } from "../utils/starLabelNudge.js";

/**
 * The star claim label's on-screen nudge (issue #209). Returns a ref
 * for the pill. When `enabled` (the star variant only), it measures the
 * pill once, as rendered centered on the tap, before the first paint,
 * and writes the minimum sideways shift into --star-nudge-x on the
 * element (FloatingText.css adds it to the centering translate). It
 * never changes left/top and keeps no React state, so there is no
 * re-render to skip and no way to strand the pill: without a
 * measurement the nudge is 0, the plain centered placement. The pill
 * does not move horizontally after it spawns, so one measurement holds,
 * and it is idempotent: each run measures from a zero nudge.
 */
export function useStarLabelNudge(enabled) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    // Measure the plain centered placement, never an already-nudged one,
    // so running twice (StrictMode in dev runs layout effects twice)
    // computes the same nudge instead of undoing it.
    el.style.setProperty("--star-nudge-x", "0px");
    const rect = el.getBoundingClientRect();
    const nudge = starLabelNudgeX(rect.left, rect.right, window.innerWidth);
    el.style.setProperty("--star-nudge-x", `${nudge}px`);
  }, [enabled]);
  return ref;
}
