/**
 * FloatingText variants (issue #189), as pure data so the server test
 * suite can pin them without React or CSS.
 *
 * - default: the click and Contribute float. Tuned for high-rate click
 *   spam in issue #106: 1.25s rise of 36px, text-xl, spawned 30px above
 *   the tap, up to 6 alive at once. Unchanged by #189, on purpose.
 * - star: the star claim label (gold, red and chain stars). A rare,
 *   high-value event the player wants to READ, so it is the opposite
 *   trade: it paints above the star layer, lives about 2.75s with full
 *   opacity for most of the run, uses a larger font, and spawns well
 *   above the tap point so the player's thumb does not cover it.
 *
 * Why size and offset stay star-only (Brandon's #189 comment asked to
 * apply them to the default too unless that fights the click tuning):
 * it does. On a phone the Commit button sits directly under the
 * Clicks/sec meter and the nav panel. The default float already rises
 * from 30px above the tap into that space; a real thumb-clearing offset
 * would spawn every click float on top of the meter and the tabs and
 * rise into the game content, and a larger font grows the six-float
 * cluster. That is exactly the pile-up #106 removed. So the default
 * keeps its size and offset, and the star variant gets both.
 */
export const FLOATING_TEXT_VARIANTS = Object.freeze({
  default: Object.freeze({
    /** The CSS animation class (FloatingText.css). */
    animationClass: "animate-float-up",
    /** Total lifetime, ms (the CSS animation-duration). */
    durationMs: 1250,
    /** How far above the tap point the pill's top edge spawns, px. */
    offsetAbovePx: 30,
    /** Tailwind font size class. */
    fontClass: "text-xl",
    /** Stacking: auto, as before (the click layer has nothing above it). */
    zIndex: null,
    /** Single line, as before. */
    wrap: false,
    /** The pill background (issue #49), as before. */
    pillClass: "bg-black/60",
  }),
  star: Object.freeze({
    animationClass: "animate-float-star",
    durationMs: 2750,
    /**
     * Clears an adult thumb pad (about 1.5 to 2cm, 60 to 75 CSS px on a
     * phone) above the tap point, with room to spare.
     */
    offsetAbovePx: 110,
    fontClass: "text-2xl",
    /** Above the star layer (.golden-star is z-index 50). */
    zIndex: 60,
    /** Long labels ("Sprint! Senior Developer x12 for 60s") wrap. */
    wrap: true,
    /**
     * Near-opaque pill: the label floats over card copy and code
     * comments, and at 60% the text behind it bled through in play.
     */
    pillClass: "bg-black/90",
  }),
});

/** Keep the pill this far from every viewport edge, px. */
export const FLOATING_TEXT_EDGE_MARGIN_PX = 8;

/** The variant config for a name, falling back to the default. */
export function floatingTextVariant(name) {
  return FLOATING_TEXT_VARIANTS[name] ?? FLOATING_TEXT_VARIANTS.default;
}

/**
 * The pill's top edge for a tap at `y`. The default spawns its fixed
 * offset above the tap, exactly as before #189 (no clamp: unchanged
 * behavior). The star variant spawns `offsetAbovePx` above the tap; when
 * that would leave the viewport (a star near the top of the screen) it
 * spawns the same distance BELOW the tap instead, so it still clears the
 * finger and is never off screen.
 */
export function floatingTextTop(variantName, y) {
  const variant = floatingTextVariant(variantName);
  if (variantName !== "star") return y - variant.offsetAbovePx;
  const above = y - variant.offsetAbovePx;
  if (above >= FLOATING_TEXT_EDGE_MARGIN_PX) return above;
  return y + variant.offsetAbovePx;
}
