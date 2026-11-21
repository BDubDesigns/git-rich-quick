/**
 * Tests for the star claim labels (issue #189, plus Brandon's Nov 20
 * playtest comment): readable lifetime, front layer, larger, and spawned
 * above the finger, as a variant on the shared FloatingText, not a fork.
 * The click and Contribute float keeps the issue #106 tuning exactly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FLOATING_TEXT_EDGE_MARGIN_PX,
  FLOATING_TEXT_VARIANTS,
  floatingTextTop,
  floatingTextVariant,
} from "../../client/src/utils/floatingTextVariants.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/FloatingText.css");

/** The animation-duration of a CSS class, in ms. */
function durationMs(className) {
  const block = css.match(new RegExp(`\\.${className} \\{([^}]*)\\}`))[1];
  const [, value, unit] = block.match(/animation-duration:\s*([\d.]+)(ms|s);/);
  return unit === "s" ? Number(value) * 1000 : Number(value);
}

const TEXT_PX = { "text-xl": 20, "text-2xl": 24, "text-3xl": 30 };

test("the click float is unchanged: float-up at 1.25s exactly, text-xl, 30px above the tap, no z-index", () => {
  const base = FLOATING_TEXT_VARIANTS.default;
  assert.equal(base.animationClass, "animate-float-up");
  assert.equal(base.durationMs, 1250);
  assert.equal(durationMs("animate-float-up"), 1250);
  assert.equal(base.fontClass, "text-xl");
  assert.equal(base.offsetAbovePx, 30);
  assert.equal(base.zIndex, null);
  assert.equal(base.wrap, false);
  assert.equal(base.pillClass, "bg-black/60");
  // Same position rule as before #189: the top edge 30px above the tap, unclamped.
  assert.equal(floatingTextTop("default", 400), 370);
  assert.equal(floatingTextTop("default", 10), -20);
  // The float-up keyframes are the #106 ones: full fade across a 36px rise.
  assert.match(css, /@keyframes float-up \{[\s\S]*?to \{[\s\S]*?opacity: 0;[\s\S]*?translateY\(-36px\)/);
  // An unknown variant falls back to the click float.
  assert.equal(floatingTextVariant("bogus"), base);
});

test("the star variant: about 2.75s, held opaque for most of the run, above the star layer", () => {
  const star = FLOATING_TEXT_VARIANTS.star;
  assert.equal(star.animationClass, "animate-float-star");
  assert.equal(durationMs("animate-float-star"), star.durationMs);
  assert.ok(star.durationMs >= 2500 && star.durationMs <= 3000, `${star.durationMs}ms`);
  // Opacity holds at 1 through 80% of the run, then fades to 0.
  const keyframes = css.match(/@keyframes float-star \{([\s\S]*?)\n\}/)[1];
  assert.match(keyframes, /80% \{\s*opacity: 1;/);
  assert.match(keyframes, /100% \{\s*opacity: 0;/);
  // Above the star itself (.golden-star z-index) and the scroll affordances.
  const starZ = Number(src("components/GoldenStar.css").match(/\.golden-star \{[^}]*z-index: (\d+);/)[1]);
  assert.equal(starZ, 50);
  assert.ok(star.zIndex > starZ, `label ${star.zIndex} over star ${starZ}`);
  assert.equal(star.zIndex, 60);
});

test("the star variant: a larger font than the click float, and a real offset above the finger", () => {
  const star = FLOATING_TEXT_VARIANTS.star;
  const base = FLOATING_TEXT_VARIANTS.default;
  assert.ok(TEXT_PX[star.fontClass] > TEXT_PX[base.fontClass], `${star.fontClass} vs ${base.fontClass}`);
  // Clears a thumb pad (about 60 to 75 CSS px), far more than the click float's 30.
  assert.ok(star.offsetAbovePx >= 90, `${star.offsetAbovePx}px`);
  assert.equal(floatingTextTop("star", 500), 500 - star.offsetAbovePx);
  // Near the top of the screen there is no room above: it spawns the
  // same distance below the tap instead, never off screen.
  assert.equal(floatingTextTop("star", 40), 40 + star.offsetAbovePx);
  for (const y of [0, 20, 60, 117, 118, 300, 800]) {
    const top = floatingTextTop("star", y);
    assert.ok(top >= FLOATING_TEXT_EDGE_MARGIN_PX, `y ${y}: top ${top}`);
    assert.ok(Math.abs(top - y) >= star.offsetAbovePx, `y ${y}: clears the finger`);
  }
  // Long labels wrap inside the viewport instead of running off it, on
  // a near-opaque pill so the copy behind does not bleed through.
  assert.equal(star.wrap, true);
  assert.equal(star.pillClass, "bg-black/90");
});

test("one shared component: FloatingText takes a variant prop, the default stays the default", () => {
  const component = src("components/FloatingText.jsx");
  assert.match(component, /variant = "default"/);
  assert.match(component, /floatingTextVariant\(variant\)/);
  assert.match(component, /floatingTextTop\(variant, y\)/);
  assert.match(component, /config\.animationClass/);
  assert.match(component, /zIndex: config\.zIndex/);
  // No forked star label component.
  assert.ok(!/export function \w+/.test(component.replace(/export function FloatingText\(/, "")));
});

test("the star claim path uses the star variant; the click, Contribute and passive paths use the default", () => {
  const star = src("components/GoldenStar.jsx");
  const uses = [...star.matchAll(/<FloatingText[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(uses.length, 1, "one render site for every star claim");
  assert.match(uses[0], /variant="star"/);
  // Gold, red and chain claims all go through applyClaim, the one
  // place that triggers the label.
  assert.equal((star.match(/triggerFloatingText\(/g) ?? []).length, 1);
  assert.ok((star.match(/applyClaim\(claim, position\)/g) ?? []).length >= 3);
  for (const path of ["components/BouncyButton.jsx", "components/KeyPressButton.jsx", "components/PassiveAnimationLayer.jsx"]) {
    const file = src(path);
    assert.match(file, /<FloatingText/, path);
    assert.ok(!/variant=/.test(file), `${path} keeps the default`);
  }
});
