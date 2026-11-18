/**
 * Tests for the click track (issue #160, re-derived from #151).
 *
 * The invariant (Brandon's, from #151): a player who buys every click
 * upgrade affordable in a few minutes of passive has click output at
 * 10 clicks/s roughly equal to passive LOC/s, at every stage. Before
 * #160 Brandon's live save (533 LOC/s passive, OverReact L9 at 128x, 5
 * Commit Specialists) clicked at 4.80x passive, and the √2 Commitment
 * Issues step let click outrun passive by orders of magnitude.
 *
 * - OverReact: 10 levels, whole click multipliers 2, 3, 4, 5, 7, 10,
 *   14, 20, 28, 40 (about 1.4x per level); costs from L3 on climb in
 *   step with the power.
 * - Commitment Issues: 20 levels, 2x power each, every cost step at
 *   or above 2x (no runaway).
 * - Commit Specialist ($4,000 at 1.1x) and the passive tracks are
 *   unchanged.
 * - The invariant is pinned at representative stages by the same
 *   stage model the numbers were derived from.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  BALANCE,
  COMMITMENT_ISSUES_LEVELS,
  DOUBLING_PROJECT_IDS,
  bestCentsPerLoc,
  clickBonus,
  doublingMultiplier,
  employeeCost,
  locPerClick,
  openSourceLevelCosts,
} from "../../shared/game-balance.js";

const overReactLevels = BALANCE.openSource.overReactFramework.levels;
const ciLevels = BALANCE.openSource.commitmentIssues.levels;
const multiplierAt = (level) => 1 + clickBonus({ overReactFramework: level });

test("OverReact: 10 levels, a smooth climb to 40x, whole multipliers", () => {
  assert.equal(overReactLevels.length, 10);
  const multipliers = Array.from({ length: 10 }, (_, i) => multiplierAt(i + 1));
  assert.deepEqual(multipliers, [2, 3, 4, 5, 7, 10, 14, 20, 28, 40]);
  let previous = 1;
  for (const m of multipliers) {
    assert.ok(Number.isInteger(m), `${m} is whole`);
    assert.ok(m / previous >= 1.25 && m / previous <= 2, `${previous} -> ${m}`);
    previous = m;
  }
  for (const level of overReactLevels) {
    assert.equal(level.bonus.type, "CLICK_BOOST");
    assert.ok(Number.isInteger(level.bonus.value) && level.bonus.value > 0);
  }
});

test("OverReact: costs, with L1 and L2 kept as the cheap bootstrap and the rest in step with the power", () => {
  const costs = overReactLevels.map((l) => l.locCost);
  assert.deepEqual(costs, [100, 500, 4900, 6100, 8500, 12000, 17000, 24000, 34000, 49000]);
  assert.equal(openSourceLevelCosts("overReactFramework", 0, 10), 156_100);
  // From L3 on, each cost step is within 15% of the power step: clicking
  // alone buys each next level in about the same time as the last,
  // never faster and faster.
  for (let i = 3; i < costs.length; i += 1) {
    const costStep = costs[i] / costs[i - 1];
    const powerStep = multiplierAt(i + 1) / multiplierAt(i);
    assert.ok(Math.abs(costStep / powerStep - 1) <= 0.15, `L${i + 1}: cost ${costStep.toFixed(2)} vs power ${powerStep.toFixed(2)}`);
  }
});

test("Commitment Issues: 20 levels, 2x power each, every cost step at least 2x", () => {
  assert.equal(ciLevels.length, 20);
  assert.equal(COMMITMENT_ISSUES_LEVELS.count, 20);
  const costs = ciLevels.map((l) => l.locCost);
  assert.deepEqual(costs, [...COMMITMENT_ISSUES_LEVELS.costs]);
  assert.equal(costs[0], 460_000);
  assert.equal(costs.at(-1), 1_800_000_000_000);
  for (const level of ciLevels) {
    assert.deepEqual({ ...level.bonus }, { type: "DOUBLE", value: 2 });
  }
  for (let l = 1; l <= 20; l += 1) {
    assert.equal(
      doublingMultiplier("commitSpecialist", { commitmentIssues: l }) /
        doublingMultiplier("commitSpecialist", { commitmentIssues: l - 1 }),
      2
    );
  }
  // The no-runaway rule: cost never steps slower than the 2x power.
  for (let i = 1; i < costs.length; i += 1) {
    assert.ok(costs[i] / costs[i - 1] >= 2, `L${i + 1} step ${(costs[i] / costs[i - 1]).toFixed(2)}`);
    assert.ok(Number.isSafeInteger(costs[i]));
  }
});

test("Commit Specialist stays $4,000 at 1.1x, +0.2 LOC per click, same unlock", () => {
  const cs = BALANCE.employees.commitSpecialist;
  assert.equal(cs.baseCost, 400000);
  assert.equal(cs.costMultiplier, 1.1);
  assert.equal(cs.clickBonusPerEmployee, 0.2);
  assert.deepEqual(
    cs.unlockConditions.map((c) => ({ ...c })),
    [
      { type: "TOTAL_LOC", target: 25000 },
      { type: "TOTAL_EMPLOYEE_COUNT", target: 20 },
    ]
  );
});

test("click track only: the five passive doubling tracks keep 10 levels at 2x cost", () => {
  const bases = {
    coffeeScript: 100000,
    juniorAchievement: 250000,
    seniorMoment: 500000,
    scrumMaster: 1000000,
    shipHappens: 2000000,
  };
  for (const id of DOUBLING_PROJECT_IDS.filter((x) => x !== "commitmentIssues")) {
    const levels = BALANCE.openSource[id].levels;
    assert.equal(levels.length, 10, id);
    levels.forEach((level, i) => {
      assert.equal(level.locCost, bases[id] * 2 ** i, `${id} L${i + 1}`);
      assert.deepEqual({ ...level.bonus }, { type: "DOUBLE", value: 2 });
    });
  }
  assert.deepEqual(
    BALANCE.openSource.blocker.levels.map((l) => l.bonus.value),
    [0.5, 1, 1.5, 2, 2.5]
  );
});

// --- The invariant, pinned ---

/** "A few minutes of passive": 3 minutes. */
const T_SECONDS = 180;
/** Cash per Commit Specialist hire, in seconds of production value (B =
 *  P x 60 cents/s), calibrated to Brandon's Nov 18 live save: 5
 *  Specialists at 533 LOC/s. */
