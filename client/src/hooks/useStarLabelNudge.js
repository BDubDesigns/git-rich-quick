import { useLayoutEffect, useRef } from "react";
import { starLabelNudgeX, starLabelNudgeY } from "../utils/starLabelNudge.js";

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
 *
 * Issue #212 adds the vertical half: --star-nudge-y, the minimum push
 * down that keeps the pill's top edge on screen at the end of its rise
 * (a star at the very top of the screen, with the taller two-line CI
 * badge). It is measured the same way, from a zero nudge, and is 0
 * everywhere the pill already ends on screen.
 */
export function useStarLabelNudge(enabled) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    // Measure the plain centered placement, never an already-nudged one,
    // so running twice (StrictMode in dev runs layout effects twice)
    // computes the same nudge instead of undoing it.
    el.style.setProperty("--star-nudge-y", "0px");
    el.style.setProperty("--star-nudge-x", "0px");
    const rect = el.getBoundingClientRect();
    const nudge = starLabelNudgeX(rect.left, rect.right, window.innerWidth);
    el.style.setProperty("--star-nudge-x", `${nudge}px`);
    // The rise the component set for this pill (--float-rise, px).
    const rise = parseFloat(el.style.getPropertyValue("--float-rise"));
    const nudgeY = starLabelNudgeY(rect.top, rise);
    el.style.setProperty("--star-nudge-y", `${nudgeY}px`);
  }, [enabled]);
  return ref;
}
