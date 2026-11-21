/**
 * Tests for issue #209: the star claim label stays fully on screen at
 * either edge. Brandon, Nov 20: "clicking stars doesn't keep the text
 * on screen it drifts left and possibly right."
 *
 * The label keeps its origin at the tap (hotfix #202). Only when the
 * centered pill would overflow does it get the MINIMUM sideways nudge
 * (starLabelNudgeX) that brings it inside the viewport with an 8px
 * margin. The click float is locked and never runs this; its #205 pins
 * live, unmodified, in star-labels.test.js.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STAR_LABEL_EDGE_MARGIN_PX,
  starLabelNudgeX,
} from "../../client/src/utils/starLabelNudge.js";
import { floatingTextOrigin } from "../../client/src/utils/floatingTextVariants.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const M = STAR_LABEL_EDGE_MARGIN_PX;

/** Where a centered pill of `width` at tap `x` renders, after its nudge. */
function rendered(x, width, vw) {
  const left = x - width / 2;
  const right = x + width / 2;
  const nudge = starLabelNudgeX(left, right, vw);
  return { left: left + nudge, right: right + nudge, nudge };
}

test("a mid-screen star label is not moved: its origin is exactly the tap", () => {
  // The measured Pixel 7 case: a 325px label tapped at the middle of 412.
  assert.equal(starLabelNudgeX(206 - 162.5, 206 + 162.5, 412), 0);
  for (const [x, width, vw] of [[206, 325, 412], [200, 120, 390], [640, 400, 1280], [180, 283, 360]]) {
    const r = rendered(x, width, vw);
    assert.equal(r.nudge, 0, `${x}/${width}/${vw}`);
    assert.equal((r.left + r.right) / 2, x, "centered exactly on the tap");
  }
  // The placement itself is the tap, untouched by the nudge.
  assert.deepEqual(floatingTextOrigin(206, 500), { left: 206, top: 500 });
});

test("an edge tap renders fully inside the viewport, at both edges (the measured drift cases)", () => {
  // Reproduced on master in a Pixel 7: 97px off the left, 118px off the right.
  const left = rendered(44, 283, 412);
  assert.equal(left.left, M);
  assert.equal(left.nudge, M - (44 - 283 / 2));
  const right = rendered(368, 325, 412);
  assert.equal(right.right, 412 - M);
  assert.ok(right.nudge < 0);
});

test("every tap position, every label width: inside with the margin, and the nudge is the minimum", () => {
  for (const vw of [320, 360, 390, 412, 768, 1280]) {
    // The label caps at 100vw - 16px, so no wider pill exists.
    for (const width of [80, 160, 283, 325, vw - 2 * M].filter((w) => w <= vw - 2 * M)) {
      for (let x = 0; x <= vw; x += 1) {
        const r = rendered(x, width, vw);
        assert.ok(r.left >= M - 1e-9 && r.right <= vw - M + 1e-9, `vw ${vw} w ${width} x ${x}: ${r.left}..${r.right}`);
        // Minimum: moved only if the centered pill overflowed, and then
        // exactly onto the margin it crossed (no further).
        const overflowLeft = x - width / 2 < M;
        const overflowRight = x + width / 2 > vw - M;
        if (!overflowLeft && !overflowRight) assert.equal(r.nudge, 0);
        if (overflowLeft) assert.equal(r.left, M);
        if (overflowRight && !overflowLeft) assert.equal(r.right, vw - M);
      }
    }
  }
});

test("the nudge is safe: a pill that just fits is not moved, junk reads 0, a too-wide pill aligns left", () => {
  assert.equal(starLabelNudgeX(M, 412 - M, 412), 0);
  assert.equal(starLabelNudgeX(M - 1, 412 - M - 1, 412), 1);
  assert.equal(starLabelNudgeX(M + 1, 412 - M + 1, 412), -1);
  for (const junk of [[Number.NaN, 10, 412], [0, Infinity, 412], [0, 10, undefined]]) {
    assert.equal(starLabelNudgeX(...junk), 0);
  }
  assert.equal(starLabelNudgeX(-50, 500, 412), M + 50);
});

test("wiring: the star label alone is nudged, via a CSS variable added to its centering; left/top stay the tap", () => {
  const component = src("components/FloatingText.jsx");
  assert.match(component, /const isStar = variant === "star";/);
  assert.match(component, /const starNudgeRef = useStarLabelNudge\(isStar\);/);
  assert.match(component, /ref=\{isStar \? starNudgeRef : undefined\}/);
  // The placement is still the origin, for every variant.
  assert.match(component, /left: `\$\{origin\.left\}px`,\s*top: `\$\{origin\.top\}px`,/);
  const hook = src("hooks/useStarLabelNudge.js");
  assert.match(hook, /if \(!enabled \|\| !el\) return;/);
  // Idempotent: it zeroes the nudge, measures the centered pill, then
  // writes the shift (a second run, e.g. StrictMode, cannot undo it).
  assert.match(hook, /el\.style\.setProperty\("--star-nudge-x", "0px"\);\s*const rect = el\.getBoundingClientRect\(\);/);
  assert.match(hook, /el\.style\.setProperty\("--star-nudge-x", `\$\{nudge\}px`\);/);
  for (const banned of ["useState", "style.left", "style.top", "setLeft"]) {
    assert.ok(!hook.includes(banned), `the hook never touches ${banned}`);
  }
  const css = src("components/FloatingText.css");
  assert.match(css, /\.floating-text\.animate-float-star \{\s*translate: calc\(-50% \+ var\(--star-nudge-x, 0px\)\) -50%;\s*\}/);
  // The click float's centering rule is the #205 one, unchanged.
  assert.match(css, /\.floating-text \{\s*translate: -50% -50%;\s*width: max-content;\s*\}/);
  assert.ok(!/--star-nudge-x/.test(css.slice(css.indexOf(".animate-float-up {"), css.indexOf("@keyframes float-star"))), "nothing in the click float's rules");
});
