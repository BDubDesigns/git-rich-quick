/**
 * Tests for the header Equity strip's sale-gain framing (issue #190).
 *
 * Brandon, Nov 19: "It's hard to see how many new points I'm gonna
 * earn. It shows my lifetime in the bar." The strip now leads with
 * claimableEquity ("+N Equity if you sell now"), with the distance to
 * the next point from equityProgress. The math is unchanged and comes
 * only from those shared helpers, the ones the Sell the Company panel
 * reads, so the two can never disagree.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  claimableEquity,
  equityProgress,
  equityThresholdLoc,
  formatEstimateDuration,
} from "../../shared/game-balance.js";
import { formatNumber } from "../../shared/formatNumber.js";
import { equityStripModel } from "../../client/src/utils/equityStrip.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

/** The strip's one line at phone width: 10px monospace on about 360px. */
const STRIP_MAX_CHARS = 55;

/** Every claim the strip makes, checked against the shared helpers. */
function assertMatchesHelpers(model, lifetime, earned, rate) {
  const progress = equityProgress(lifetime, rate);
  assert.equal(model.claimable, claimableEquity(lifetime, earned));
  assert.equal(model.fraction, progress.fraction);
  assert.equal(model.pct, Math.floor(progress.fraction * 100));
  assert.ok(model.text.includes(`${formatNumber(progress.remainingLoc)} LOC`), model.text);
  if (progress.seconds !== null) {
    assert.ok(model.text.includes(formatEstimateDuration(progress.seconds)), model.text);
  }
  for (const text of [model.text, model.label]) {
    assert.ok(!text.includes("—"), `no em dash: ${text}`);
    assert.ok(!text.includes("–"), `no en dash: ${text}`);
  }
  assert.ok(model.text.length <= STRIP_MAX_CHARS, `${model.text.length} chars: ${model.text}`);
  assert.match(model.label, /Tap to open Sell the Company in Settings\.$/);
}

test("claimable 0: progress to the first point of this run, in the gain framing", () => {
  // Second company: 7 Equity earned, lifetime just past 7^3 x 10M, nothing new yet.
  const earned = 7;
  const lifetime = equityThresholdLoc(7) + 400_000_000;
  const rate = 8_800_000;
  const model = equityStripModel(lifetime, earned, rate);
  assert.equal(model.claimable, 0);
  assertMatchesHelpers(model, lifetime, earned, rate);
  assert.match(model.text, /^Next \+1 Equity: \d+% · /);
  assert.ok(!model.text.includes("Equity 8"), "no lifetime point number");
  assert.match(model.label, /^Selling now earns no Equity yet\. The first point of this run is \d+% of the way there/);
});

test("claimable 1: leads with +1 Equity if you sell now, then the next point", () => {
  const earned = 7;
  const lifetime = equityThresholdLoc(8) + 1_000_000_000;
  const rate = 8_800_000;
  const model = equityStripModel(lifetime, earned, rate);
  assert.equal(model.claimable, 1);
  assertMatchesHelpers(model, lifetime, earned, rate);
  assert.match(model.text, /^\+1 Equity if you sell now · next .+ LOC, /);
  assert.match(model.label, /^Selling now earns 1 Equity\. The next point is \d+% of the way there/);
});

test("claimable 2 or more: the full gain, then the next point beyond it", () => {
  // A long case on purpose: three-digit gain, a 15-character LOC figure.
  // (at a late-game rate: the duration formatter has no days unit, so
  // an absurd 1 LOC/s would print millions of hours, as it always has).
  const wide = equityStripModel(equityThresholdLoc(130) + 1, 10, 50_000_000);
  assert.equal(wide.claimable, 120);
  assertMatchesHelpers(wide, equityThresholdLoc(130) + 1, 10, 50_000_000);
  for (const [earned, entitled] of [[0, 2], [7, 12], [12, 26], [50, 87]]) {
    const lifetime = equityThresholdLoc(entitled) + equityThresholdLoc(1) * 3;
    const rate = 1_000_000 * entitled;
    const model = equityStripModel(lifetime, earned, rate);
    assert.equal(model.claimable, entitled - earned, `${earned} -> ${entitled}`);
    assertMatchesHelpers(model, lifetime, earned, rate);
    assert.ok(model.text.startsWith(`+${entitled - earned} Equity if you sell now · `), model.text);
    assert.ok(model.label.startsWith(`Selling now earns ${entitled - earned} Equity.`), model.label);
  }
});

test("no production: the time reads needs production, the math is unchanged", () => {
  const model = equityStripModel(equityThresholdLoc(2) + 5, 0, 0);
  assert.equal(model.claimable, 2);
  assertMatchesHelpers(model, equityThresholdLoc(2) + 5, 0, 0);
  assert.match(model.text, /, no LOC\/s$/);
  assert.match(model.label, /it needs production to arrive/);
});

test("the strip and the Sell panel read the same shared helpers; no Equity math in the client", () => {
  const util = src("utils/equityStrip.js");
  assert.match(util, /claimableEquity\(lifetimeLoc, lifetimeEquityEarned\)/);
  assert.match(util, /equityProgress\(lifetimeLoc, healthyLocPerSec\)/);
  assert.ok(!/Math\.(cbrt|pow)|equityLocUnit|\*\* ?3/.test(util), "no duplicated Equity curve");
  const sell = src("components/SellCompany.jsx");
  assert.match(sell, /shared\.claimableEquity\(lifetimeLoc, lifetimeEquityEarned\)/);
  assert.match(sell, /shared\.equityProgress\(lifetimeLoc, healthyRate\)/);
  // Both use the same healthy rate.
  assert.match(sell, /const healthyRate = getBaseLocPerSecond\(state\)/);
  const strip = src("components/EquityProgressStrip.jsx");
  assert.match(strip, /equityStripModel\(\s*state\.totalLinesOfCode \?\? 0,\s*state\.lifetimeEquityEarned \?\? 0,\s*getBaseLocPerSecond\(state\)\s*\)/);
});

test("the strip keeps tap-to-Settings, the toggle and the bracket fill; the stale square-root comment is gone", () => {
  const strip = src("components/EquityProgressStrip.jsx");
  assert.match(strip, /useProgressBarEnabled\("equityStrip"\)/);
  assert.match(strip, /dispatch\(\{ type: "SET_ACTIVE_TAB", payload: \{ tab: "settings" \} \}\)/);
  assert.match(strip, /width: `\$\{strip\.fraction \* 100\}%`/);
  assert.match(strip, /aria-label=\{strip\.label\}/);
  assert.match(strip, /\{strip\.text\}/);
  assert.ok(!strip.includes("^2"), "no (n + 1)^2");
  assert.match(strip, /10,000,000 x\s*\*?\s*\(n \+ 1\)\^3/);
  assert.ok(!src("components/SellCompany.jsx").includes("(n+1)^2"));
});
