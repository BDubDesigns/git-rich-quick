/**
 * Tests for the splash screen polish (issue #141). SplashScreen.jsx
 * imports an image and JSX, which the server test environment cannot
 * load, so these read the source text: both content boxes and the
 * header are the shared Panel (which sets the theme text color, the
 * readability fix), no hand-rolled box styles remain, the npm start
 * button has a decorative cursor, and the blink respects
 * prefers-reduced-motion.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const splash = read("components/SplashScreen.jsx");
const css = read("index.css");

test("the splash uses the shared Panel for the header and both content boxes", () => {
  assert.match(splash, /import \{ Panel \} from "\.\/Panel\.jsx";/);
  // Header, pitch and PASS panels (the #140 account box is a Panel too).
  assert.ok((splash.match(/<Panel\b/g) ?? []).length >= 3);
  // The title bar sits inside the header Panel.
  const header = splash.slice(splash.indexOf("<Panel"), splash.indexOf("</Panel>"));
  assert.match(header, /className="title-bar/);
});

test("no hand-rolled content box styles remain", () => {
  assert.doesNotMatch(splash, /bg-gray-900/);
  assert.doesNotMatch(splash, /border-gray-700/);
});

test("the Panel sets the theme's primary text color (the readability fix)", () => {
  const panelRule = css.slice(css.indexOf(".panel {"), css.indexOf("}", css.indexOf(".panel {")));
  assert.match(panelRule, /color: var\(--primary-text-color\)/);
});

test("npm start ends in a decorative blinking cursor that respects reduced motion", () => {
  assert.match(splash, /<span className="terminal-cursor" aria-hidden="true">/);
  assert.match(css, /\.terminal-cursor \{[^}]*animation: terminal-cursor-blink/);
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.terminal-cursor \{\s*animation: none;/);
});

test("no em dashes in the splash copy", () => {
  assert.ok(!splash.includes("—"));
});
