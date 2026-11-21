/**
 * Tests for issue #213 (Slice 1 of the #210 game-feel pass): the claim
 * pop. Every star claim pops a shockwave ring with six code tick dashes
 * at the claimed star's center; a red crash's ring is red and its
 * dashes drop; chain steps escalate the ring; To the Moon frames the
 * screen edge while its 15s buff lives. Presentation only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MOONSHOT_CONFIG,
  shootingStarsChainClaim,
} from "../../shared/game-balance.js";
import {
  CHAIN_RING_STEPS,
  CLAIM_POP_EASE,
  CLAIM_POP_MS,
  CLAIM_POP_Z_INDEX,
  MAX_CLAIM_POPS,
  MOON_FRAME_Z_INDEX,
  addClaimPop,
  claimPop,
  claimPopKind,
  claimPopStep,
  moonFrameActive,
} from "../../client/src/utils/claimPop.js";
import { FLOATING_TEXT_VARIANTS } from "../../client/src/utils/floatingTextVariants.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/ClaimPop.css");
const star = src("components/GoldenStar.jsx");
const layer = src("components/ClaimPop.jsx");

/** A rule's body by its exact selector (first match from a line start). */
function rule(selector, from = css) {
  const start = from.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return from.slice(start, from.indexOf("\n}", start + 1));
}
function keyframes(name) {
  const start = css.indexOf(`@keyframes ${name} {`);
  assert.ok(start >= 0, `@keyframes ${name}`);
  return css.slice(start, css.indexOf("\n}", start));
}
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));

const GOLD = { effect: "lucky", good: true, locDelta: 100, moneyDelta: 0 };
const CRASH = { effect: "frenzy", good: false, multiplier: 0.5, red: true };
const MOON = { effect: "moonshot", good: true, multiplier: 25, durationSeconds: 15, red: true };

test("the Commit float's behavior is unchanged: its files have no diff", () => {
  assertCommitFloatLocked();
  // This slice never touches the float's own files either.
  assert.ok(!/claimPop|ClaimPop|claim-pop/.test(src("components/FloatingText.jsx")), "FloatingText.jsx has no claim pop code");
  assert.ok(!src("components/FloatingText.css").includes("claim-pop"));
});

