/**
 * Tests for Moonshot, the red gamble star (issue #165).
 *
 * Pins the approved design:
 * - Golden stars are always good (goodChance 1.0).
 * - Moonshot (opt-in, 1 level, 20k LOC) unlocks at Constellation L1+
 *   and 25 lifetime gold star clicks; once owned, 1 in 4 natural stars
 *   spawns red.
 * - Every red star is 1 in 3 To the Moon (all production x25 for 15s,
 *   its own timed effect that stacks with Overclock) or 2 in 3 a crash
 *   into an unlocked softened bad effect (never Shooting Stars).
 * - Launch Pad (5 levels, StarBroker's ladder) unlocks on Moonshot,
 *   not on StarBroker, and buys red stars at 30x passive LOC/s.
 * - StarBroker and Launch Pad share one buy timer.
 * - The new state gets fresh defaults (no backfill) and resets on sale,
 *   except the lifetime gold star counter.
 * Pure function tests, no database.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSeedState } from "../src/validate.js";
import {
  BALANCE,
  MOONSHOT_CONFIG,
  OPEN_SOURCE_IDS,
  STAR_CONFIG,
  applyPrestigeSale,
  conditionMet,
  effectiveEmployeeMultiplier,
  initialSaveState,
  launchPadBuyCost,
  launchPadCooldownSeconds,
  moonshotCrashEffects,
  normalizeSaveState,
  openSourceUnlockConditionsMet,
  recordGoldStarClicks,
  resolveMoonshotClaim,
  rollStarGood,
  rollStarIsRed,
  sanitizeAchievementsState,
  starBrokerBuyCost,
  starBrokerCooldownSeconds,
  starBuffDurationSeconds,
  starBuyCooldownRemainingSeconds,
  starEffectName,
  starRewardDetail,
} from "../../shared/game-balance.js";

/** A deterministic rng that returns the given values in order, then repeats the last. */
function seq(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** A save-shaped state with the given Open Source levels and gold star count. */
function withProgress({ levels = {}, goldStars = 0 } = {}) {
  const state = initialSaveState();
  state.openSourceProjects = { ...state.openSourceProjects, ...levels };
  state.achievements = { ...state.achievements, goldStarsClicked: goldStars };
  return state;
}

// --- Golden stars ---

test("golden stars are always good", () => {
  assert.equal(STAR_CONFIG.goodChance, 1);
  for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
    assert.equal(rollStarGood(() => r), true);
  }
});

// --- The config pins the approved numbers ---

test("Moonshot config holds the approved numbers", () => {
  assert.equal(MOONSHOT_CONFIG.goldStarsToUnlock, 25);
  assert.equal(MOONSHOT_CONFIG.redStarChance, 0.25);
  assert.equal(MOONSHOT_CONFIG.jackpotChance, 1 / 3);
  assert.equal(MOONSHOT_CONFIG.jackpotMultiplier, 25);
  assert.equal(MOONSHOT_CONFIG.jackpotDurationSeconds, 15);
  assert.equal(MOONSHOT_CONFIG.jackpotName, "To the Moon");
  assert.equal(BALANCE.openSource.moonshot.levels.length, 1);
  assert.equal(BALANCE.openSource.moonshot.levels[0].locCost, 20000);
  assert.deepEqual(
    BALANCE.openSource.launchPad.levels.map((l) => l.locCost),
    BALANCE.openSource.starBroker.levels.map((l) => l.locCost)
  );
  assert.ok(OPEN_SOURCE_IDS.includes("moonshot"));
  assert.ok(OPEN_SOURCE_IDS.includes("launchPad"));
  // The jackpot can never stack with itself: it is shorter than the
  // shortest buy cooldown.
  assert.ok(
    MOONSHOT_CONFIG.jackpotDurationSeconds <
      Math.min(...MOONSHOT_CONFIG.launchPadCooldownSeconds)
  );
});

// --- Unlocks ---

test("Moonshot needs Constellation L1 AND 25 gold stars clicked", () => {
  assert.equal(openSourceUnlockConditionsMet("moonshot", withProgress()), false);
  assert.equal(
    openSourceUnlockConditionsMet(
      "moonshot",
      withProgress({ levels: { constellation: 1 }, goldStars: 24 })
    ),
    false
  );
  assert.equal(
    openSourceUnlockConditionsMet(
      "moonshot",
      withProgress({ levels: { constellation: 0 }, goldStars: 500 })
    ),
    false
  );
  assert.equal(
    openSourceUnlockConditionsMet(
      "moonshot",
      withProgress({ levels: { constellation: 1 }, goldStars: 25 })
    ),
    true
  );
});

test("Launch Pad needs Moonshot owned, not StarBroker", () => {
  assert.equal(
    openSourceUnlockConditionsMet(
      "launchPad",
      withProgress({ levels: { starBroker: 5 } })
    ),
    false
  );
  assert.equal(
    openSourceUnlockConditionsMet(
      "launchPad",
      withProgress({ levels: { moonshot: 1, starBroker: 0 } })
    ),
    true
  );
});

