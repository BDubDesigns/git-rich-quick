// Import the CSS styles for the FloatingText component
import { useLayoutEffect, useRef, useState } from "react";
import "./FloatingText.css";

// FloatingText component displays animated text that floats up from a given position
// Props:
//   - text: The text content to display
//   - icon: Optional icon element to display next to the text
//   - x, y: The x and y coordinates where the text should appear
//   - onAnimationEnd: Callback function triggered when the animation completes
export function FloatingText({ text, icon, x, y, onAnimationEnd }) {
  // The pill is whitespace-nowrap with unbounded width, and callers
  // pass the raw click/button x — a tap near the right edge (e.g. the
  // Contribute button on a phone) used to push the pill past the
  // viewport and clip it. Measure the rendered width and clamp the
  // left edge so the pill always fits on screen. useLayoutEffect runs
  // before paint, so there is no visible jump. Vertical behaviour is
  // untouched.
  const ref = useRef(null);
  const [left, setLeft] = useState(x - 15);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = el.offsetWidth;
    const clamped = Math.max(
      8,
      Math.min(x - 15, window.innerWidth - width - 8)
    );
    setLeft(clamped);
  }, [x]);

  return (
    <div
      ref={ref}
      // Tailwind classes: prevent selection, disable pointer events, position fixed,
      // apply float-up animation, bold font, green color, flex layout with gap.
      // The dark translucent pill (issue #49) gives the text contrast
      // against any background, wherever it floats.
      className="select-none pointer-events-none 
      fixed animate-float-up 
      font-bold text-xl text-green-600 
      flex items-center gap-1
      bg-black/60 rounded-full px-3 py-1 whitespace-nowrap"
      // Position the element at the calculated coordinates (offset by 30px up, 15px left)
      style={{ top: `${y - 30}px`, left: `${left}px` }}
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
