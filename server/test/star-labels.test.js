/**
 * Tests for the floating text: the click/Contribute float and the star
 * claim label, two variants of the one shared FloatingText.
 *
 * Issue #189 gave star labels a readable life and a front layer. Hotfix
 * #202 replaced #197's spawn offset, below-the-tap fallback and
 * measure-and-clamp with what Brandon asked for: "Originate at the tap
 * site but quickly move up and slow down as it gets further up. And a
 * little bigger and the z index." So:
 *
 * - Every float is placed AT its tap (left/top from the tap only,
 *   centered on it), never displaced to satisfy an edge rule.
 * - Both rise about 100px on a strong ease-out; the click float in its
 *   1.25s, the star label early in its 2.75s and then holding.
 * - The click float is text-2xl; both have explicit z-indexes above the
 *   star layer (50) and below the rotate prompt (1000).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FLOATING_TEXT_TOP_ROOM_PX,
  FLOATING_TEXT_VARIANTS,
  floatingTextOrigin,
  floatingTextRise,
  floatingTextVariant,
} from "../../client/src/utils/floatingTextVariants.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/FloatingText.css");
const component = src("components/FloatingText.jsx");

/** The rule body for a selector in FloatingText.css. */
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return css.slice(start, css.indexOf("\n}", start));
}

/** The `animation` shorthand entries of a class: [{ name, ms, timing }]. */
function animations(className) {
  const value = rule(`.${className}`).match(/animation:\s*([\s\S]*?);/)[1];
  // Split at top-level commas only (cubic-bezier has its own).
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((part) => {
    const [, name, num, unit, timing] = part.trim().match(/^([\w-]+) ([\d.]+)(ms|s) (.+) forwards$/);
    return { name, ms: unit === "s" ? Number(num) * 1000 : Number(num), timing: timing.trim() };
  });
}

/** A keyframes block's body. */
function keyframes(name) {
  const start = css.indexOf(`@keyframes ${name} {`);
  assert.ok(start >= 0, `@keyframes ${name}`);
  return css.slice(start, css.indexOf("\n}", start));
}

/**
 * The rise a keyframes block ends at, px (positive = up): its end frame
 * translates up by --float-rise, whose fallback is the full rise.
 */
function risePx(name) {
  const m = keyframes(name).match(/translateY\(calc\(-1 \* var\(--float-rise, (\d+)px\)\)\)/);
  assert.ok(m, `${name} rises by --float-rise`);
  return Number(m[1]);
}

/** cubic-bezier(x1, y1, x2, y2) -> numbers. */
function bezier(timing) {
  const m = timing.match(/^cubic-bezier\(([^)]+)\)$/);
  return m ? m[1].split(",").map(Number) : null;
}

/** A strong ease-out: the curve leaves at a steep slope and lands flat. */
function assertStrongEaseOut(timing, label) {
  const p = bezier(timing);
  assert.ok(p, `${label}: ${timing} is a cubic-bezier`);
  const [x1, y1, x2, y2] = p;
  assert.ok(y1 / x1 >= 4, `${label}: starts fast (initial slope ${(y1 / x1).toFixed(1)})`);
  assert.ok(y2 === 1 && x2 < 1, `${label}: lands flat`);
}

const TEXT_PX = { "text-xl": 20, "text-2xl": 24, "text-3xl": 30 };

// --- Origin at the tap ---

