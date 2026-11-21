// Import the CSS styles for the FloatingText component
import "./FloatingText.css";
import {
  floatingTextOrigin,
  floatingTextRise,
  floatingTextVariant,
} from "../utils/floatingTextVariants.js";

// FloatingText component displays animated text that floats up from a given position
// Props:
//   - text: The text content to display
//   - icon: Optional icon element to display next to the text
//   - x, y: The point the text originates at (the tap)
//   - onAnimationEnd: Callback function triggered when the animation completes
//   - variant: "default" (click, Contribute and passive floats) or "star"
//     (star claim labels). See utils/floatingTextVariants.js.
//
// Hotfix #202: the pill is placed AT (x, y), centered on it, from those
// coordinates only. There is no measuring, clamping or spawn offset
// (PR #197 added those and they displaced the floats from the tap). The
// rise animation is what carries the text clear of the finger.
export function FloatingText({
  text,
  icon,
  x,
  y,
  onAnimationEnd,
  variant = "default",
}) {
  const config = floatingTextVariant(variant);
  const origin = floatingTextOrigin(x, y);
  // The full 100px rise, shortened only when the top edge is closer.
  const rise = floatingTextRise(variant, y);

  // The star label wraps (at most the viewport width); the click float stays one line.
  const wrapClass = config.wrap
    ? "whitespace-normal text-center max-w-[calc(100vw-16px)] rounded-2xl"
    : "whitespace-nowrap rounded-full";

  return (
    <div
      // Tailwind classes: prevent selection, disable pointer events, position fixed,
      // the variant's animation and font size, bold green text, flex layout with gap.
      // The dark translucent pill (issue #49) gives the text contrast
      // against any background, wherever it floats. .floating-text
      // centers the pill on the origin (FloatingText.css).
      className={`floating-text select-none pointer-events-none fixed ${config.animationClass} font-bold ${config.fontClass} text-green-600 flex items-center gap-1 ${config.pillClass} px-3 py-1 ${wrapClass}`}
      style={{
        left: `${origin.left}px`,
        top: `${origin.top}px`,
        zIndex: config.zIndex,
        "--float-rise": `${rise}px`,
      }}
      // The rise and the fade are two animations of the same length;
      // the first to end removes the float (the second is a no-op).
      onAnimationEnd={onAnimationEnd}
    >
      {/* Display the main text content */}
      <span>{text}</span>
      {/* Conditionally render icon if provided */}
      {icon && <span className="flex items-center justify-center">{icon}</span>}
    </div>
  );
}