test("the new condition types default missing values to 0", () => {
  assert.equal(
    conditionMet({ type: "GOLD_STARS_CLICKED", target: 1 }, {}),
    false
  );
  assert.equal(
    conditionMet(
      { type: "GOLD_STARS_CLICKED", target: 1 },
      { achievements: { goldStarsClicked: NaN } }
    ),
    false
  );
  assert.equal(
    conditionMet(
      { type: "OPEN_SOURCE_LEVEL", projectId: "moonshot", target: 1 },
      { openSourceProjects: {} }
    ),
    false
  );
});

// --- Red star spawn ---

test("natural stars are never red before Moonshot is owned", () => {
  for (const r of [0, 0.1, 0.24]) {
    assert.equal(rollStarIsRed(0, () => r), false);
  }
});

test("once Moonshot is owned, 1 in 4 natural stars is red", () => {
  assert.equal(rollStarIsRed(1, () => 0), true);
  assert.equal(rollStarIsRed(1, () => 0.2499), true);
  assert.equal(rollStarIsRed(1, () => 0.25), false);
  assert.equal(rollStarIsRed(1, () => 0.9), false);
});

// --- Red star outcome ---

test("a red star rolls To the Moon 1 in 3: x25 production for 15s", () => {
  const claim = resolveMoonshotClaim({
    constellationLevel: 5,
    locPerSecond: 100,
    money: 1000,
    linesOfCode: 5000,
    employeeCounts: { intern: 3 },
    rng: () => 0.3,
  });
  assert.deepEqual(claim, {
    effect: "moonshot",
    good: true,
    locDelta: 0,
    moneyDelta: 0,
    multiplier: 25,
    durationSeconds: 15,
    employeeType: null,
    red: true,
  });
  assert.equal(starEffectName("moonshot", true), "To the Moon");
  assert.equal(starRewardDetail(claim), "Production 25x for 15s");
  assert.equal(starBuffDurationSeconds("moonshot", true), 15);
});

test("a red star crashes 2 in 3 into a softened bad effect", () => {
  // First roll 0.34 misses the jackpot; the rest pick and resolve.
  const claim = resolveMoonshotClaim({
    constellationLevel: 5,
    locPerSecond: 100,
    money: 1000,
    linesOfCode: 5000,
    employeeCounts: { intern: 3 },
    rng: seq(0.34, 0.5, 0.5, 0.5),
  });
  assert.equal(claim.good, false);
  assert.equal(claim.red, true);
  assert.notEqual(claim.effect, "moonshot");
  assert.notEqual(claim.effect, "shootingStars");
  if (claim.multiplier !== null) assert.equal(claim.multiplier, 0.5);
});

test("a crash never rolls Shooting Stars, and at L1 it is always Rug Pull", () => {
  assert.deepEqual(moonshotCrashEffects(5).sort(), [
    "click",
    "employee",
    "frenzy",
    "lucky",
  ]);
  assert.deepEqual(moonshotCrashEffects(1), ["lucky"]);
  for (let i = 0; i < 50; i++) {
    const pick = (i + 0.5) / 50;
    const claim = resolveMoonshotClaim({
      constellationLevel: 5,
      locPerSecond: 100,
      money: 1000,
      linesOfCode: 5000,
      employeeCounts: { intern: 1 },
      rng: seq(0.9, pick, 0.5, 0.5),
    });
    assert.notEqual(claim.effect, "shootingStars");
    assert.equal(claim.good, false);
  }
  const l1 = resolveMoonshotClaim({
    constellationLevel: 1,
    locPerSecond: 100,
    money: 1000,
    linesOfCode: 5000,
    employeeCounts: {},
    rng: seq(0.9, 0.99, 0.2, 0.5),
  });
  assert.equal(l1.effect, "lucky");
  assert.equal(starEffectName(l1.effect, l1.good), "Rug Pull");
  assert.ok(l1.locDelta <= 0 && l1.moneyDelta <= 0);
});

test("a crash with NaN inputs never produces NaN deltas", () => {
  const claim = resolveMoonshotClaim({
    constellationLevel: 1,
    locPerSecond: NaN,
    money: NaN,
    linesOfCode: NaN,
    employeeCounts: undefined,
    rng: seq(0.9, 0.5, 0.2, 0.5),
  });
  assert.equal(Number.isNaN(claim.locDelta), false);
  assert.equal(Number.isNaN(claim.moneyDelta), false);
});

test("To the Moon stacks multiplicatively with a live Overclock", () => {
  const now = 1_000_000;
  const effects = [
    { effect: "frenzy", multiplier: 5, expiresAtMs: now + 60_000, employeeType: null },
    { effect: "moonshot", multiplier: 25, expiresAtMs: now + 15_000, employeeType: null },
  ];
  assert.equal(effectiveEmployeeMultiplier(effects, "intern", now), 125);
  // Expired, it no longer counts.
  assert.equal(
    effectiveEmployeeMultiplier(effects, "intern", now + 20_000),
    5
  );
});

