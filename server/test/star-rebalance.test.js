/**
 * Sprint / Overclock rebalance (Brandon, Nov 10): the single-type
 * Employee buff was super underpowered vs the buff-everything Frenzy
 * (2x one type vs 7x everything), so the ranges flipped — Sprint is
 * now a random integer 3-15x on one random type (the type stays
 * random), Overclock a random integer 2-5x on all production. The
 * global buff's range is lower than the single-type buff's because it
 * buffs everything. Bad outcomes are unchanged (0.5x).
 *
 * These tests pin the ROLLED ranges (via resolveStarClaim) and the
 * max relationship, not just the config shape.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  STAR_CONFIG,
  resolveStarClaim,
} from "../../shared/game-balance.js";

const baseArgs = {
  locPerSecond: 100,
  money: 100000,
  linesOfCode: 100000,
  employeeCounts: { intern: 5, junior: 2, senior: 1, projectManager: 0, commitSpecialist: 0 },
};

test("Overclock (Frenzy good) rolls an integer 2-5x", () => {
  // Boundary rng values: 0 -> min, ~1 -> max.
  const atMin = resolveStarClaim({
    ...baseArgs,
    effect: "frenzy",
    good: true,
    rng: () => 0,
  });
  assert.equal(atMin.multiplier, 2);
  assert.equal(atMin.durationSeconds, 60);
  const atMax = resolveStarClaim({
    ...baseArgs,
    effect: "frenzy",
    good: true,
    rng: () => 0.999999,
  });
  assert.equal(atMax.multiplier, 5);
  // A few hundred real rolls all land in range, as integers.
  for (let i = 0; i < 200; i += 1) {
    const claim = resolveStarClaim({
      ...baseArgs,
      effect: "frenzy",
      good: true,
    });
    assert.ok(Number.isInteger(claim.multiplier));
    assert.ok(claim.multiplier >= 2 && claim.multiplier <= 5);
  }
});

test("Sprint (Employee good) rolls an integer 3-15x on a random type", () => {
  // Boundary rng values: 0 -> min multiplier (and pool[0] type),
  // ~1 -> max multiplier (and the last pool type).
  const atMin = resolveStarClaim({
    ...baseArgs,
    effect: "employee",
    good: true,
    rng: () => 0,
  });
  assert.equal(atMin.multiplier, 3);
  assert.equal(atMin.durationSeconds, 60);
  assert.equal(atMin.employeeType, "intern");
  const atMax = resolveStarClaim({
    ...baseArgs,
    effect: "employee",
    good: true,
    rng: () => 0.999999,
  });
  assert.equal(atMax.multiplier, 15);
  assert.equal(atMax.employeeType, "senior");
  // A few hundred real rolls all land in range, as integers, on a
  // type the player owns (random, so every owned type shows up).
  const seenTypes = new Set();
  for (let i = 0; i < 200; i += 1) {
    const claim = resolveStarClaim({
      ...baseArgs,
      effect: "employee",
      good: true,
    });
    assert.ok(Number.isInteger(claim.multiplier));
    assert.ok(claim.multiplier >= 3 && claim.multiplier <= 15);
    seenTypes.add(claim.employeeType);
  }
  assert.deepEqual([...seenTypes].sort(), ["intern", "junior", "senior"]);
});

test("Overclock's max is below Sprint's max (global buff, lower range)", () => {
  assert.equal(STAR_CONFIG.frenzyMultiplier.good.min, 2);
  assert.equal(STAR_CONFIG.frenzyMultiplier.good.max, 5);
  assert.equal(STAR_CONFIG.employeeMultiplier.good.min, 3);
  assert.equal(STAR_CONFIG.employeeMultiplier.good.max, 15);
  assert.ok(
    STAR_CONFIG.frenzyMultiplier.good.max <
      STAR_CONFIG.employeeMultiplier.good.max
  );
  assert.ok(
    STAR_CONFIG.frenzyMultiplier.good.min <
      STAR_CONFIG.employeeMultiplier.good.min
  );
});

test("bad outcomes are still 0.5x (Throttling, Meeting)", () => {
  const throttling = resolveStarClaim({
    ...baseArgs,
    effect: "frenzy",
    good: false,
  });
  assert.equal(throttling.multiplier, 0.5);
  assert.equal(throttling.durationSeconds, 30);
  const meeting = resolveStarClaim({
    ...baseArgs,
    effect: "employee",
    good: false,
  });
  assert.equal(meeting.multiplier, 0.5);
  assert.equal(meeting.durationSeconds, 30);
});

test("Sprint/Meeting never rolls Release Manager (it scales nothing)", () => {
  // Release Manager produces 0 LOC/s and its ship timer is fixed,
  // so a Sprint (or Meeting) on it is a dud: a live bar, no card
  // tint, no effect. Brandon reported it with 7 RMs owned. The pool
  // is the owned types minus RM, so RM can never be picked.
  const withRm = {
    ...baseArgs,
    employeeCounts: {
      intern: 5,
      junior: 2,
      senior: 1,
      projectManager: 1,
      commitSpecialist: 1,
      releaseManager: 7,
    },
  };
  // Seeded rng sweeps every pool position (5 buffable types, so
  // 0 / 0.2 / 0.4 / 0.6 / 0.8 hit each index); good and bad both.
  const seenGood = new Set();
  const seenBad = new Set();
  for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.999999]) {
    const good = resolveStarClaim({
      ...withRm,
      effect: "employee",
      good: true,
      rng: () => value,
    });
    assert.notEqual(good.employeeType, "releaseManager");
    seenGood.add(good.employeeType);
    const bad = resolveStarClaim({
      ...withRm,
      effect: "employee",
      good: false,
      rng: () => value,
    });
    assert.notEqual(bad.employeeType, "releaseManager");
    seenBad.add(bad.employeeType);
  }
  assert.deepEqual(
    [...seenGood].sort(),
    ["commitSpecialist", "intern", "junior", "projectManager", "senior"]
  );
  assert.deepEqual(
    [...seenBad].sort(),
    ["commitSpecialist", "intern", "junior", "projectManager", "senior"]
  );
  // A few hundred real rolls with RM owned never land on it either.
  for (let i = 0; i < 200; i += 1) {
    const claim = resolveStarClaim({
      ...withRm,
      effect: "employee",
      good: true,
    });
    assert.notEqual(claim.employeeType, "releaseManager");
  }
});

test("Sprint with only Release Managers owned falls back, never crashes", () => {
  // RM unlock needs 100,000 TOTAL_LOC and 30 employees, so the pool
  // can never be RM-only in practice — but the fallback must still
  // return a buffable type instead of an empty pool or a crash.
  const rmOnly = {
    ...baseArgs,
    employeeCounts: {
      intern: 0,
      junior: 0,
      senior: 0,
      projectManager: 0,
      commitSpecialist: 0,
      releaseManager: 7,
    },
  };
  for (const value of [0, 0.5, 0.999999]) {
    const claim = resolveStarClaim({
      ...rmOnly,
      effect: "employee",
      good: true,
      rng: () => value,
    });
    assert.notEqual(claim.employeeType, "releaseManager");
    assert.ok(claim.employeeType);
    assert.equal(claim.multiplier, value === 0 ? 3 : value === 0.5 ? 9 : 15);
  }
  // No employees at all: the fallback pool is the non-RM types too.
  const noneOwned = {
    ...baseArgs,
    employeeCounts: {
      intern: 0,
      junior: 0,
      senior: 0,
      projectManager: 0,
      commitSpecialist: 0,
      releaseManager: 0,
    },
  };
  const claim = resolveStarClaim({
    ...noneOwned,
    effect: "employee",
    good: true,
    rng: () => 0.999999,
  });
  assert.notEqual(claim.employeeType, "releaseManager");
});
