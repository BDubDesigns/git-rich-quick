/**
 * Tests for issue #229: the header's per-second passive float is
 * replaced by a tick bar. Passive income is a stream, and the standing
 * rule is that streams get bars or pulses while events get chips. A
 * slim bar along the header panel's bottom edge fills over each 1s
 * production tick (scaleX, origin left, LOC green), and the LOC total
 * does a quiet flash (opacity only, no scale) when the tick lands.
 * Presentation only: the tick credit and the reducer are untouched.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRODUCTION_TICK_EVENT,
  TICK_FLASH_MS,
  tickBarVisible,
} from "../../client/src/utils/tickBar.js";
import { STAT_GAIN_COLORS } from "../../client/src/utils/statGain.js";
import { BALANCE } from "../../shared/game-balance.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/TickBar.css");
const app = src("App.jsx");
const box = src("components/StatBox.jsx");
const display = src("components/StatDisplay.jsx");
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

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
function gameTickEffect() {
  const start = app.indexOf("// Game tick effect");
  return app.slice(start, app.indexOf("GAME_BALANCE_CONFIG.TICK_INTERVAL);", start));
}

test("the Commit float's behavior is unchanged: its files have no diff", () => {
  assertCommitFloatLocked();
  assert.ok(!/tick-bar|stat-tick-flash|PRODUCTION_TICK/.test(src("components/FloatingText.jsx") + src("components/FloatingText.css")));
});

test("the per-second passive float is gone: the tick no longer launches a floating number", () => {
  const tick = gameTickEffect();
  assert.ok(tick.length > 0);
  assert.ok(!/gameTickAnimation|CustomEvent|FloatingText/.test(tick), "the tick dispatches no float");
  // A tick that credits passive LOC dispatches the production tick instead.
  assert.match(tick, /if \(locAmount > 0\) \{\s*window\.dispatchEvent\(new Event\(PRODUCTION_TICK_EVENT\)\);\s*\}/);
  assert.match(tick, /dispatch\(\{ type: "GAME_TICK" \}\);/);
  assert.match(tick, /if \(stateRef\.current\.prestigeIntermission\) return;/);
  assert.equal(PRODUCTION_TICK_EVENT, "productionTick");
  // The only other source of the passive layer's float is the Night Shift report, a one-off event.
  const context = src("context/GameContext.jsx");
  assert.equal((context.match(/new CustomEvent\("gameTickAnimation"/g) ?? []).length, 1);
  assert.match(context, /onNightShift: \(report\) => \{[\s\S]*?new CustomEvent\("gameTickAnimation"/);
  assert.equal((app + box).match(/gameTickAnimation/g), null);
});

test("the bar: keyed by the tick, inside the header panel, the tick interval long", () => {
  const hook = src("hooks/useProductionTick.js");
  assert.match(hook, /window\.addEventListener\(PRODUCTION_TICK_EVENT, onTick\);/);
  assert.match(hook, /return \(\) => window\.removeEventListener\(PRODUCTION_TICK_EVENT, onTick\);/);
  assert.match(hook, /setTick\(\(n\) => n \+ 1\)/);
  assert.match(box, /const tick = useProductionTick\(\);/);
  assert.match(box, /import "\.\/TickBar\.css";/);
  // The panel is the bar's positioning box; the bar is its last child.
  assert.match(box, /<Panel className="relative flex /);
  const panel = box.slice(box.indexOf("<Panel"), box.indexOf("</Panel>"));
  assert.match(panel, /\{tickBarVisible\(tick, locPerSecond\) && \(\s*<span\s*key=\{tick\}\s*className="tick-bar"\s*aria-hidden="true"\s*style=\{\{ animationDuration: `\$\{GAME_BALANCE_CONFIG\.TICK_INTERVAL\}ms` \}\}\s*\/>/);
  assert.ok(panel.indexOf('className="tick-bar"') > panel.lastIndexOf("<StatDisplay"));
  assert.equal(BALANCE.mechanics.tickIntervalMs, 1000);
  // Visible only once a tick has landed and while there is production.
  assert.equal(tickBarVisible(0, 100), false, "never on mount");
  assert.equal(tickBarVisible(3, 0), false, "no production, no bar");
  assert.equal(tickBarVisible(3, 100), true);
  assert.equal(tickBarVisible(3, Number.NaN), false);
});

test("the bar's look: 2px on the bottom edge, clear of the corners, scaleX from the left in LOC green", () => {
  const bar = rule(".tick-bar");
  for (const decl of [
    "position: absolute;",
    "left: 1rem;",
    "right: 1rem;",
    "bottom: 0;",
    "height: 2px;",
    `background: ${STAT_GAIN_COLORS.loc};`,
    "pointer-events: none;",
    "transform-origin: left;",
    "transform: scaleX(0);",
    "animation: tick-bar-fill 1000ms linear forwards;",
  ]) {
    assert.ok(bar.includes(decl), decl);
  }
  assert.match(keyframes("tick-bar-fill"), /from \{\s*transform: scaleX\(0\);\s*\}\s*to \{\s*transform: scaleX\(1\);/);
});

test("the LOC flash: opacity only, no scale, quieter than the Slice 2 bump, on the LOC total alone", () => {
  assert.equal(TICK_FLASH_MS, 300);
  const flash = rule(".stat-tick-flash");
  for (const decl of ["position: absolute;", "inset: 0;", `color: ${STAT_GAIN_COLORS.loc};`, "pointer-events: none;", "opacity: 0;", "animation: stat-tick-flash 300ms ease-out;"]) {
    assert.ok(flash.includes(decl), decl);
  }
  const frames = keyframes("stat-tick-flash");
  assert.match(frames, /0% \{\s*opacity: 0\.6;\s*\}\s*100% \{\s*opacity: 0;/);
  assert.ok(!/transform|scale/.test(frames));
  // Only the LOC stat flashes.
  assert.equal((box.match(/flashKey=\{tick\}/g) ?? []).length, 1);
  assert.match(box, /bump="loc"\s*bumpKey=\{locBump\}\s*flashKey=\{tick\}/);
  // StatDisplay: the flash is a copy inside the value, keyed by the tick, so the value (and a bump in flight) is not remounted.
  assert.match(display, /\{ icon, value, label, bump, bumpKey = 0, flashKey = 0 \}/);
  assert.match(display, /<span\s*key=\{bumpKey\}/);
  assert.match(display, /\{flashKey > 0 && \(\s*<span key=\{flashKey\} className="stat-tick-flash" aria-hidden="true">\s*\{value\}\s*<\/span>\s*\)\}/);
});

test("the shared rules: transform and opacity only, pointer-events none, no z-index or transition", () => {
  const rules = code(css);
  for (const banned of ["z-index", "transition", "filter", "width:", "scale("]) {
    assert.ok(!rules.includes(banned), `no ${banned}`);
  }
  for (const name of ["tick-bar-fill", "stat-tick-flash"]) {
    const frames = keyframes(name).replace(/@keyframes [\w-]+ \{/, "");
    const props = [...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    assert.ok(props.length > 0);
    for (const prop of props) assert.ok(["transform", "opacity"].includes(prop), `${name}: ${prop}`);
  }
});

test("reduced motion: no bar; the flash stays as an opacity fade", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
  assert.match(reduced, /\.tick-bar \{\s*animation: none;\s*display: none;/);
  assert.ok(!reduced.includes(".stat-tick-flash"));
});

test("no dashes in the new files", () => {
  for (const file of [css, src("utils/tickBar.js"), src("hooks/useProductionTick.js"), gameTickEffect()]) {
    assert.ok(!/[—–]/.test(file));
  }
});
