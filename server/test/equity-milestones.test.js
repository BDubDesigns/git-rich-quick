/**
 * Tests for issue #220 (Slice 8 of the #210 game-feel pass): Equity
 * milestones. When claimableEquity rises (a new point becomes
 * sellable) a light sweep crosses the Equity strip once (700ms) and
 * the "+N Equity" text does a Slice 2 bump; reaching or crossing 1, 5,
 * 10, 25, 50 or 100 claimable makes the sweep gold and doubled (1.4s).
 * A jump of several points in one step fires ONCE. Presentation only:
 * the strip keeps reading the shared helpers.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claimableEquity, equityThresholdLoc } from "../../shared/game-balance.js";
import {
  EQUITY_MILESTONES,
  EQUITY_MILESTONE_SWEEP_MS,
  EQUITY_SWEEP_MS,
  claimableOf,
  crossesMilestone,
  nextEquityGain,
  splitStripText,
} from "../../client/src/utils/equitySweep.js";
import { equityStripModel } from "../../client/src/utils/equityStrip.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/EquitySweep.css");

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
/** A reducer-shaped state at `loc` lifetime LOC with `earned` Equity claimed. */
const at = (loc, earned = 0, equityGain = null) => ({ totalLinesOfCode: loc, lifetimeEquityEarned: earned, equityGain });

test("the Commit float's behavior is unchanged: its files have no diff", () => {
  assertCommitFloatLocked();
});

test("trigger: claimable Equity rising records one gain per step; the Equity math is the shared helper", () => {
  const t4 = equityThresholdLoc(4);
  const before = at(t4 - 150);
  const after = at(t4 + 121);
  assert.equal(claimableOf(before), 3);
  assert.equal(claimableOf(after), 4);
  assert.equal(claimableOf(after), claimableEquity(after.totalLinesOfCode, 0), "the shared helper");
  const gain = nextEquityGain(before, after, "GAME_TICK", 1000);
  assert.deepEqual(gain, { seq: 1, from: 3, to: 4, milestone: false, atMs: 1000 });
  // A tick that stays inside the same point: nothing new.
  assert.equal(nextEquityGain(at(t4 - 300), at(t4 - 150), "GAME_TICK", 1000), null);
  // No LOC or Equity change at all (a UI action): the record stands.
  const kept = at(t4, 0, gain);
  assert.equal(nextEquityGain(kept, { ...kept }, "SET_ACTIVE_TAB", 2000), gain);
});

test("a jump of several points in one step fires once, not per point", () => {
  const before = at(equityThresholdLoc(2) - 10);
  const after = at(equityThresholdLoc(9) + 10);
  const gain = nextEquityGain(before, after, "APPLY_STAR_REWARD", 1000);
  assert.equal(gain.seq, 1, "one record");
  assert.equal(gain.from, 1);
  assert.equal(gain.to, 9);
  assert.equal(gain.milestone, true, "it crossed 5");
  // The next step's record is the next seq: one sweep per step.
  const again = nextEquityGain({ ...after, equityGain: gain }, at(equityThresholdLoc(10) + 1, 0, gain), "GAME_TICK", 2000);
  assert.equal(again.seq, 2);
  assert.equal(again.milestone, true, "10 is a milestone");
});