test("origin at the tap: left/top come from the tap coordinates only, for both variants", () => {
  for (const [x, y] of [[205, 743], [4, 10], [408, 835], [0, 0]]) {
    assert.deepEqual(floatingTextOrigin(x, y), { left: x, top: y });
  }
  // The component places the pill at the origin, the same for every variant.
  assert.match(component, /const origin = floatingTextOrigin\(x, y\);/);
  assert.match(component, /left: `\$\{origin\.left\}px`,\s*top: `\$\{origin\.top\}px`,/);
  // Centered on the tap by CSS, composing with the rise transform.
  assert.match(rule(".floating-text"), /translate: -50% -50%;/);
  assert.match(rule(".floating-text"), /width: max-content;/);
  assert.match(component, /className=\{`floating-text /);
});

test("no displacement: no measure-and-clamp, no spawn offset, no below-the-tap fallback (the #197 regression)", () => {
  for (const banned of ["useLayoutEffect", "offsetWidth", "innerWidth", "Math.min", "Math.max", "setLeft", "floatingTextTop"]) {
    assert.ok(!component.includes(banned), `FloatingText has no ${banned}`);
  }
  const util = src("utils/floatingTextVariants.js");
  for (const banned of ["offsetAbovePx", "EDGE_MARGIN", "floatingTextTop"]) {
    assert.ok(!util.includes(banned), `variants have no ${banned}`);
  }
  for (const variant of Object.values(FLOATING_TEXT_VARIANTS)) {
    assert.ok(!("offsetAbovePx" in variant));
  }
});

// --- The motion ---

test("the click float: 1.25s exactly, a 100px rise on a strong ease-out, fading at the top", () => {
  const base = FLOATING_TEXT_VARIANTS.default;
  assert.equal(base.animationClass, "animate-float-up");
  assert.equal(base.durationMs, 1250);
  const [rise, fade] = animations("animate-float-up");
  assert.deepEqual([rise.name, fade.name], ["float-up", "float-up-fade"]);
  assert.equal(rise.ms, 1250);
  assert.equal(fade.ms, 1250);
  assertStrongEaseOut(rise.timing, "click rise");
  assert.equal(risePx("float-up"), 100);
  assert.equal(base.risePx, 100);
  // Opaque through the first part of the climb, gone at the end.
  assert.match(keyframes("float-up-fade"), /0%,\s*55% \{\s*opacity: 1;/);
  assert.match(keyframes("float-up-fade"), /100% \{\s*opacity: 0;/);
  // The spam protection is unchanged: at most 6 alive.
  assert.match(src("hooks/useFloatingText.js"), /const MAX_FLOATING_TEXTS = 6;/);
});

test("the star label: 2.75s, rises its 100px early and fast, then holds clear while it fades", () => {
  const star = FLOATING_TEXT_VARIANTS.star;
  assert.equal(star.animationClass, "animate-float-star");
  assert.equal(star.durationMs, 2750);
  const [rise, fade] = animations("animate-float-star");
  assert.deepEqual([rise.name, fade.name], ["float-star", "float-star-fade"]);
  assert.equal(rise.ms, 2750);
  assert.equal(fade.ms, 2750);
  const frames = keyframes("float-star");
  // The rise segment (0% to 35%) carries the strong ease-out...
  const segment = frames.match(/0% \{[^}]*animation-timing-function: ([^;]+);/);
  assert.ok(segment, "the rise segment sets its own timing");
  assertStrongEaseOut(segment[1].trim(), "star rise");
  // ...reaches the full 100px by 35%, and holds there to the end.
  assert.match(frames, /35%,\s*100% \{\s*transform: translateY\(calc\(-1 \* var\(--float-rise, 100px\)\)\);/);
  assert.equal(risePx("float-star"), 100);
  assert.equal(star.risePx, 100);
  // Readable: opaque through 80%, then the fade.
  assert.match(keyframes("float-star-fade"), /0%,\s*80% \{\s*opacity: 1;/);
  assert.match(keyframes("float-star-fade"), /100% \{\s*opacity: 0;/);
});

test("the rise is the full 100px, shortened only by the top edge; the origin never moves", () => {
  for (const variant of ["default", "star"]) {
    // Anywhere with room (the Commit button, mid-screen): the full rise.
    for (const y of [743, 400, 124, 200]) {
      assert.equal(floatingTextRise(variant, y), 100, `${variant} y ${y}`);
    }
    // Near the top (a star at the top, the passive float under the
    // header): it rises only as far as the screen allows, so it ends on
    // screen, and the origin is still the tap.
    for (const y of [57, 40, 24, 10, 0]) {
      const rise = floatingTextRise(variant, y);
      assert.equal(rise, Math.max(0, y - FLOATING_TEXT_TOP_ROOM_PX), `${variant} y ${y}`);
      assert.ok(y - rise >= Math.min(y, FLOATING_TEXT_TOP_ROOM_PX), `${variant} y ${y} ends on screen`);
      assert.deepEqual(floatingTextOrigin(205, y), { left: 205, top: y });
    }
    assert.equal(floatingTextRise(variant, Number.NaN), 0);
  }
  assert.match(component, /const rise = floatingTextRise\(variant, y\);/);
  assert.match(component, /"--float-rise": `\$\{rise\}px`,/);
});

// --- Size and layer ---

test("size: the click float is one step up from text-xl; the star label matches it", () => {
  assert.equal(FLOATING_TEXT_VARIANTS.default.fontClass, "text-2xl");
  assert.ok(TEXT_PX[FLOATING_TEXT_VARIANTS.default.fontClass] > TEXT_PX["text-xl"]);
  assert.equal(FLOATING_TEXT_VARIANTS.star.fontClass, "text-2xl");
  assert.match(component, /\$\{config\.fontClass\}/);
});

test("z-index: both variants above the star layer, below the rotate prompt; star labels over click floats", () => {
  const starZ = Number(src("components/GoldenStar.css").match(/\.golden-star \{[^}]*z-index: (\d+);/)[1]);
  const promptZ = Number(src("index.css").match(/\.rotate-prompt \{\s*position: fixed;\s*inset: 0;\s*z-index: (\d+);/)[1]);
  assert.equal(starZ, 50);
  assert.equal(promptZ, 1000);
  for (const [name, variant] of Object.entries(FLOATING_TEXT_VARIANTS)) {
    assert.ok(Number.isInteger(variant.zIndex), `${name} has an explicit z-index`);
    assert.ok(variant.zIndex > starZ && variant.zIndex < promptZ, `${name}: ${variant.zIndex}`);
  }
  assert.ok(FLOATING_TEXT_VARIANTS.star.zIndex > FLOATING_TEXT_VARIANTS.default.zIndex);
  assert.match(component, /zIndex: config\.zIndex,/);
});

// --- Wiring ---

test("one shared component; the star claim path uses the star variant, the rest the default", () => {
  assert.match(component, /variant = "default"/);
  assert.match(component, /floatingTextVariant\(variant\)/);
  assert.equal(floatingTextVariant("bogus"), FLOATING_TEXT_VARIANTS.default);
  assert.ok(!/export function \w+/.test(component.replace(/export function FloatingText\(/, "")), "no forked component");
  const star = src("components/GoldenStar.jsx");
  const uses = [...star.matchAll(/<FloatingText[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(uses.length, 1, "one render site for every star claim");
  assert.match(uses[0], /variant="star"/);
  assert.equal((star.match(/triggerFloatingText\(/g) ?? []).length, 1);
  for (const path of ["components/BouncyButton.jsx", "components/KeyPressButton.jsx", "components/PassiveAnimationLayer.jsx"]) {
    const file = src(path);
    assert.match(file, /<FloatingText/, path);
    assert.ok(!/variant=/.test(file), `${path} keeps the default`);
  }
  // The passive float originates at the stat's center (it is centered on its origin now).
  assert.match(src("components/PassiveAnimationLayer.jsx"), /const startX = rect\.left \+ rect\.width \/ 2;/);
});
