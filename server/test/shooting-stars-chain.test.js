/**
 * Tests for Shooting Stars as a Cookie Chain (issue #138).
 *
 * Clicking a Shooting Stars star is chain click 1 and pays 7x LOC/s;
 * each next chain click pays 10x the previous plus 7x LOC/s (7, 77,
 * 777, 7777). The chain ends when a chain star is missed (UI timer),
 * the next payout would exceed 6 hours of production or half the LOC on
 * hand, or on a 1% roll. Always good. One email per chain, when it
 * ends; no per-click Shooting Stars mail. Rarity unchanged (L5, weight 5).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  STAR_CONFIG,
  buildShootingStarsChainEmail,
  initialSaveState,
  resolveStarClaim,
  shootingStarsChainClaim,
  shootingStarsChainContinues,
  shootingStarsChainMultiple,
  shootingStarsChainPayout,
  starEffectName,
  starRewardDetail,
} from "../../shared/game-balance.js";
import { collectTriggerEmails } from "../../client/src/email/email.js";
import { saveStateToGameFields } from "../../client/src/save/serialize.js";

const never = () => 0.99; // never the 1% random end

test("rarity and name stay: Constellation L5, weight 5, Shooting Stars", () => {
  assert.equal(STAR_CONFIG.effects.shootingStars.unlockLevel, 5);
  assert.equal(STAR_CONFIG.effects.shootingStars.weight, 5);
  assert.equal(starEffectName("shootingStars", true), "Shooting Stars");
});

test("the chain config matches the issue", () => {
  assert.deepEqual({ ...STAR_CONFIG.shootingStarsChain }, {
    startLocPerSecondMultiple: 7,
    growthFactor: 10,
    stepLocPerSecondMultiple: 7,
    spawnDelaySeconds: 3,
    lifetimeSeconds: 6,
    capHoursOfProduction: 6,
    capBankFraction: 0.5,
    randomEndChance: 0.01,
  });
  assert.equal(STAR_CONFIG.shootingStarsCount, undefined, "the 5-Lucky burst is gone");
});

test("payout ladder: 7x, 77x, 777x, 7777x LOC/s", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(shootingStarsChainMultiple), [7, 77, 777, 7777, 77777]);
  assert.equal(shootingStarsChainMultiple(0), 0);
  assert.equal(shootingStarsChainPayout(3, 100), 77_700);
  assert.equal(shootingStarsChainPayout(1, 2.5), 17);
  assert.equal(shootingStarsChainPayout(2, Number.NaN), 0);
  assert.equal(shootingStarsChainPayout(2, -10), 0);
});

test("the Shooting Stars star is chain click 1: always good, LOC only, no Lucky rolls", () => {
  for (const good of [true, false]) {
    const claim = resolveStarClaim({
      effect: "shootingStars",
      good,
      locPerSecond: 100,
      money: 1_000_000,
      linesOfCode: 0,
      employeeCounts: {},
      rng: () => 0.5,
    });
    assert.equal(claim.good, true);
    assert.equal(claim.locDelta, 700);
    assert.equal(claim.moneyDelta, 0);
    assert.equal(claim.chainStep, 1);
  }
  assert.deepEqual(shootingStarsChainClaim(3, 10), {
    effect: "shootingStars",
    good: true,
    locDelta: 7770,
    moneyDelta: 0,
    multiplier: null,
    durationSeconds: null,
    employeeType: null,
    chainStep: 3,
  });
});

test("the 6-hour cap ends a chain after about 4 clicks with a deep bank", () => {
  const rate = 100;
  const bank = 1e15;
  for (const step of [1, 2, 3]) {
    const v = shootingStarsChainContinues({ step, locPerSecond: rate, linesOfCode: bank, rng: never });
    assert.equal(v.continues, true, `step ${step}`);
  }
  // Next would be 77777x > 21600x (6 hours).
  const v = shootingStarsChainContinues({ step: 4, locPerSecond: rate, linesOfCode: bank, rng: never });
  assert.deepEqual(v, { continues: false, reason: "cap", nextPayout: 7_777_700 });
});

test("the chain ends when the next payout would exceed half the LOC on hand", () => {
  // Next (step 2) pays 77 x 100 = 7,700; half of 15,000 is 7,500.
  assert.equal(
    shootingStarsChainContinues({ step: 1, locPerSecond: 100, linesOfCode: 15_000, rng: never }).reason,
    "bank"
  );
  assert.equal(
    shootingStarsChainContinues({ step: 1, locPerSecond: 100, linesOfCode: 15_400, rng: never }).continues,
    true
  );
});

test("the 1% random end, and no production ends the chain", () => {
  const lucky = shootingStarsChainContinues({ step: 1, locPerSecond: 100, linesOfCode: 1e12, rng: () => 0.005 });
  assert.deepEqual(lucky, { continues: false, reason: "luck", nextPayout: 7700 });
  assert.equal(
    shootingStarsChainContinues({ step: 1, locPerSecond: 0, linesOfCode: 1e12, rng: never }).continues,
    false
  );
  assert.equal(
    shootingStarsChainContinues({ step: 1, locPerSecond: Number.NaN, linesOfCode: 1e12, rng: never }).continues,
    false
  );
});

test("the 1% roll comes after the caps, so a capped chain never consumes it", () => {
  let rolled = false;
  shootingStarsChainContinues({ step: 4, locPerSecond: 100, linesOfCode: 1e15, rng: () => { rolled = true; return 0.99; } });
  assert.equal(rolled, false);
});

test("per-click floating text: 'Shooting Stars! +777 LOC (chain x3)'", () => {
  const claim = shootingStarsChainClaim(3, 1);
  assert.equal(`${starEffectName(claim.effect, claim.good)}! ${starRewardDetail(claim)}`, "Shooting Stars! +777 LOC (chain x3)");
});

test("a chain click never mails; other star effects still do", () => {
  const base = saveStateToGameFields(initialSaveState());
  const chainClick = collectTriggerEmails(base, base, shootingStarsChainClaim(2, 10));
  assert.equal(chainClick.emails.length, 0);
  const frenzy = collectTriggerEmails(base, base, {
    effect: "frenzy", good: true, locDelta: 0, moneyDelta: 0,
    multiplier: 3, durationSeconds: 60, employeeType: null, claimId: "x",
  });
  assert.equal(frenzy.emails.length, 1);
});

test("the chain-end email summarizes the whole chain", () => {
  const mail = buildShootingStarsChainEmail({ stars: 4, totalLoc: 8638, reason: "cap" });
  assert.equal(mail.subject, "Shooting Stars chain: 4 stars, +8.64K LOC");
  assert.match(mail.body, /4 shooting stars in a row/);
  assert.equal(
    buildShootingStarsChainEmail({ stars: 1, totalLoc: 7, reason: "missed" }).subject,
    "Shooting Stars chain: 1 star, +7 LOC"
  );
  for (const reason of ["missed", "cap", "bank", "luck", "unknown"]) {
    const m = buildShootingStarsChainEmail({ stars: 2, totalLoc: 84, reason });
    for (const text of [m.sender, m.subject, m.body]) assert.ok(!text.includes("—"), reason);
  }
});
