/**
 * Tests for issue #215 (Slice 3 of the #210 game-feel pass): the exit.
 * A successful sale plays a 1.1s merge beat (the Equity strip flashes
 * gold reading MERGED INTO main, the ACQUIRED stamp slams in and
 * fades) over the already-rendered store screen, then Equity spendable
 * counts up to the new value with one Slice 2 bump. A presentation
 * layer: the sale and the intermission flow are untouched.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXIT_BEAT_FRESH_MS,
  EXIT_BEAT_MS,
  EXIT_BEAT_Z_INDEX,
  EXIT_COUNT_UP_MS,
  EXIT_STAMP_HOLD_END_MS,
  EXIT_STAMP_IN_MS,
  EXIT_STAMP_TEXT,
  EXIT_STRIP_MS,
  EXIT_STRIP_TEXT,
  endExitBeat,
  exitCountUpActive,
  exitCountUpDelayMs,
  exitCountUpValue,
  getExitBeat,
  measureEquityStrip,
  startExitBeat,
  subscribeExitBeat,
} from "../../client/src/utils/exitBeat.js";
import { FLOATING_TEXT_VARIANTS } from "../../client/src/utils/floatingTextVariants.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/ExitBeat.css");
const layer = src("components/ExitBeatLayer.jsx");
const countUp = src("components/ExitCountUp.jsx");
const sell = src("components/SellCompany.jsx");

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
/** A keyframe percentage as ms of the 1100ms stamp animation. */
const at = (pct) => Math.round((pct / 100) * EXIT_BEAT_MS);

test("the Commit float's behavior is unchanged: its files have no diff", () => {
  assertCommitFloatLocked();
});