// --- Cost, cooldown, shared timer ---

test("a red star costs 30x passive LOC/s, the same as a gold star", () => {
  assert.equal(launchPadBuyCost(1234.5), Math.floor(30 * 1234.5));
  assert.equal(launchPadBuyCost(1234.5), starBrokerBuyCost(1234.5));
  assert.equal(launchPadBuyCost(NaN), 0);
  assert.equal(launchPadBuyCost(-5), 0);
});

test("Launch Pad cooldowns mirror StarBroker: 8m, 4m, 2m, 1m, 30s", () => {
  assert.equal(launchPadCooldownSeconds(0), null);
  for (let level = 1; level <= 6; level++) {
    assert.equal(
      launchPadCooldownSeconds(level),
      starBrokerCooldownSeconds(level)
    );
  }
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(launchPadCooldownSeconds),
    [480, 240, 120, 60, 30]
  );
});

test("one shared buy timer: any buy locks both buttons by their own cooldown", () => {
  const lastBuyAt = 100_000;
  const now = lastBuyAt + 60_000; // 60s after the last buy, either color
  // StarBroker L5 (30s) is ready again; Launch Pad L1 (8m) still waits.
  assert.equal(starBuyCooldownRemainingSeconds(30, lastBuyAt, now), 0);
  assert.equal(starBuyCooldownRemainingSeconds(480, lastBuyAt, now), 420);
  // Never bought, or the project is unowned: ready.
  assert.equal(starBuyCooldownRemainingSeconds(480, null, now), 0);
  assert.equal(starBuyCooldownRemainingSeconds(null, lastBuyAt, now), 0);
  // NaN never reads as a cooldown.
  assert.equal(starBuyCooldownRemainingSeconds(480, NaN, now), 0);
});

// --- State: fresh defaults, validation, sale ---

test("goldStarsClicked: fresh default 0, NaN-safe, counted by recordGoldStarClicks", () => {
  assert.equal(initialSaveState().achievements.goldStarsClicked, 0);
  const old = initialSaveState();
  delete old.achievements.goldStarsClicked;
  assert.equal(normalizeSaveState(old).achievements.goldStarsClicked, 0);
  assert.equal(
    sanitizeAchievementsState({ goldStarsClicked: NaN }).goldStarsClicked,
    0
  );
  let a = initialSaveState().achievements;
  for (let i = 0; i < 25; i++) a = recordGoldStarClicks(a);
  assert.equal(a.goldStarsClicked, 25);
});

test("a save from before Moonshot gets level 0 and locked latches, nothing else", () => {
  const old = initialSaveState();
  delete old.openSourceProjects.moonshot;
  delete old.openSourceProjects.launchPad;
  delete old.unlockedOpenSourceProjects.moonshot;
  delete old.unlockedOpenSourceProjects.launchPad;
  const normalized = normalizeSaveState(old);
  assert.equal(normalized.openSourceProjects.moonshot, 0);
  assert.equal(normalized.openSourceProjects.launchPad, 0);
  assert.equal(normalized.unlockedOpenSourceProjects.moonshot, false);
  assert.equal(normalized.unlockedOpenSourceProjects.launchPad, false);
  assert.equal(validateSeedState(old).ok, true);
});

test("the validator accepts a To the Moon buff only at exactly x25", () => {
  const good = initialSaveState();
  good.activeStarEffects = [
    { effect: "moonshot", multiplier: 25, expiresAtMs: 1_000_000, employeeType: null },
  ];
  assert.equal(validateSeedState(good).ok, true);

  const tampered = initialSaveState();
  tampered.activeStarEffects = [
    { effect: "moonshot", multiplier: 250, expiresAtMs: 1_000_000, employeeType: null },
  ];
  const result = validateSeedState(tampered);
  assert.equal(result.ok, false);
  assert.match(result.detail, /moonshot/);
});

test("selling resets Moonshot and Launch Pad but keeps the gold star count", () => {
  const pre = withProgress({
    levels: { constellation: 3, moonshot: 1, launchPad: 4 },
    goldStars: 40,
  });
  pre.totalLinesOfCode = 80_000_000;
  pre.unlockedOpenSourceProjects = {
    ...pre.unlockedOpenSourceProjects,
    constellation: true,
    moonshot: true,
    launchPad: true,
  };
  const post = applyPrestigeSale(pre, "sale-moonshot-1");
  assert.ok(post, "the sale should go through");
  assert.equal(post.openSourceProjects.moonshot, 0);
  assert.equal(post.openSourceProjects.launchPad, 0);
  // The gate re-derives from the new company: Constellation is back to
  // 0, so Moonshot is locked until the player charts a star again;
  // Launch Pad is locked until Moonshot is rebought (and reconfirmed).
  assert.equal(post.unlockedOpenSourceProjects.moonshot, false);
  assert.equal(post.unlockedOpenSourceProjects.launchPad, false);
  assert.equal(post.achievements.goldStarsClicked, 40);
});
