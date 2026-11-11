// Scroll affordances: directional up/down arrows on a scrollable
// tab/pane when content hides above or below it.
//
// Ported from RuneSpace (`components/ui/ScrollAffordances.tsx`, issue
// #345): the same measurement strategy and the same presentation
// contract — the arrows are decoration only (`aria-hidden`, never
// focusable, `pointer-events: none`), so native touch, wheel, trackpad
// and keyboard scrolling are untouched; nothing here scrolls, snaps or
// intercepts. The hook lives in `hooks/useScrollAffordances.js` (a
// hook cannot share a file with components — react-refresh), the pure
// rule in `utils/scrollAffordances.js`, and the arrow shape and
// breathing in `index.css` (`.grq-scroll-affordance*`), adapted from
// RuneSpace's `.rs-scroll-affordance*` with the GRQ active-button blue
// in place of the mining amber.
//
// Placement: the overlay layer is a sibling of the scroller inside a
// `relative` frame the same size as the scroller's visible box, so the
// arrows stay on the visible viewport while the content moves under
// them and never scroll away. `ScrollAffordanceFrame` builds that
// frame for a scroller that is a child of a larger layout (the
// desktop panes in App.jsx); a scroller that is itself the layout
// child (the `<main>` in GameLayout) uses the hook and
// `ScrollAffordanceOverlay` directly.

import { useRef } from "react";
import { useScrollAffordances } from "../hooks/useScrollAffordances.js";

const AFFORDANCE_DIRECTIONS = ["top", "bottom"];

/**
 * The shared arrows: the same wrapper-and-inner-arrow markup and
 * classes as RuneSpace's, so the shape, halo and breathing are one
 * definition. `top` points up (more above) and `bottom` points down
 * (more below).
 */
export function ScrollAffordanceMarkers({ affordances }) {
  return (
    <>
      {AFFORDANCE_DIRECTIONS.map((direction) =>
        affordances[direction] ? (
          <span
            className={`grq-scroll-affordance grq-scroll-affordance--${direction}`}
            data-scroll-affordance={direction}
            key={direction}
          >
            <span
              className="grq-scroll-affordance__arrow"
              data-scroll-affordance-arrow
            />
          </span>
        ) : null,
      )}
    </>
  );
}

/**
 * The hint layer for a scroller that sits inside a `relative` frame
 * the size of its visible box. Render it as a sibling after the
 * scroller; it fills the frame and ignores pointer input.
 */
export function ScrollAffordanceOverlay({ affordances }) {
  if (!affordances.top && !affordances.bottom) return null;
  return (
    <div
      aria-hidden="true"
      className="grq-scroll-affordance-layer"
      data-scroll-affordance-layer
    >
      <ScrollAffordanceMarkers affordances={affordances} />
    </div>
  );
}

/**
 * A scroller inside its own `relative` frame, for a bounded region
 * that is a child of a larger layout (a desktop pane). `className`
 * shapes the frame as a layout child; the scroller carries
 * `scrollerClassName`, any other props (`id`, `role`, `aria-label`)
 * and optionally the caller's `scrollerRef`. The arrows sit on the
 * frame, so they stay on the scroller's visible viewport and never
 * reach a sibling.
 */
export function ScrollAffordanceFrame({
  children,
  className = "",
  scrollerClassName,
  scrollerRef,
  ...scrollerProps
}) {
  const ownRef = useRef(null);
  const ref = scrollerRef ?? ownRef;
  const affordances = useScrollAffordances(ref);
  return (
    <div className={`relative ${className}`.trim()}>
      <div {...scrollerProps} className={scrollerClassName} ref={ref}>
        {children}
      </div>
      <ScrollAffordanceOverlay affordances={affordances} />
    </div>
  );
}
