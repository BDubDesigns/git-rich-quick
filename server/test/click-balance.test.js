/**
 * Tests for the click balance pass (issue #151): cheaper Commit
 * Specialists and more granular click doubling levels.
 *
 * - Commit Specialist: $4,000 base at 1.1x per hire (was $5,000 at
 *   1.2x); the +0.2 LOC per click and the unlock are unchanged.
 * - Commitment Issues: 20 levels, each still doubling the Commit
 *   Specialist bonus (2x power per level, never less), with the cost
 *   stepping by sqrt(2) so a new level sits between each old pair.
 * - OverReact: 9 levels, the old five costs kept and one new level
 *   between each pair; every level is a real click boost and the top
 *   click multiplier is 128x (was 32x).
 * - Click track only: the five passive doubling tracks do not change.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  BALANCE,
  COMMITMENT_ISSUES_LEVELS,
  DOUBLING_PROJECT_IDS,
  clickBonus,
  doublingMultiplier,
  locPerClick,
  openSourceLevelCosts,
} from "../../shared/game-balance.js";

const overReactLevels = BALANCE.openSource.overReactFramework.levels;
const multiplierAt = (level) =>
  1 + clickBonus({ overReactFramework: level });

test("OverReact: 9 levels, the old five costs kept, a new level between each pair", () => {
  assert.deepEqual(
    overReactLevels.map((l) => l.locCost),
    [100, 250, 500, 1200, 3000, 7000, 15000, 35000, 75000]
  );
  for (const old of [100, 500, 3000, 15000, 75000]) {
    assert.ok(overReactLevels.some((l) => l.locCost === old), `${old} kept`);
  }
  for (const level of overReactLevels) {
    assert.equal(level.bonus.type, "CLICK_BOOST");
    assert.ok(Number.isInteger(level.bonus.value) && level.bonus.value > 0);
  }
});

test("OverReact: every level is a real boost (1.5x to 2x) and the top is 128x", () => {
  const multipliers = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(multiplierAt);
  assert.deepEqual(multipliers, [2, 3, 5, 8, 12, 20, 32, 64, 128]);
  let previous = 1;
  for (const m of multipliers) {
    assert.ok(m / previous >= 1.5 && m / previous <= 2, `${previous} -> ${m}`);
    previous = m;
  }
  // The top CLICK_BOOST sum is above the old 31, on purpose.
  assert.equal(clickBonus({ overReactFramework: 9 }), 127);
});

test("OverReact: at every old cost the click is at least as strong as before", () => {
  // Old: 100 -> 2x, 500 -> 4x, 3,000 -> 8x, 15,000 -> 16x, 75,000 -> 32x.
  const old = { 100: 2, 500: 4, 3000: 8, 15000: 16, 75000: 32 };
  for (const [cost, oldMultiplier] of Object.entries(old)) {
    const level = overReactLevels.findIndex((l) => l.locCost === Number(cost)) + 1;
    assert.ok(multiplierAt(level) >= oldMultiplier, `at ${cost} LOC`);
  }
});

test("Commitment Issues: 2x power at every one of its 20 levels", () => {
  const levels = BALANCE.openSource.commitmentIssues.levels;
  assert.equal(levels.length, COMMITMENT_ISSUES_LEVELS.count);
  assert.equal(levels.length, 20);
  for (const level of levels) {
    assert.deepEqual({ ...level.bonus }, { type: "DOUBLE", value: 2 });
  }
  for (let l = 1; l <= 20; l += 1) {
    assert.equal(
      doublingMultiplier("commitSpecialist", { commitmentIssues: l }) /
        doublingMultiplier("commitSpecialist", { commitmentIssues: l - 1 }),
      2
    );
  }
  // The top multiplier is above the old 1024x, on purpose.
  assert.equal(doublingMultiplier("commitSpecialist", { commitmentIssues: 20 }), 1048576);
});

test("Commitment Issues: cost grows slower than the power (about 1.41x vs 2x)", () => {
  const costs = BALANCE.openSource.commitmentIssues.levels.map((l) => l.locCost);
  assert.equal(costs[0], 1000000);
  assert.equal(costs.at(-1), 724080000);
  for (let i = 1; i < costs.length; i += 1) {
    assert.ok(costs[i] / costs[i - 1] < 2, `L${i + 1}`);
    assert.ok(Number.isInteger(costs[i]) && costs[i] % 10000 === 0, `L${i + 1} clean`);
  }
  // So each level is cheaper per doubling than the old track: the old
  // L10 (512M) is now L19, and L20 (724.08M) is the first new cost
  // above the old top.
  assert.equal(costs[18], 512000000);
  assert.equal(openSourceLevelCosts("commitmentIssues", 0, 20), 2469740000);
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
  // Blocker (the passive boost) is untouched too.
  assert.deepEqual(
    BALANCE.openSource.blocker.levels.map((l) => l.bonus.value),
    [0.5, 1, 1.5, 2, 2.5]
  );
});

test("a full click build: 25 Commit Specialists, OverReact 9, Commitment Issues 20", () => {
  // floor((1 + 0.2 x 25 x 2^20) x 128)
  assert.equal(
    locPerClick(
      { overReactFramework: 9, commitmentIssues: 20 },
      { commitSpecialist: 25 }
    ),
    Math.floor((1 + 0.2 * 25 * 2 ** 20) * 128 + 1e-9)
  );
  // Missing counts and levels read as 0, never NaN.
  assert.equal(locPerClick({}, {}), 1);
  assert.equal(locPerClick({ overReactFramework: 9 }, undefined), 128);
});
