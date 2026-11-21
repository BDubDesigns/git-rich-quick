/**
 * FloatingText variants, as pure data so the server test suite can pin
 * them without React or CSS (issue #189, reworked by hotfix #202).
 *
 * The rule (#202, Brandon, Nov 20): "Originate at the tap site but
 * quickly move up and slow down as it gets further up. And a little
 * bigger and the z index." So every float is placed AT its origin
 * point: the pill is centered on (x, y), from those coordinates only.
 * Nothing measures, clamps or offsets it. Clearing the finger is the
 * animation's job: a strong ease-out rise of about 100px.
 *
 * - default: the click and Contribute float (and the passive LOC/s
 *   float). Keeps the issue #106 spam protections: 1.25s lifetime and
 *   at most 6 alive (useFloatingText). Only the trajectory changed: it
 *   rises 100px, fast then decelerating, and fades over the last part.
 * - star: the star claim label (gold, red and chain stars). Keeps its
 *   readable 2.75s shape, opacity held through 80% and a short fade at
 *   the end, but does its 100px of rising early (the first 35%) and
 *   fast, then holds clear of the finger while it is read and fades.
 *
 * Both paint above the star layer (.golden-star z-index 50) and below
 * the rotate prompt (1000). The star label sits above the click floats.
 */
export const FLOATING_TEXT_VARIANTS = Object.freeze({
  default: Object.freeze({
    /** The CSS animation class (FloatingText.css). */
    animationClass: "animate-float-up",
    /** Total lifetime, ms (the CSS animation-duration). */
    durationMs: 1250,
    /** Total rise, px (the end of the CSS rise keyframes). */
    risePx: 100,
    /**
     * One step up from text-xl (#202: "a little bigger"). text-2xl
     * (24px) shipped: checked in play at 10 taps a second, the six-float
     * cluster spreads along the 100px rise instead of stacking.
     */
    fontClass: "text-2xl",
    /** Above the star layer (50), below the star labels and the rotate prompt. */
    zIndex: 60,
    /** Single line. */
    wrap: false,
    /** The pill background (issue #49). */
    pillClass: "bg-black/60",
  }),
  star: Object.freeze({
    animationClass: "animate-float-star",
    durationMs: 2750,
    risePx: 100,
    fontClass: "text-2xl",
    /** Above the click floats and the star layer, below the rotate prompt. */
    zIndex: 70,
    /** Long labels ("Sprint! Senior Developer x12 for 60s") wrap. */
    wrap: true,
    /**
     * Near-opaque pill: the label floats over card copy and code
     * comments, and at 60% the text behind it bled through in play.
     */
    pillClass: "bg-black/90",
  }),
});

/** The variant config for a name, falling back to the default. */
export function floatingTextVariant(name) {
  return FLOATING_TEXT_VARIANTS[name] ?? FLOATING_TEXT_VARIANTS.default;
}

/**
 * Where the pill is placed: exactly the origin point (the tap). The
 * pill is centered on it by the CSS `translate` property, which
 * composes with the rise animation's `transform`. No variant, edge or
 * size changes it.
 */
export function floatingTextOrigin(x, y) {
  return { left: x, top: y };
}

/**
 * Room the pill's center keeps from the top edge at the end of its
 * rise, px: half a one-line text-2xl pill (about 20px) plus a little.
 */
export const FLOATING_TEXT_TOP_ROOM_PX = 24;

/**
 * How far a float rises, px: the variant's full rise, or less when the
 * origin is too close to the top of the screen for all of it (a star
 * near the top, the passive float under the header stats), so the text
 * ends on screen instead of above it. The ORIGIN never moves; only the
 * rise is shortened. Fed to the CSS as --float-rise.
 */
export function floatingTextRise(variantName, y) {
  const full = floatingTextVariant(variantName).risePx;
  const safeY = Number.isFinite(y) ? y : 0;
  return Math.max(0, Math.min(full, safeY - FLOATING_TEXT_TOP_ROOM_PX));
}
