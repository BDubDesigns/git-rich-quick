/**
 * Tests for the phone portrait lock and star viewport robustness
 * (issue #194).
 *
 * Part 1: phone-sized landscape shows a full-screen rotate prompt, by a
 * CSS media query only (no Screen Orientation API). Desktop windows and
 * tablets never see it.
 * Part 2: a viewport change never eats a live star. Natural, bought and
 * chain stars render (and are claimed) at their spawn point clamped into
 * the current viewport; the star state, and so its 30s lifetime and the
 * fade in the last 5s, is never touched by the reposition.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PHONE_LANDSCAPE_QUERY,
  STAR_EDGE_MARGIN_PX,
  clampStarPosition,
} from "../../client/src/utils/starViewport.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const STAR = 64;

// --- Part 1: the rotate prompt ---

/** Evaluate PHONE_LANDSCAPE_QUERY for a device, the way a browser would. */
function matchesPhoneLandscape({ width, height, touch }) {
  return width > height && height <= 500 && touch;
}

test("the media query: landscape, at most 500px tall, touch-first; CSS and JS agree exactly", () => {
  assert.equal(
    PHONE_LANDSCAPE_QUERY,
    "(orientation: landscape) and (max-height: 500px) and (hover: none) and (pointer: coarse)"
  );
  const css = src("index.css");
  assert.ok(css.includes(`@media ${PHONE_LANDSCAPE_QUERY} {`), "index.css uses the same query");
  // Hidden by default, a fixed full-screen overlay above every game layer under the query.
  assert.match(css, /\.rotate-prompt \{\s*display: none;\s*\}/);
  const block = css.slice(css.indexOf(`@media ${PHONE_LANDSCAPE_QUERY}`));
  assert.match(block, /position: fixed;/);
  assert.match(block, /inset: 0;/);
  assert.match(block, /display: flex;/);
  const z = Number(block.match(/z-index: (\d+);/)[1]);
  assert.ok(z > 60, `prompt z-index ${z} above stars (50) and star labels (60)`);
});

test("the boundary: phones in landscape get the prompt; portrait, tablets and desktop windows do not", () => {
  const cases = [
    // [device, CSS px width x height, touch-first, expected]
    ["iPhone SE landscape", 667, 375, true, true],
    ["iPhone 14 Pro Max landscape", 932, 430, true, true],
    ["Pixel 7 landscape", 839, 412, true, true],
    ["Galaxy S8 landscape", 740, 360, true, true],
    ["Pixel 7 portrait", 412, 839, true, false],
    ["iPad Mini landscape", 1024, 768, true, false],
    ["iPad Pro 11 landscape", 1194, 834, true, false],
    ["short desktop window", 1280, 400, false, false],
    ["tiny desktop window", 700, 300, false, false],
  ];
  for (const [name, width, height, touch, expected] of cases) {
    assert.equal(matchesPhoneLandscape({ width, height, touch }), expected, name);
  }
});

test("the prompt: rendered once at the root, CSS-driven, no Screen Orientation API, no dashes", () => {
  const main = src("main.jsx");
  assert.match(main, /<RotatePrompt \/>/);
  assert.ok(main.indexOf("<RotatePrompt />") > main.indexOf("</GameProvider>"), "outside the game tree: covers splash and game");
  const prompt = src("components/RotatePrompt.jsx");
  assert.match(prompt, /className="rotate-prompt"/);
  assert.match(prompt, /Rotate to portrait/);
  const all = [prompt, src("utils/starViewport.js"), src("hooks/useViewportSize.js"), main, src("components/GoldenStar.jsx")].join("\n");
  assert.ok(!/screen\.orientation|lockOrientation|requestFullscreen/.test(all), "no Screen Orientation API");
  assert.ok(!prompt.includes("—") && !prompt.includes("–"), "no em or en dashes");
});

// --- Part 2: stars survive a viewport change ---

