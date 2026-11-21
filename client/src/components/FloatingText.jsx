// Import the CSS styles for the FloatingText component
import "./FloatingText.css";
import {
  floatingTextOrigin,
  floatingTextRise,
  floatingTextVariant,
} from "../utils/floatingTextVariants.js";
import { useStarLabelNudge } from "../hooks/useStarLabelNudge.js";

// FloatingText component displays animated text that floats up from a given position
// Props:
//   - text: The text content to display
//   - icon: Optional icon element to display next to the text
//   - x, y: The point the text originates at (the tap)
//   - onAnimationEnd: Callback function triggered when the animation completes
//   - variant: "default" (click, Contribute and passive floats) or "star"
//     (star claim labels). See utils/floatingTextVariants.js.
//     For the star variant, `text` may be a CI badge object from
//     utils/starBadge.js ({ label, name, detail, kind, chip }), issue #212.
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
  // Issue #209: the star label alone gets the minimum sideways nudge
  // that keeps it on screen at an edge (the origin stays the tap). The
  // click float never runs it.
  const isStar = variant === "star";
  const starNudgeRef = useStarLabelNudge(isStar);
  // Issue #212: the star label renders as a CI badge (a chip, the name,
  // and the detail under it), skinned by its kind. Look only.
  const badge = isStar && text && typeof text === "object" ? text : null;
  const skinClass = badge ? `ci-badge--${badge.kind}` : "";

  // The star label wraps (at most the viewport width); the click float stays one line.
  const wrapClass = config.wrap
    ? "whitespace-normal text-center max-w-[calc(100vw-16px)] rounded-2xl"
    : "whitespace-nowrap rounded-full";

  return (
    <div
      ref={isStar ? starNudgeRef : undefined}
      // Tailwind classes: prevent selection, disable pointer events, position fixed,
      // the variant's animation and font size, bold text, flex layout with gap.
      // The variant's skin (issue #212: the diff chip for the click
      // float, the CI badge for the star label; FloatingText.css) is a
      // dark pill that gives the text contrast against any background,
      // wherever it floats (issue #49). .floating-text centers the pill
      // on the origin (FloatingText.css).
      className={`floating-text select-none pointer-events-none fixed ${config.animationClass} font-bold ${config.fontClass} flex items-center gap-1 ${config.pillClass} ${skinClass} ${wrapClass}`}
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
      {badge ? (
        // The CI badge: title row (chip, name, icon), detail under it.
        <span className="ci-badge-body" aria-label={badge.label}>
          <span className="ci-badge-title">
            <span className="ci-badge-chip">{badge.chip}</span>
            <span className="ci-badge-name">{badge.name}</span>
            {icon && <span className="flex items-center justify-center">{icon}</span>}
          </span>
          {badge.detail && (
            <span className="ci-badge-detail">{badge.detail}</span>
          )}
        </span>
      ) : (
        <>
          {/* Display the main text content */}
          <span>{text}</span>
          {/* Conditionally render icon if provided */}
          {icon && <span className="flex items-center justify-center">{icon}</span>}
        </>
      )}
    </div>
  );
}
