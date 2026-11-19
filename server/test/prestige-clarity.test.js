/**
 * Tests for prestige page clarity (issue #131): the Founder boost per
 * Equity point and the player's total, read off the real curve, and
 * the progress to the next Equity point that both the Sell the Company
 * meter and the header strip read.
 *
 * Curve: Founder multiplier = 1 + 0.10 x P up to P = 50, then
 * 6 + 0.5 x log2(1 + (P - 50) / 50). Equity = floor(sqrt(lifetime LOC /
 * 1,000,000)); the next Equity lands at 1,000,000 x (P + 1)^2.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPLOYEE_TYPES,
  FOUNDER_BOOST_PER_EQUITY,
  FOUNDER_LINEAR_EQUITY_CAP,
  OPEN_SOURCE_IDS,
  buffedLocMultiplier,
  equityGoalVisible,
  equityProgress,
  equityThresholdLoc,
  formatBoostPercent,
  founderBoostPercent,
  founderMultiplier,
  founderNextEquityBoostPercent,
  locPerClick,
  locPerSecond,
  zeroAchievementsState,
} from "../../shared/game-balance.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("each Equity is +10% to all LOC up to 50", () => {
  assert.equal(FOUNDER_BOOST_PER_EQUITY, 0.1);
  assert.equal(FOUNDER_LINEAR_EQUITY_CAP, 50);
  for (let p = 0; p < 50; p += 1) {
    close(founderNextEquityBoostPercent(p), 10);
  }
});

test("the issue's example: 2 Equity is +20% (1.20x)", () => {
  close(founderBoostPercent(2), 20);
  assert.equal(formatBoostPercent(founderBoostPercent(2)), "+20%");
  assert.equal(founderMultiplier(2).toFixed(2), "1.20");
  assert.equal(formatBoostPercent(FOUNDER_BOOST_PER_EQUITY * 100), "+10%");
});

test("past 50 Equity the boost diminishes, honestly", () => {
  close(founderBoostPercent(50), 500);
  close(founderBoostPercent(100), 550);
  close(founderBoostPercent(200), 600);
  let previous = founderNextEquityBoostPercent(50);
  assert.ok(previous < 10);
  for (let p = 51; p <= 300; p += 1) {
    const next = founderNextEquityBoostPercent(p);
    assert.ok(next > 0 && next < previous, `P=${p}`);
    previous = next;
  }
});

test("the boost shown is exactly the multiplier production applies", () => {
  const counts = {};
  for (const type of EMPLOYEE_TYPES) counts[type] = 0;
  counts.intern = 1000;
  const levels = {};
  for (const id of OPEN_SOURCE_IDS) levels[id] = 0;
  for (const p of [0, 1, 2, 7, 25, 50, 60, 123]) {
    const mult = 1 + founderBoostPercent(p) / 100;
    close(mult, founderMultiplier(p));
    // With no achievements, production's permanent multiplier is the
    // Founder multiplier, for passive and for clicks.
    const state = { lifetimeEquityEarned: p, achievements: zeroAchievementsState() };
    close(buffedLocMultiplier(state), founderMultiplier(p));
    assert.equal(
      locPerSecond(counts, levels, buffedLocMultiplier(state)),
      Math.floor(1000 * founderMultiplier(p) + 1e-9)
    );
    assert.equal(
      locPerClick(levels, counts, 1, buffedLocMultiplier(state)),
      Math.floor(1 * founderMultiplier(p) + 1e-9)
    );
  }
});

test("NaN or negative Equity reads as 0 boost", () => {
  assert.equal(founderBoostPercent(Number.NaN), 0);
  assert.equal(founderBoostPercent(-4), 0);
  close(founderNextEquityBoostPercent(Number.NaN), 10);
});

test("formatBoostPercent keeps whole numbers whole and trims fractions", () => {
  assert.equal(formatBoostPercent(10), "+10%");
  assert.equal(formatBoostPercent(500), "+500%");
  assert.equal(formatBoostPercent(1.4285714), "+1.43%");
  assert.equal(formatBoostPercent(1.4), "+1.4%");
  assert.equal(formatBoostPercent(Number.NaN), "+0%");
});

test("equityProgress: the next Equity lands at 10M x (P + 1)^3 (issue #170)", () => {
  const p = equityProgress(15_000_000, 100);
  assert.equal(p.entitled, 1);
  assert.equal(p.nextEquity, 2);
  assert.equal(p.bracketLowLoc, 10_000_000);
  assert.equal(p.nextThresholdLoc, 80_000_000);
  assert.equal(p.remainingLoc, 65_000_000);
  close(p.fraction, 5 / 70);
  assert.equal(p.seconds, 650_000);
  for (let n = 0; n < 10; n += 1) {
    assert.equal(equityThresholdLoc(n + 1), 10_000_000 * (n + 1) ** 3);
  }
});

test("equityProgress: no production means no time estimate; NaN is guarded", () => {
  assert.equal(equityProgress(500_000, 0).seconds, null);
  const p = equityProgress(Number.NaN, Number.NaN);
  assert.equal(p.entitled, 0);
  assert.equal(p.fraction, 0);
  assert.equal(p.seconds, null);
  assert.equal(p.nextThresholdLoc, 10_000_000);
});

test("equityProgress rolls over to a fresh bracket exactly at the threshold", () => {
  const at = equityProgress(80_000_000, 10);
  assert.equal(at.entitled, 2);
  assert.equal(at.fraction, 0);
  assert.equal(at.nextThresholdLoc, 270_000_000);
});

test("the header strip shows at 10% of the first Equity, or with any Equity", () => {
  assert.equal(equityGoalVisible(0, 0), false);
  assert.equal(equityGoalVisible(999_999, 0), false);
  assert.equal(equityGoalVisible(1_000_000, 0), true);
  assert.equal(equityGoalVisible(0, 1), true);
  assert.equal(equityGoalVisible(Number.NaN, Number.NaN), false);
});