const TC_SECONDS = 18.5;

/**
 * The stage model the numbers were derived from: at passive P (healthy
 * rates; the Founder, achievement, and Handbook multipliers apply to
 * click and passive alike, so they cancel in the ratio), the player owns
 * every click level costing at most T x P, and every Commit Specialist
 * whose hire costs at most TC x B. Commitment Issues needs 10
 * Specialists. Returns click LOC/s at 10 clicks/s over P.
 */
function stage(P) {
  let specialists = 0;
  while (employeeCost("commitSpecialist", specialists) <= TC_SECONDS * P * bestCentsPerLoc()) {
    specialists += 1;
  }
  const affordable = (levels) => {
    let n = 0;
    while (n < levels.length && levels[n].locCost <= T_SECONDS * P) n += 1;
    return n;
  };
  const overReact = affordable(overReactLevels);
  const commitment = specialists >= 10 ? affordable(ciLevels) : 0;
  const click = locPerClick(
    { overReactFramework: overReact, commitmentIssues: commitment },
    { commitSpecialist: specialists }
  );
  return { specialists, overReact, commitment, ratio: (10 * click) / P };
}

test("the stage model reproduces Brandon's live save: 5 Specialists at 533 LOC/s", () => {
  assert.equal(stage(533).specialists, 5);
  // His save before #160: OverReact L9 at 128x and 5 Specialists clicked
  // floor((1 + 1) x 128) = 256, 2,560 LOC/s at 10 clicks/s: 4.80x.
  assert.equal((10 * Math.floor((1 + 0.2 * 5) * 128)) / 533 > 4.79, true);
});

test("invariant: click at 10 clicks/s roughly matches passive (0.5x to 2x) at every stage", () => {
  const stages = [20, 50, 100, 200, 533, 1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6, 1e7, 1e8, 1e9, 1e10];
  for (const P of stages) {
    const s = stage(P);
    assert.ok(s.ratio >= 0.5 && s.ratio <= 2, `P ${P}: ratio ${s.ratio.toFixed(2)} (OR L${s.overReact}, CI L${s.commitment}, ${s.specialists} CS)`);
  }
  // And on a fine log grid from 20 LOC/s to 10 billion, no stage breaks it.
  for (let e = Math.log10(20); e <= 10; e += 0.05) {
    const s = stage(10 ** e);
    assert.ok(s.ratio >= 0.5 && s.ratio <= 2, `P ${(10 ** e).toPrecision(3)}: ${s.ratio.toFixed(2)}`);
  }
});

test("invariant: Brandon's stage now clicks at about 1.5x passive, not 4.8x", () => {
  const s = stage(533);
  assert.equal(s.overReact, 10);
  assert.equal(s.commitment, 0);
  assert.ok(s.ratio <= 1.6, s.ratio.toFixed(2));
});

test("a full click build: 25 Commit Specialists, OverReact 10, Commitment Issues 20; no NaN", () => {
  // floor((1 + 0.2 x 25 x 2^20) x 40)
  assert.equal(
    locPerClick({ overReactFramework: 10, commitmentIssues: 20 }, { commitSpecialist: 25 }),
    Math.floor((1 + 0.2 * 25 * 2 ** 20) * 40 + 1e-9)
  );
  assert.equal(locPerClick({}, {}), 1);
  assert.equal(locPerClick({ overReactFramework: 10 }, undefined), 40);
  assert.equal(locPerClick({ overReactFramework: 10 }, { commitSpecialist: Number.NaN }), 40);
});