test("trigger: a successful sale response in SellCompany, measured before the sale swaps the screen", () => {
  const confirm = sell.slice(sell.indexOf("async function handleSellConfirm() {"), sell.indexOf("if (state.prestigeIntermission) {"));
  // Measured BEFORE the sale (its restore replaces the game with the store screen)...
  assert.match(confirm, /const beatFrom = \{ stripRect: measureEquityStrip\(\), fromEquity: spendable \};\s*try \{\s*const result = await sellCompany\(\);\s*if \(result\.ok\) \{/);
  // ...and started only on success.
  assert.match(confirm, /if \(result\.ok\) \{[\s\S]*?startExitBeat\(beatFrom\);\s*(\/\/[^\n]*\s*)*setStep\("complete"\);/);
  assert.equal((sell.match(/startExitBeat\(/g) ?? []).length, 1);
  assert.ok(!/startExitBeat/.test(confirm.slice(confirm.indexOf("} else if"))), "never on a failed sale");
  // The sale flow itself is untouched: the same sellCompany call, the
  // same intermission switch in App, the same store.
  assert.match(src("App.jsx"), /if \(state\.prestigeIntermission\) \{\s*return <IntermissionScreen \/>;/);
  assert.ok(!/exitBeat|ExitBeat/.test(src("App.jsx") + src("context/GameContext.jsx") + src("save/saveSync.js")));
  // The layer sits beside the App, so it lives across the screen switch.
  assert.match(src("main.jsx"), /<App \/>\s*<\/GameProvider>[\s\S]*<ExitBeatLayer \/>/);
  assert.match(src("components/EquityProgressStrip.jsx"), /data-equity-strip=""/);
});

test("timing: strip 0 to 350ms, stamp in at 250ms, overshoot to 0.96, settled, held to 900ms, gone at 1100ms", () => {
  assert.deepEqual([EXIT_STRIP_MS, EXIT_STAMP_IN_MS, EXIT_STAMP_HOLD_END_MS, EXIT_BEAT_MS, EXIT_COUNT_UP_MS], [350, 250, 900, 1100, 700]);
  assert.ok(rule(".exit-strip").includes("animation: exit-strip 350ms linear forwards;"));
  assert.match(keyframes("exit-strip"), /0%,\s*70% \{\s*opacity: 1;\s*\}\s*100% \{\s*opacity: 0;/);
  assert.ok(rule(".exit-stamp").includes("animation: exit-stamp 1100ms linear forwards;"));
  const stamp = keyframes("exit-stamp");
  assert.equal(at(22.73), 250);
  assert.match(stamp, /0%,\s*22\.73% \{\s*opacity: 0;\s*transform: rotate\(-8deg\) scale\(1\.6\);\s*animation-timing-function: cubic-bezier\(0\.16, 1, 0\.3, 1\);/);
  assert.equal(at(40.91), 450);
  assert.match(stamp, /40\.91% \{\s*opacity: 1;\s*transform: rotate\(-8deg\) scale\(0\.96\);/);
  assert.equal(at(50), 550);
  assert.match(stamp, /50% \{\s*opacity: 1;\s*transform: rotate\(-8deg\) scale\(1\);/);
  assert.equal(at(81.82), 900);
  assert.match(stamp, /81\.82% \{\s*opacity: 1;\s*transform: rotate\(-8deg\) scale\(1\);/);
  assert.match(stamp, /100% \{\s*opacity: 0;\s*transform: rotate\(-8deg\) scale\(1\);/);
  // The beat ends on the stamp's own animation end.
  assert.match(layer, /onAnimationEnd=\{\(\) => endExitBeat\(beat\.id\)\}/);
});

test("the look and the copy: MERGED INTO main on gold, ACQUIRED in red ink, no dashes", () => {
  assert.equal(EXIT_STRIP_TEXT, "MERGED INTO main");
  assert.equal(EXIT_STAMP_TEXT, "ACQUIRED");
  for (const text of [EXIT_STRIP_TEXT, EXIT_STAMP_TEXT]) assert.ok(!/[—–]/.test(text));
  assert.ok(rule(".exit-strip").includes("background: #facc15;"));
  const stamp = rule(".exit-stamp");
  for (const decl of ["font-weight: 800;", "letter-spacing: 0.2em;", "color: rgba(239, 68, 68, 0.9);", "border: 3px solid currentColor;", "padding: 6px 14px;"]) {
    assert.ok(stamp.includes(decl), decl);
  }
  assert.match(layer, /\{EXIT_STRIP_TEXT\}/);
  assert.match(layer, /\{EXIT_STAMP_TEXT\}/);
  // The strip copy sits exactly where the strip was.
  assert.match(layer, /style=\{\{ left: `\$\{r\.left\}px`, top: `\$\{r\.top\}px`, width: `\$\{r\.width\}px`, height: `\$\{r\.height\}px` \}\}/);
});

test("never blocks the store: pointer-events none at z-index 55, transform and opacity only, one beat at a time", () => {
  for (const sel of [".exit-strip", ".exit-stamp-layer", ".exit-stamp"]) {
    assert.ok(rule(sel).includes("pointer-events: none;"), sel);
  }
  for (const sel of [".exit-strip", ".exit-stamp-layer"]) {
    assert.ok(rule(sel).includes(`z-index: ${EXIT_BEAT_Z_INDEX};`), sel);
  }
  assert.equal(EXIT_BEAT_Z_INDEX, 55);
  assert.ok(EXIT_BEAT_Z_INDEX < FLOATING_TEXT_VARIANTS.default.zIndex);
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) {
    for (const prop of m[2].matchAll(/([a-z-]+):/g)) {
      assert.ok(["transform", "opacity", "animation-timing-function"].includes(prop[1]), `${m[1]} animates ${prop[1]}`);
    }
  }
  assert.match(layer, /aria-hidden="true"/g);
  assert.ok(!/dispatch|useGameContext/.test(layer), "the layer changes no game state");
  // One beat: a second sale replaces the first; ending a stale id is a no-op.
  let calls = 0;
  const off = subscribeExitBeat(() => { calls += 1; });
  const a = startExitBeat({ stripRect: null, fromEquity: 0 }, 1000);
  const b = startExitBeat({ stripRect: null, fromEquity: 1 }, 2000);
  assert.equal(getExitBeat(), b);
  endExitBeat(a.id);
  assert.equal(getExitBeat(), b, "a stale end does nothing");
  endExitBeat(b.id);
  assert.equal(getExitBeat(), null);
  assert.equal(calls, 3);
  off();
});

test("the count-up: whole Equity, never past the target, landing exactly on the new value", () => {
  for (const [from, to] of [[0, 4], [3, 7], [0, 1], [10, 250], [0, 100000]]) {
    let last = from;
    for (let i = 0; i <= 100; i += 1) {
      const v = exitCountUpValue(from, to, i / 100);
      assert.ok(Number.isInteger(v), `${from} to ${to} at ${i}%`);
      assert.ok(v >= last && v <= to, "climbs, never past the target");
      last = v;
    }
    assert.equal(exitCountUpValue(from, to, 1), to, "lands exactly");
    assert.equal(exitCountUpValue(from, to, 1.5), to);
  }
  assert.equal(exitCountUpValue(0, 4, 0), 0, "starts at the old value");
  assert.equal(exitCountUpValue(5, 5, 0.5), 5);
  assert.equal(exitCountUpValue(undefined, 4, 0.2), 4);
  // It waits for the beat, and only plays for a fresh, climbing beat.
  assert.equal(exitCountUpDelayMs({ atMs: 1000 }, 1200), 900);
  assert.equal(exitCountUpDelayMs({ atMs: 1000 }, 5000), 0);
  assert.equal(exitCountUpActive({ atMs: 1000, fromEquity: 0 }, 4, 1100), true);
  assert.equal(exitCountUpActive({ atMs: 1000, fromEquity: 0 }, 4, 1000 + EXIT_BEAT_FRESH_MS + 1), false, "a reload mid-intermission just shows the number");
  assert.equal(exitCountUpActive({ atMs: 1000, fromEquity: 4 }, 4, 1100), false);
  assert.equal(exitCountUpActive(null, 4, 0), false);
  // Wiring: 700ms of frames toward the LIVE value (a purchase under the
  // stamp spends Equity), tabular figures, one Slice 2 bump at the end.
  assert.match(countUp, /const t = \(now - startMs\) \/ EXIT_COUNT_UP_MS;/);
  assert.match(countUp, /setShown\(exitCountUpValue\(beat\.fromEquity, target\.current, t\)\);/);
  assert.match(countUp, /else setBumped\(true\);/);
  assert.match(countUp, /`exit-count stat-value\$\{bumped \? " stat-bump stat-bump--money" : ""\}`/);
  assert.ok(rule(".exit-count").includes("font-variant-numeric: tabular-nums;"));
  assert.match(src("components/PermanentStore.jsx"), /Equity spendable: <ExitCountUp value=\{spendable\} \/>/);
});

test("reduced motion: the stamp appears and disappears with no scale or rotation", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
  assert.match(reduced, /\.exit-stamp \{\s*transform: none;\s*animation-name: exit-stamp-still;/);
  const still = keyframes("exit-stamp-still");
  assert.ok(!/transform/.test(still));
  assert.match(still, /22\.73%,\s*81\.82% \{\s*opacity: 1;/);
  assert.match(still, /81\.83%,\s*100% \{\s*opacity: 0;/);
});

test("measuring the strip: the first visible one, or none", () => {
  const box = (w, h) => ({ getBoundingClientRect: () => ({ left: 8, top: 143, width: w, height: h }) });
  assert.deepEqual(measureEquityStrip({ querySelectorAll: () => [box(0, 0), box(396, 16)] }), { left: 8, top: 143, width: 396, height: 16 });
  assert.equal(measureEquityStrip({ querySelectorAll: () => [] }), null, "the strip turned off: the stamp still plays");
  assert.equal(measureEquityStrip(undefined), null);
});