test("never: a restore (load, revert, the sale's reset) or a decrease", () => {
  const big = at(equityThresholdLoc(20));
  assert.equal(nextEquityGain(at(0), big, "RESTORE_SAVE", 1000), null, "the numbers appearing is not a gain");
  // A sale claims the Equity (claimable falls to 0): no sweep.
  const sold = { ...big, lifetimeEquityEarned: 20 };
  assert.equal(nextEquityGain(big, sold, "GAME_TICK", 1000), null);
  // The reducer: every action through withEquityGain, after the #214 detector.
  const context = src("context/GameContext.jsx");
  assert.match(context, /const next = withStatGain\(state, gameReducer\(state, action\), action\);\s*\/\/ Equity milestones \(issue #220\)[^\n]*\n\s*const swept = withEquityGain\(state, next, action\);/);
  assert.match(context, /const equityGain = nextEquityGain\(prev, next, action\.type, Date\.now\(\)\);/);
  assert.ok(!src("save/serialize.js").includes("equityGain"), "never saved");
});

test("milestones: 1, 5, 10, 25, 50, 100, reached or crossed", () => {
  assert.deepEqual([...EQUITY_MILESTONES], [1, 5, 10, 25, 50, 100]);
  for (const m of EQUITY_MILESTONES) {
    assert.equal(crossesMilestone(m - 1, m), true, `reaching ${m}`);
  }
  assert.equal(crossesMilestone(3, 4), false);
  assert.equal(crossesMilestone(5, 6), false, "leaving a milestone is not one");
  assert.equal(crossesMilestone(20, 30), true, "crossing 25 in a jump");
  assert.equal(crossesMilestone(100, 140), false, "past the last milestone");
  assert.equal(crossesMilestone(0, 1), true, "the first point");
});

test("the look: a 700ms light sweep, gold and doubled (1.4s) at a milestone, and the +N Equity bump", () => {
  assert.equal(EQUITY_SWEEP_MS, 700);
  assert.equal(EQUITY_MILESTONE_SWEEP_MS, 1400);
  const sweep = rule(".equity-sweep");
  for (const decl of ["inset: 0;", "background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent);", "pointer-events: none;", "transform: translateX(-100%);", "animation: equity-sweep 700ms cubic-bezier(0.16, 1, 0.3, 1) 1 forwards;"]) {
    assert.ok(sweep.includes(decl), decl);
  }
  const milestone = rule(".equity-sweep--milestone");
  assert.ok(milestone.includes("background: linear-gradient(90deg, transparent, rgba(250, 204, 21, 0.6), transparent);"));
  assert.ok(milestone.includes("animation-iteration-count: 2;"), "two passes, 2 x 700ms = 1.4s");
  assert.match(keyframes("equity-sweep"), /0% \{\s*transform: translateX\(-100%\);[\s\S]*100% \{\s*transform: translateX\(100%\);/);
  // The strip: the sweep inside its clipped box, the lead bumped (Slice 2, gold).
  const strip = src("components/EquityProgressStrip.jsx");
  assert.match(strip, /const sweep = useEquitySweep\(state\.equityGain\);/);
  assert.match(strip, /className=\{`equity-sweep\$\{sweep\.milestone \? " equity-sweep--milestone" : ""\}`\}/);
  assert.match(strip, /className=\{sweep \? "stat-value stat-bump stat-bump--money" : undefined\}\s*data-value=\{lead\}/);
  assert.match(src("index.css"), /\.progress-strip \{\s*position: relative;[\s\S]*?overflow: hidden;/);
  // The text is the shared model's, split only for the bump.
  const model = equityStripModel(equityThresholdLoc(4) + 5, 0, 100);
  const { lead, rest } = splitStripText(model.text);
  assert.equal(lead, "+4 Equity");
  assert.equal(lead + rest, model.text);
  assert.deepEqual(splitStripText("Next +1 Equity: 40% · 6M LOC, 1m"), { lead: null, rest: "Next +1 Equity: 40% · 6M LOC, 1m" });
  assert.match(strip, /<>\{strip\.text\}<\/>/);
});

test("never on mount: a load or the strip turned back on does not sweep", () => {
  const hook = src("hooks/useEquitySweep.js");
  assert.match(hook, /const \[sweep, setSweep\] = useState\(null\);/);
  assert.match(hook, /if \(!gain \|\| gain\.seq === seenSeq\.current\) return;/);
});

test("shared rules: transform and opacity only, pointer-events none, inside the strip", () => {
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) {
    for (const prop of m[2].matchAll(/([a-z-]+):/g)) {
      assert.ok(["transform", "opacity"].includes(prop[1]), `${m[1]} animates ${prop[1]}`);
    }
  }
  assert.ok(!/z-index|transition/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
});

test("reduced motion: no sweep across; the light shows in place for 700ms, 1.4s at a milestone", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
  assert.match(reduced, /\.equity-sweep \{\s*transform: none;\s*animation: equity-sweep-still 700ms steps\(1, end\) forwards;/);
  assert.match(reduced, /\.equity-sweep--milestone \{\s*animation-duration: 1400ms;\s*animation-iteration-count: 1;/);
  assert.ok(!/transform/.test(keyframes("equity-sweep-still")));
});

test("no dashes in the new copy", () => {
  for (const file of [css, src("utils/equitySweep.js"), src("hooks/useEquitySweep.js")]) assert.ok(!/[—–]/.test(file));
});