test("trigger: applyClaim pops at the claimed star's center, for every claim kind", () => {
  // One trigger, inside applyClaim (natural, bought, Moonshot and chain
  // stars all claim through it).
  assert.equal((star.match(/claimPopRef\.current\?\.pop\(/g) ?? []).length, 1);
  const apply = star.slice(star.indexOf("const applyClaim = useCallback("), star.indexOf("// Roll one star outcome locally"));
  assert.match(apply, /claimPopRef\.current\?\.pop\(claim, position\.x \+ STAR_SIZE_PX \/ 2, position\.y \+ STAR_SIZE_PX \/ 2\);/);
  assert.match(apply, /\[dispatch, requestClaimSave, triggerFloatingText\]/, "applyClaim's dependencies are unchanged");
  for (const caller of ["handleChainStarClick", "handleStarClick", "handleBoughtStarClick"]) {
    assert.ok(star.includes(`const ${caller} = useCallback(`), caller);
  }
  assert.ok((star.match(/applyClaim\(claim, position\);/g) ?? []).length >= 3, "every claim path goes through applyClaim");
  // The layer renders the live pops and the frame.
  assert.match(star, /<ClaimPopLayer ref=\{claimPopRef\} moonFrame=\{moonFrameActive\(liveEffects\)\} \/>/);
  // The rings are the layer's own state: adding or removing one never
  // re-renders GoldenStar.
  assert.match(layer, /const \{ claimPops, triggerClaimPop, handleClaimPopEnd \} = useClaimPops\(\);/);
  assert.match(layer, /useImperativeHandle\(ref, \(\) => \(\{ pop: triggerClaimPop \}\), \[triggerClaimPop\]\);/);
  assert.ok(!/useClaimPops|claimPops/.test(star));
  assert.match(layer, /className=\{`claim-pop claim-pop--\$\{pop\.kind\} claim-pop--s\$\{pop\.step\}`\}/);
  assert.match(layer, /style=\{\{ left: `\$\{pop\.x\}px`, top: `\$\{pop\.y\}px` \}\}/);
  // The claim and its logic are untouched: no new dispatch, no state.
  assert.ok(!/dispatch|useGameContext/.test(layer));
  assert.deepEqual(claimPop(GOLD, 206, 382), { x: 206, y: 382, kind: "gold", step: 1, endScale: 2.2, borderPx: 2 });
});

test("kinds: gold for every gold claim and To the Moon, red for a crash", () => {
  assert.equal(claimPopKind(GOLD), "gold");
  assert.equal(claimPopKind({ ...GOLD, good: false }), "gold");
  assert.equal(claimPopKind(CRASH), "red");
  assert.equal(claimPopKind(MOON), "gold");
  assert.equal(MOON.effect, "moonshot");
  assert.equal(MOONSHOT_CONFIG.jackpotDurationSeconds, 15);
});

test("chain steps escalate: end scale 2.2 / 2.6 / 3.0, border 2 / 3 / 4px, capped at step 3", () => {
  assert.deepEqual(CHAIN_RING_STEPS.map((s) => [s.endScale, s.borderPx]), [[2.2, 2], [2.6, 3], [3.0, 4]]);
  for (const [step, scale, border] of [[1, 2.2, 2], [2, 2.6, 3], [3, 3.0, 4], [4, 3.0, 4], [9, 3.0, 4]]) {
    const pop = claimPop(shootingStarsChainClaim(step, 100), 0, 0);
    assert.equal(pop.step, Math.min(step, 3));
    assert.equal(pop.endScale, scale);
    assert.equal(pop.borderPx, border);
  }
  assert.equal(claimPopStep(GOLD), 1);
  // The CSS matches: each step's keyframes end at its scale, with its border.
  for (const [i, { endScale, borderPx }] of CHAIN_RING_STEPS.entries()) {
    const n = i + 1;
    const frames = keyframes(`claim-ring-${n}`);
    assert.match(frames, /from \{\s*transform: scale\(0\.6\);\s*opacity: 0\.9;/);
    assert.match(frames, new RegExp(`to \\{\\s*transform: scale\\(${endScale}\\);\\s*opacity: 0;`));
    if (n > 1) {
      const r = rule(`.claim-pop--s${n}::before`);
      assert.ok(r.includes(`border-width: ${borderPx}px;`));
      assert.ok(r.includes(`animation-name: claim-ring-${n};`));
    }
  }
  assert.ok(rule(".claim-pop::before").includes("border: 2px solid var(--pop-color);"));
});

test("the ring and dashes: 64px, gold or red, 420ms on the Commit float's ease-out, six dashes on one div", () => {
  assert.equal(CLAIM_POP_MS, 420);
  assert.equal(CLAIM_POP_EASE, "cubic-bezier(0.16, 1, 0.3, 1)");
  const ring = rule(".claim-pop::before");
  for (const decl of ["width: 64px;", "height: 64px;", "border-radius: 50%;", "background: radial-gradient(circle, var(--pop-fill), transparent 60%);", "animation: claim-ring-1 420ms cubic-bezier(0.16, 1, 0.3, 1) forwards;"]) {
    assert.ok(ring.includes(decl), decl);
  }
  const base = rule(".claim-pop");
  assert.ok(base.includes("--pop-color: #ffd700;"));
  assert.ok(base.includes("--pop-fill: rgba(255, 215, 0, 0.35);"));
  assert.ok(base.includes("animation: claim-pop-life 420ms linear forwards;"));
  assert.ok(rule(".claim-pop--red").includes("--pop-color: #ff4d4d;"));
  // Six dashes at 60-degree steps, 2px wide slivers in a 10px band.
  const ticks = rule(".claim-pop::after");
  assert.match(ticks, /repeating-conic-gradient\(\s*from -1\.65deg,\s*var\(--pop-color\) 0deg 3\.3deg,\s*transparent 3\.3deg 60deg\s*\)/);
  assert.equal(360 / 60, 6);
  // 3.3deg at the band's 35px radius is about 2px.
  assert.ok(Math.abs((3.3 / 360) * 2 * Math.PI * 35 - 2) < 0.05);
  assert.ok(ticks.includes("calc(100% - 10px)"), "10px long");
  assert.ok(ticks.includes("animation: claim-ticks-burst 420ms cubic-bezier(0.16, 1, 0.3, 1) forwards;"));
  // Gold bursts out (scale 0.6 to 1.6 is 0.6 * 35 = 21px to 56px: 35px out) with a turn; red drops.
  assert.match(keyframes("claim-ticks-burst"), /to \{\s*transform: scale\(1\.6\) rotate\(30deg\);\s*opacity: 0;/);
  assert.ok(rule(".claim-pop--red::after").includes("animation-name: claim-ticks-drop;"));
  assert.match(keyframes("claim-ticks-drop"), /to \{\s*transform: translateY\(36px\) rotate\(12deg\);\s*opacity: 0;/);
  // One div per pop: the ring and the dashes are its pseudo-elements.
  assert.equal((layer.match(/<div/g) ?? []).length, 2, "the pop div and the frame div, nothing per tick");
});

test("concurrency: at most 2 rings; a third replaces the oldest (restart, never stack)", () => {
  assert.equal(MAX_CLAIM_POPS, 2);
  let pops = [];
  pops = addClaimPop(pops, { id: 1 });
  pops = addClaimPop(pops, { id: 2 });
  assert.deepEqual(pops.map((p) => p.id), [1, 2]);
  pops = addClaimPop(pops, { id: 3 });
  assert.deepEqual(pops.map((p) => p.id), [2, 3]);
  assert.deepEqual(addClaimPop(undefined, { id: 4 }).map((p) => p.id), [4]);
  // Removed when its own 420ms life ends (not on the pseudo-elements' ends).
  assert.match(layer, /if \(event\.animationName === "claim-pop-life"\) handleClaimPopEnd\(pop\.id\);/);
  assert.match(src("hooks/useClaimPops.js"), /setClaimPops\(\(prev\) => addClaimPop\(prev, pop\)\);/);
});

test("To the Moon frame: fixed inset 0, z-index 45, static inset shadow, the layer's opacity breathes 0.5 to 1 over 1.6s, only while the buff lives", () => {
  const frame = rule(".moon-frame");
  for (const decl of ["position: fixed;", "inset: 0;", "pointer-events: none;", "z-index: 45;", "box-shadow: inset 0 0 40px rgba(255, 140, 0, 0.35);", "animation: moon-frame-breathe 1.6s ease-in-out infinite;"]) {
    assert.ok(frame.includes(decl), decl);
  }
  const breathe = keyframes("moon-frame-breathe");
  assert.match(breathe, /0%,\s*100% \{\s*opacity: 0\.5;/);
  assert.match(breathe, /50% \{\s*opacity: 1;/);
  assert.ok(!/box-shadow/.test(breathe), "the shadow itself never animates");
  assert.equal(MOON_FRAME_Z_INDEX, 45);
  // Shown exactly while a moonshot buff is live (GoldenStar's liveEffects
  // drop it when it expires), so it ends when the buff ends.
  assert.equal(moonFrameActive([{ effect: "moonshot", multiplier: 25 }]), true);
  assert.equal(moonFrameActive([{ effect: "frenzy" }]), false);
  assert.equal(moonFrameActive([]), false);
  assert.equal(moonFrameActive(undefined), false);
  assert.match(star, /const liveEffects = \(state\.activeStarEffects \?\? \[\]\)\.filter\(/);
  assert.match(layer, /\{moonFrame && <div className="moon-frame" aria-hidden="true" \/>\}/);
});

test("shared rules: transform and opacity only, pointer-events none, the 40 to 55 band under the floats", () => {
  // Every animated property in every keyframes block is transform or opacity.
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) {
    for (const prop of m[2].matchAll(/([a-z-]+):/g)) {
      assert.ok(["transform", "opacity"].includes(prop[1]), `${m[1]} animates ${prop[1]}`);
    }
  }
  assert.ok(!/transition:(?! opacity 0s linear 420ms;)/.test(css), "the only transition is the reduced-motion outline step");
  assert.ok(!/backdrop-filter|filter: blur/.test(css));
  for (const sel of [".claim-pop", ".moon-frame"]) {
    assert.ok(rule(sel).includes("pointer-events: none;"), sel);
  }
  const popZ = Number(rule(".claim-pop").match(/z-index: (\d+);/)[1]);
  assert.equal(popZ, CLAIM_POP_Z_INDEX);
  for (const z of [popZ, MOON_FRAME_Z_INDEX]) {
    assert.ok(z >= 40 && z <= 55, `z-index ${z} in the ambient band`);
    assert.ok(z < FLOATING_TEXT_VARIANTS.default.zIndex && z < FLOATING_TEXT_VARIANTS.star.zIndex, "under the floats");
  }
  assert.match(layer, /aria-hidden="true"/);
});

test("reduced motion: no ring, no dashes, no breathing; a 420ms static gold outline on the label instead", () => {
  assert.match(reduced, /\.claim-pop::before,\s*\.claim-pop::after \{\s*display: none;/);
  const at = reduced.indexOf("\n  .floating-text.animate-float-star::after {");
  assert.ok(at >= 0);
  const outline = reduced.slice(at, reduced.indexOf("\n  }", at));
  for (const decl of ["border: 2px solid #ffd700;", "opacity: 0;", "transition: opacity 0s linear 420ms;", "pointer-events: none;"]) {
    assert.ok(outline.includes(decl), decl);
  }
  // Never an animation on the label's pseudo-element: the label's own
  // onAnimationEnd would catch it and remove the label after 420ms.
  assert.ok(!/animation/.test(outline));
  assert.match(reduced, /@starting-style \{\s*\.floating-text\.animate-float-star::after \{\s*opacity: 1;/);
  assert.match(reduced, /\.moon-frame \{\s*animation: none;\s*opacity: 0\.75;/);
  // The pop div still lives its 420ms (its life animation is not motion), so it is cleaned up.
  assert.ok(!/\.claim-pop \{/.test(reduced));
});

test("no copy and no dashes added; no balance change", () => {
  for (const file of [css, layer, src("utils/claimPop.js"), src("hooks/useClaimPops.js")]) {
    assert.ok(!/[—–]/.test(file));
  }
});
