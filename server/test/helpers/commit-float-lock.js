/**
 * The Commit click float's LOCKED behavior (Brandon, #202 and #210):
 * origin at the tap, the fast-then-slowing ~100px rise, text-2xl,
 * 1.25s, z-index 60, at most 6 alive. Every game-feel slice of #210
 * runs this, so a slice that changes the float's look (Slice A) or adds
 * effects next to it (Slices 1 to 3) cannot change how it behaves.
 *
 * Not a test file itself (the suite runs test/*.test.js); each slice's
 * test calls assertCommitFloatLocked().
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  FLOATING_TEXT_TOP_ROOM_PX,
  FLOATING_TEXT_VARIANTS,
  floatingTextOrigin,
  floatingTextRise,
} from "../../../client/src/utils/floatingTextVariants.js";

const src = (path) =>
  readFileSync(new URL(`../../../client/src/${path}`, import.meta.url), "utf8");

/**
 * Files on the click float's path that no game-feel slice touches:
 * their exact master contents (sha256), so any diff fails here.
 */
export const COMMIT_FLOAT_FILE_HASHES = Object.freeze({
  "hooks/useFloatingText.js": "0f0aca076f0f5ddcc793ebbe2f314efeadb74d0e14a997aa401e8cb51bf15dba",
  "components/ClickButton.jsx": "5074b8044f42255be7eaa493f1ac834be72aae10245ee15d7380eeb5ecbc6333",
  "components/BouncyButton.jsx": "9e7f81501d83d32c5afc55c2212b710767c386304cfd3b1b89ad11c226ce243b",
  "components/KeyPressButton.jsx": "ec4e9d8d4e13c725e4d5fc5a008156216ea07189ba4b5cca89dc28572e70ac66",
  "components/PassiveAnimationLayer.jsx": "5b99dc1d94b9aa3055036baadd8e11b979bfa38a453e2ebe23b5ab57c79cd547",
});

/** The motion rules of the click float, verbatim (FloatingText.css). */
const CLICK_FLOAT_CSS = [
  `.floating-text {
  translate: -50% -50%;
  width: max-content;
}`,
  `@keyframes float-up {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(calc(-1 * var(--float-rise, 100px)));
  }
}`,
  `@keyframes float-up-fade {
  0%,
  55% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}`,
  `.animate-float-up {
  animation:
    float-up 1.25s cubic-bezier(0.16, 1, 0.3, 1) forwards,
    float-up-fade 1.25s linear forwards;
}`,
];

export function assertCommitFloatLocked() {
  // The variant's behavior values.
  const base = FLOATING_TEXT_VARIANTS.default;
  assert.equal(base.animationClass, "animate-float-up");
  assert.equal(base.durationMs, 1250);
  assert.equal(base.risePx, 100);
  assert.equal(base.fontClass, "text-2xl");
  assert.equal(base.zIndex, 60);
  assert.equal(base.wrap, false);
  // Origin at the tap, the rise shortened only by the top edge.
  assert.deepEqual(floatingTextOrigin(205, 743), { left: 205, top: 743 });
  assert.equal(FLOATING_TEXT_TOP_ROOM_PX, 24);
  assert.equal(floatingTextRise("default", 743), 100);
  assert.equal(floatingTextRise("default", 50), 26);
  // The motion, verbatim.
  const css = src("components/FloatingText.css");
  for (const block of CLICK_FLOAT_CSS) {
    assert.ok(css.includes(block), `FloatingText.css keeps:\n${block}`);
  }
  // The component still places every float at its origin with the
  // variant's z-index and rise.
  const component = src("components/FloatingText.jsx");
  assert.match(component, /const origin = floatingTextOrigin\(x, y\);/);
  assert.match(component, /left: `\$\{origin\.left\}px`,\s*top: `\$\{origin\.top\}px`,\s*zIndex: config\.zIndex,\s*"--float-rise": `\$\{rise\}px`,/);
  assert.match(component, /onAnimationEnd=\{onAnimationEnd\}/);
  // The files around it: no diff at all (this includes the 6-alive cap).
  for (const [path, hash] of Object.entries(COMMIT_FLOAT_FILE_HASHES)) {
    assert.equal(createHash("sha256").update(src(path)).digest("hex"), hash, `${path} is unchanged`);
  }
  assert.match(src("hooks/useFloatingText.js"), /const MAX_FLOATING_TEXTS = 6;/);
}
