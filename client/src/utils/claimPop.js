/**
 * The claim pop (issue #213, Slice 1 of the #210 game-feel pass), as
 * pure data so the server test suite pins it. Presentation only: the
 * claim, its rewards, and star spawn and lifetime are untouched.
 *
 * Every star claim (applyClaim in GoldenStar.jsx: natural, bought,
 * Moonshot and chain stars) pops a shockwave ring at the claimed star's
 * center, with six code tick dashes. A red crash is the same ring in
 * red with the dashes dropping. Chain steps escalate the ring. To the
 * Moon also frames the screen edge for as long as its 15s buff lives.
 */

/** Ring and dashes, ms. Matches CLAIM_POP_MS in ClaimPop.css. */
export const CLAIM_POP_MS = 420;

/** The shared strong ease-out (the Commit float's rise curve). */
export const CLAIM_POP_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * At most this many rings alive (a natural and a bought star can be
 * claimed together). A third replaces the oldest, restarting rather
 * than stacking.
 */
export const MAX_CLAIM_POPS = 2;

/** The ambient layer the rings paint on: under the floats (60, 70). */
export const CLAIM_POP_Z_INDEX = 52;

/** The To the Moon screen-edge frame's layer: under everything else. */
export const MOON_FRAME_Z_INDEX = 45;

/**
 * The ring for each chain step: its end scale and border width. Step 1
 * is the plain gold ring; steps past 3 stay at the step 3 ring.
 */
export const CHAIN_RING_STEPS = Object.freeze([
  Object.freeze({ endScale: 2.2, borderPx: 2 }),
  Object.freeze({ endScale: 2.6, borderPx: 3 }),
  Object.freeze({ endScale: 3.0, borderPx: 4 }),
]);

/** The pop's kind: "red" for a crash, "gold" for everything else. */
export function claimPopKind(claim) {
  return claim?.red && claim.effect !== "moonshot" ? "red" : "gold";
}

/** The chain ring step (1 to 3) for a claim, or 1 when it is not a chain step. */
export function claimPopStep(claim) {
  const step = Math.floor(Number(claim?.chainStep) || 1);
  return Math.min(CHAIN_RING_STEPS.length, Math.max(1, step));
}

/**
 * Everything one pop renders, from the claim and the star's center:
 * where (x, y), which palette (kind), which ring (step, endScale,
 * borderPx). The CSS class names follow kind and step.
 */
export function claimPop(claim, x, y) {
  const step = claimPopStep(claim);
  return {
    x,
    y,
    kind: claimPopKind(claim),
    step,
    ...CHAIN_RING_STEPS[step - 1],
  };
}

/** Add a pop to the live list, keeping at most MAX_CLAIM_POPS (newest last). */
export function addClaimPop(pops, pop) {
  return [...(Array.isArray(pops) ? pops : []), pop].slice(-MAX_CLAIM_POPS);
}

/** Whether the To the Moon frame shows: a live moonshot buff. */
export function moonFrameActive(liveEffects) {
  return (liveEffects ?? []).some((buff) => buff?.effect === "moonshot");
}