test("clampStarPosition: a star outside the new viewport comes back fully inside, with the margin", () => {
  // Spawned at the right of a landscape phone, then rotated to portrait.
  const star = { x: 700, y: 300, red: true };
  const clamped = clampStarPosition(star, { width: 390, height: 844 }, STAR);
  assert.equal(clamped.x, 390 - STAR - STAR_EDGE_MARGIN_PX);
  assert.equal(clamped.y, 300);
  assert.equal(clamped.red, true, "other fields pass through");
  // Below the fold of a landscape viewport.
  assert.deepEqual(
    clampStarPosition({ x: 100, y: 780 }, { width: 844, height: 390 }, STAR),
    { x: 100, y: 390 - STAR - STAR_EDGE_MARGIN_PX }
  );
  // Already inside: unchanged, so a normal render moves nothing.
  assert.deepEqual(clampStarPosition({ x: 40, y: 50 }, { width: 390, height: 844 }, STAR), { x: 40, y: 50 });
  // Every point lands inside every viewport (or at the margin when the viewport is tiny).
  for (const vw of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 2400, height: 1000 }, { width: 60, height: 60 }]) {
    for (const p of [{ x: -50, y: -50 }, { x: 5000, y: 5000 }, { x: NaN, y: 10 }, { x: 200, y: 200 }]) {
      const c = clampStarPosition(p, vw, STAR);
      assert.ok(c.x >= STAR_EDGE_MARGIN_PX && c.y >= STAR_EDGE_MARGIN_PX, JSON.stringify([vw, p, c]));
      if (vw.width >= STAR + 2 * STAR_EDGE_MARGIN_PX) {
        assert.ok(c.x + STAR <= vw.width - STAR_EDGE_MARGIN_PX, JSON.stringify([vw, p, c]));
        assert.ok(c.y + STAR <= vw.height - STAR_EDGE_MARGIN_PX, JSON.stringify([vw, p, c]));
      }
    }
  }
  assert.equal(clampStarPosition(null, { width: 1, height: 1 }, STAR), null);
});

test("natural, bought and chain stars render and claim at the clamped point; their state is never rewritten", () => {
  const star = src("components/GoldenStar.jsx");
  // The viewport re-renders the stars on resize and orientation change.
  assert.match(star, /const viewport = useViewportSize\(\);/);
  const hook = src("hooks/useViewportSize.js");
  assert.match(hook, /addEventListener\("resize"/);
  assert.match(hook, /addEventListener\("orientationchange"/);
  for (const [stateName, shown] of [["star", "shownStar"], ["chainStar", "shownChainStar"], ["boughtStar", "shownBoughtStar"]]) {
    assert.match(star, new RegExp(`const ${shown} = clampStarPosition\\(${stateName}, viewport, STAR_SIZE_PX\\);`), shown);
    assert.match(star, new RegExp(`style=\\{\\{ left: \`\\$\\{${shown}\\.x\\}px\`, top: \`\\$\\{${shown}\\.y\\}px\` \\}\\}`), `${shown} renders`);
    assert.ok(!new RegExp(`left: \`\\$\\{${stateName}\\.x\\}px\``).test(star), `${stateName} never renders unclamped`);
    // The claim (and its label) uses the point the player saw.
    assert.match(star, new RegExp(`const position = clampStarPosition\\(${stateName}, windowViewport\\(\\), STAR_SIZE_PX\\);`), `${stateName} claim`);
  }
  // Timer safety: the lifetime effects are keyed to the star objects, so
  // the reposition must never set them. Every setter call is a spawn
  // (randomStarPosition) or a clear (null).
  for (const setter of ["setStar", "setBoughtStar", "setChainStar"]) {
    for (const call of star.matchAll(new RegExp(`${setter}\\(([^;]*)\\);`, "g"))) {
      assert.ok(/^null$|randomStarPosition\(\)/.test(call[1]), `${setter}(${call[1]})`);
    }
  }
  // The star timing itself is unchanged.
  assert.match(star, /STAR_CONFIG\.starLifetimeSeconds \* 1000/);
  assert.match(star, /\(STAR_CONFIG\.starLifetimeSeconds - STAR_CONFIG\.starFadeSeconds\) \*\s*1000/);
});
