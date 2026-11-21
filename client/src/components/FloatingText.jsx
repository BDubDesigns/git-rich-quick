// Import the CSS styles for the FloatingText component
import { useLayoutEffect, useRef, useState } from "react";
import "./FloatingText.css";
import {
  FLOATING_TEXT_EDGE_MARGIN_PX,
  floatingTextTop,
  floatingTextVariant,
} from "../utils/floatingTextVariants.js";

// FloatingText component displays animated text that floats up from a given position
// Props:
//   - text: The text content to display
//   - icon: Optional icon element to display next to the text
//   - x, y: The x and y coordinates where the text should appear
//   - onAnimationEnd: Callback function triggered when the animation completes
//   - variant: "default" (click and Contribute floats, the issue #106
//     click-spam tuning) or "star" (star claim labels, issue #189:
//     longer and readable, larger, above the star layer, spawned well
//     above the finger). See utils/floatingTextVariants.js.
export function FloatingText({
  text,
  icon,
  x,
  y,
  onAnimationEnd,
  variant = "default",
}) {
  const config = floatingTextVariant(variant);
  // The pill is whitespace-nowrap with unbounded width, and callers
  // pass the raw click/button x — a tap near the right edge (e.g. the
  // Contribute button on a phone) used to push the pill past the
  // viewport and clip it. Measure the rendered width and clamp the
  // left edge so the pill always fits on screen. useLayoutEffect runs
  // before paint, so there is no visible jump. Vertical position comes
  // from the variant (floatingTextTop).
  const ref = useRef(null);
  const [left, setLeft] = useState(x - 15);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure at the left edge first: a wrapping (star) pill placed
    // near the right edge shrink-wraps to the space left of it, so its
    // width there is not its real width and the clamp would never move
    // it. A one-line pill measures the same either way.
    el.style.left = "0px";
    const width = el.offsetWidth;
    const clamped = Math.max(
      FLOATING_TEXT_EDGE_MARGIN_PX,
      Math.min(x - 15, window.innerWidth - width - FLOATING_TEXT_EDGE_MARGIN_PX)
    );
    setLeft(clamped);
  }, [x]);

  // The star label wraps inside the viewport; the click float stays one line.
  const wrapClass = config.wrap
    ? "whitespace-normal text-center max-w-[calc(100vw-16px)] rounded-2xl"
    : "whitespace-nowrap rounded-full";

  return (
    <div
      ref={ref}
      // Tailwind classes: prevent selection, disable pointer events, position fixed,
      // the variant's animation and font size, bold green text, flex layout with gap.
      // The dark translucent pill (issue #49) gives the text contrast
      // against any background, wherever it floats.
      className={`select-none pointer-events-none fixed ${config.animationClass} font-bold ${config.fontClass} text-green-600 flex items-center gap-1 ${config.pillClass} px-3 py-1 ${wrapClass}`}
      style={{
        top: `${floatingTextTop(variant, y)}px`,
        left: `${left}px`,
        ...(config.zIndex === null ? {} : { zIndex: config.zIndex }),
      }}
      // Trigger callback when animation ends
      onAnimationEnd={onAnimationEnd}
    >
      {/* Display the main text content */}
      <span>{text}</span>
      {/* Conditionally render icon if provided */}
      {icon && <span className="flex items-center justify-center">{icon}</span>}
    </div>
  );
}
