/**
 * Tests for Hype Train and AGI (issue #157, revised for Moonshot).
 *
 * - Constellation gains L6 (750K LOC, unlocks Hype) and L7 (2M LOC,
 *   unlocks AGI); spawns stay 45-90s at L6 and go 30-60s at L7.
 * - Golden stars stay pure good (goodChance 1). Hype Train and AGI join
 *   the golden pool; Derailment and Union Drive exist only as red-star
 *   crash outcomes, through the existing moonshotCrashEffects
 *   derivation (no hand-listing), at softened values (bad duration half
 *   the good). Red-star odds are unchanged.
 * - Hype multiplies freelance payouts inside freelanceShipPayoutCents
 *   (manual ship, auto-ship, RM cash readout, the card); AGI multiplies
 *   hire costs inside employeeCost (single and bulk, card and reducer).
 * - The server accepts the new timed buffs at their config values only.
 * - Eight new achievements and their counters (fresh 0s, no backfill).
 * - Copy: locked names, no em dashes, within the email caps.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSave } from "../src/validate.js";
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_STATE_KEYS,
  BALANCE,
  EMAIL_CONFIG,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  MOONSHOT_CONFIG,
  OPEN_SOURCE_IDS,
  RELEASE_MANAGER_CONFIG,
  STAR_CONFIG,
  STAR_STAT_KEYS,
  achievementTierBuffPercent,
  achievementsDecreased,
  achievementsStateError,
  buildStarRewardEmail,
  clientNetworkPayoutMultiplier,
  employeeCost,
  employeePurchaseCosts,
  evaluateAchievements,
  findAchievement,
  freelancePayoutQuote,
  freelanceShipPayoutCents,
  hiringCostMultiplier,
  hypePayoutMultiplier,
  initialSaveState,
  moonshotCrashEffects,
  normalizeAchievementsState,
  recordStarClaimStats,
  recordStarStat,
  releaseManagerShippingEconomics,
  resolveMoonshotClaim,
  resolveStarClaim,
  rollStarEffect,
  rollStarGood,
  starBuffDurationSeconds,
  starBuffIsGood,
  starEffectFlavor,
  starEffectName,
  starRewardDetail,
  starSpawnIntervalSeconds,
  unlockedStarEffects,
  zeroAchievementsState,
} from "../../shared/game-balance.js";
import { projectPayoutLines } from "../../client/src/utils/projectPayout.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = () =>
  readFileSync(new URL("../../client/src/index.css", import.meta.url), "utf8");

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
const live = (effect, multiplier, expiresAtMs = T0 + 30_000) => [
  { effect, multiplier, expiresAtMs, employeeType: null },
];
const noDash = (text, label) => {
  assert.ok(!text.includes("—"), `${label}: no em dash`);
  assert.ok(!text.includes("–"), `${label}: no en dash`);
};

function zeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}
function zeroActions() {
  return {
    clicks: 0,
    employeesBought: zeroCounts(EMPLOYEE_TYPES),
    projectsCompleted: zeroCounts(FREELANCE_PROJECT_KEYS),
    autoShips: zeroCounts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: zeroCounts(OPEN_SOURCE_IDS),
  };
}

// --- Constellation L6 / L7 ---

test("Constellation has 7 levels: L6 750K, L7 2M; L6 keeps L5's spawn rate, L7 is faster", () => {
  const levels = BALANCE.openSource.constellation.levels;
  assert.deepEqual(levels.map((l) => l.locCost), [1000, 5000, 20000, 75000, 250000, 750000, 2000000]);
  for (const level of levels) assert.equal(level.bonus.type, "STAR");
  assert.deepEqual(starSpawnIntervalSeconds(5), { min: 45, max: 90 });
  assert.deepEqual(starSpawnIntervalSeconds(6), { min: 45, max: 90 });
  assert.deepEqual(starSpawnIntervalSeconds(7), { min: 30, max: 60 });
  assert.deepEqual(starSpawnIntervalSeconds(99), { min: 30, max: 60 }, "clamps past the top");
});

test("effects: Hype Train / Derailment at L6 (weight 10), AGI / Union Drive at L7 (weight 5), names locked", () => {
  assert.deepEqual(STAR_CONFIG.effects.hype.names, { good: "Hype Train", bad: "Derailment" });
  assert.deepEqual(STAR_CONFIG.effects.hiring.names, { good: "AGI", bad: "Union Drive" });
  assert.equal(STAR_CONFIG.effects.hype.unlockLevel, 6);
  assert.equal(STAR_CONFIG.effects.hiring.unlockLevel, 7);
  assert.equal(STAR_CONFIG.effects.hype.weight, 10);
  assert.equal(STAR_CONFIG.effects.hiring.weight, 5);
  // Rarer than Lucky and Frenzy.
  for (const id of ["hype", "hiring"]) {
    assert.ok(STAR_CONFIG.effects[id].weight < STAR_CONFIG.effects.lucky.weight);
    assert.ok(STAR_CONFIG.effects[id].weight < STAR_CONFIG.effects.frenzy.weight);
  }
  assert.equal(starEffectName("hype", true), "Hype Train");
  assert.equal(starEffectName("hype", false), "Derailment");
  assert.equal(starEffectName("hiring", true), "AGI");
  assert.equal(starEffectName("hiring", false), "Union Drive");
});

test("unlock gating: L5 has neither, L6 adds Hype, L7 adds AGI", () => {
  assert.ok(!unlockedStarEffects(5).includes("hype"));
  assert.ok(!unlockedStarEffects(5).includes("hiring"));
  assert.ok(unlockedStarEffects(6).includes("hype"));
  assert.ok(!unlockedStarEffects(6).includes("hiring"));
  assert.ok(unlockedStarEffects(7).includes("hype") && unlockedStarEffects(7).includes("hiring"));
});

// --- Golden stars stay pure good; crashes are derived ---

test("golden stars stay pure good: goodChance is still 1", () => {
  assert.equal(STAR_CONFIG.goodChance, 1);
  for (const r of [0, 0.5, 0.999999]) assert.equal(rollStarGood(() => r), true);
});

test("the golden pool at L7 rolls Hype Train and AGI at their weights", () => {
  const pool = unlockedStarEffects(7);
  const total = pool.reduce((sum, id) => sum + STAR_CONFIG.effects[id].weight, 0);
  const counts = {};
  const steps = 12_000;
  for (let i = 0; i < steps; i += 1) {
    const id = rollStarEffect(7, () => (i + 0.5) / steps);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  for (const id of pool) {
    assert.equal(counts[id], (STAR_CONFIG.effects[id].weight / total) * steps, id);
  }
});

test("the crash pool is derived, never hand-listed: every unlocked effect but Shooting Stars", () => {
  for (let level = 0; level <= 9; level += 1) {
    assert.deepEqual(
      moonshotCrashEffects(level),
      unlockedStarEffects(level).filter((id) => id !== "shootingStars")
    );
  }
  assert.ok(moonshotCrashEffects(6).includes("hype"));
  assert.ok(moonshotCrashEffects(7).includes("hiring"));
  assert.ok(!moonshotCrashEffects(7).includes("shootingStars"));
  assert.ok(!moonshotCrashEffects(5).includes("hype"));
  // Not hand-listed: the crash pool function is still the one-line
  // derivation from the unlocked effects, naming no effect but the
  // excluded Shooting Stars.
  const balance = readFileSync(new URL("../../shared/game-balance.js", import.meta.url), "utf8");
  const body = balance.match(/export function moonshotCrashEffects\(constellationLevel\) \{([\s\S]*?)\n\}/)[1];
  assert.match(body, /unlockedStarEffects\(constellationLevel\)\.filter/);
  assert.ok(!/"hype"|"hiring"/.test(body));
});

test("red-star odds are unchanged (1 in 4 red, 1 in 3 To the Moon)", () => {
  assert.equal(MOONSHOT_CONFIG.redStarChance, 0.25);
  assert.equal(Math.round(1 / MOONSHOT_CONFIG.jackpotChance), 3);
});

/** An rng that returns `values` in order, then 0.5 forever. */
function seq(...values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0.5);
}

test("a red-star crash at L7 can land Derailment or Union Drive, at the softened values", () => {
  const pool = moonshotCrashEffects(7);
  const total = pool.reduce((sum, id) => sum + STAR_CONFIG.effects[id].weight, 0);
  // Find each effect's slice of the weighted roll.
  const sliceStart = (id) => {
    let start = 0;
    for (const other of pool) {
      if (other === id) return start / total;
      start += STAR_CONFIG.effects[other].weight;
    }
    return null;
  };
  const crash = (id) =>
    resolveMoonshotClaim({
      constellationLevel: 7,
      locPerSecond: 100,
      money: 1000,
      linesOfCode: 1000,
      employeeCounts: { intern: 1 },
      // First roll misses the jackpot, second picks the effect.
      rng: seq(0.99, sliceStart(id) + 0.0001),
    });
  const derail = crash("hype");
  assert.equal(derail.effect, "hype");
  assert.equal(derail.good, false);
  assert.equal(derail.red, true);
  assert.equal(derail.multiplier, 0.5);
  assert.equal(derail.durationSeconds, 30);
  const union = crash("hiring");
  assert.equal(union.effect, "hiring");
  assert.equal(union.good, false);
  assert.equal(union.multiplier, 1.5);
  assert.equal(union.durationSeconds, 30);
});

test("claims: Hype Train 2x payouts 60s, Derailment 0.5x 30s; AGI 0.5x hire cost 60s, Union Drive 1.5x 30s", () => {
  const claim = (effect, good) =>
    resolveStarClaim({ effect, good, locPerSecond: 10, money: 0, linesOfCode: 0, employeeCounts: {} });
  assert.deepEqual(
    [claim("hype", true).multiplier, claim("hype", true).durationSeconds],
    [2, 60]
  );
  assert.deepEqual(
    [claim("hype", false).multiplier, claim("hype", false).durationSeconds],
    [0.5, 30]
  );
  assert.deepEqual(
    [claim("hiring", true).multiplier, claim("hiring", true).durationSeconds],
    [0.5, 60]
  );
  assert.deepEqual(
    [claim("hiring", false).multiplier, claim("hiring", false).durationSeconds],
    [1.5, 30]
  );
  for (const effect of ["hype", "hiring"]) {
    const good = claim(effect, true);
    const bad = claim(effect, false);
    assert.equal(bad.durationSeconds, good.durationSeconds / 2, `${effect}: bad is half as long`);
    assert.equal(good.locDelta, 0);
    assert.equal(good.moneyDelta, 0);
    assert.equal(good.employeeType, null);
    assert.equal(starBuffDurationSeconds(effect, true), good.durationSeconds);
    assert.equal(starBuffDurationSeconds(effect, false), bad.durationSeconds);
  }
});

test("starBuffIsGood: above 1x is good, except hiring, where below 1x (AGI) is good", () => {
  assert.equal(starBuffIsGood({ effect: "hype", multiplier: 2 }), true);
  assert.equal(starBuffIsGood({ effect: "hype", multiplier: 0.5 }), false);
  assert.equal(starBuffIsGood({ effect: "hiring", multiplier: 0.5 }), true);
  assert.equal(starBuffIsGood({ effect: "hiring", multiplier: 1.5 }), false);
  assert.equal(starBuffIsGood({ effect: "frenzy", multiplier: 3 }), true);
  assert.equal(starBuffIsGood({ effect: "frenzy", multiplier: 0.5 }), false);
  assert.equal(starBuffIsGood(null), false);
  // The duration bar uses it (not multiplier > 1).
  const star = src("components/GoldenStar.jsx");
  assert.match(star, /const good = starBuffIsGood\(buff\);/);
  assert.ok(!/buff\.multiplier > 1/.test(star));
});

// --- Hype: the payout helper ---

test("Hype multiplies the shared payout helper; expired or absent changes nothing", () => {
  for (const key of FREELANCE_PROJECT_KEYS) {
    const reward = BALANCE.freelanceProjects[key].reward;
    assert.equal(freelanceShipPayoutCents(key, {}), reward);
    assert.equal(freelanceShipPayoutCents(key, {}, { activeStarEffects: live("hype", 2), nowMs: T0 }), reward * 2);
    assert.equal(freelanceShipPayoutCents(key, {}, { activeStarEffects: live("hype", 0.5), nowMs: T0 }), Math.round(reward * 0.5));
    // Expired: base.
    assert.equal(freelanceShipPayoutCents(key, {}, { activeStarEffects: live("hype", 2, T0 - 1), nowMs: T0 }), reward);
    // Stacks with Client Network, rounded once per ship.
    const ranks = { clientNetwork: 3 };
    assert.equal(
      freelanceShipPayoutCents(key, ranks, { activeStarEffects: live("hype", 2), nowMs: T0 }),
      Math.round(reward * clientNetworkPayoutMultiplier(ranks) * 2)
    );
  }
  assert.equal(hypePayoutMultiplier(live("frenzy", 3), T0), 1, "other effects do not count");
  assert.equal(hypePayoutMultiplier(undefined, T0), 1);
});

test("every payout path agrees: RM cash readout, the quote and the card all double", () => {
  const effects = live("hype", 2);
  const all = Object.fromEntries(FREELANCE_PROJECT_KEYS.map((k) => [k, 1]));
  const args = { assignments: all, managersOwned: 7, unlockedProjects: all };
  const base = releaseManagerShippingEconomics({ ...args, nowMs: T0 });
  const hyped = releaseManagerShippingEconomics({ ...args, activeStarEffects: effects, nowMs: T0 });
  assert.equal(hyped.cashPerSecond, base.cashPerSecond * 2);
  assert.equal(hyped.rmOut, base.rmOut, "LOC cost unchanged");
  assert.equal(RELEASE_MANAGER_CONFIG.shipIntervalSeconds > 0, true);
  const quote = freelancePayoutQuote("toDoListApp", {}, { activeStarEffects: effects, nowMs: T0 });
  assert.equal(quote.payoutCents, 6000);
  assert.equal(quote.centsPerLoc, 120);
  assert.equal(quote.hypeMultiplier, 2);
  // The card's lines say why (now = real time, so expire far ahead).
  const far = Date.now() + 60_000;
  assert.deepEqual(projectPayoutLines("toDoListApp", {}, { activeStarEffects: live("hype", 2, far) }), {
    payout: "$60.00",
    rate: "120¢/LOC",
    rateNote: " (2x Hype Train)",
    rateTone: "gain",
  });
  assert.deepEqual(
    projectPayoutLines("toDoListApp", { clientNetwork: 1 }, { activeStarEffects: live("hype", 0.5, far) }),
    {
      payout: "$15.75",
      rate: "31.5¢/LOC",
      rateNote: " (+5% Client Network, 0.5x Derailment)",
      rateTone: "loss",
    }
  );
  // The reducer passes the live effects into both payout calls.
  const context = src("context/GameContext.jsx");
  assert.equal(
    (context.match(/freelanceShipPayoutCents\([\s\S]{0,120}?activeStarEffects: state\.activeStarEffects/g) ?? []).length,
    2
  );
  assert.match(src("context/gameLogic.js"), /releaseManagerShippingEconomics\(\{[\s\S]*?activeStarEffects: state\.activeStarEffects/);
  assert.match(src("components/Projects.jsx"), /projectPayoutLines\(\s*projectKey,\s*state\.permanentStoreRanks \?\? \{\},\s*\{ activeStarEffects: state\.activeStarEffects \?\? \[\] \}/);
});

// --- AGI: the hire-cost path ---

test("AGI halves and Union Drive raises every hire, single and bulk, in the shared cost", () => {
  for (const type of EMPLOYEE_TYPES) {
    const { baseCost, costMultiplier } = BALANCE.employees[type];
    for (const count of [0, 3, 20]) {
      const raw = baseCost * costMultiplier ** count;
      assert.equal(employeeCost(type, count), Math.round(raw));
      assert.equal(employeeCost(type, count, { activeStarEffects: live("hiring", 0.5), nowMs: T0 }), Math.round(raw * 0.5));
      assert.equal(employeeCost(type, count, { activeStarEffects: live("hiring", 1.5), nowMs: T0 }), Math.round(raw * 1.5));
      assert.equal(employeeCost(type, count, { activeStarEffects: live("hiring", 0.5, T0), nowMs: T0 }), Math.round(raw), "expired");
    }
    // Bulk: each hire in the batch is discounted.
    const effects = { activeStarEffects: live("hiring", 0.5), nowMs: T0 };
    const bulk = employeePurchaseCosts(type, 4, 25, effects);
    assert.equal(bulk.length, 25);
    bulk.forEach((cost, i) => assert.equal(cost, employeeCost(type, 4 + i, effects)));
  }
  assert.equal(hiringCostMultiplier(live("hype", 2), T0), 1, "other effects do not count");
});

test("every hire price path passes the live effects: card, bulk card, reducer, locked card", () => {
  const logic = src("context/gameLogic.js");
  assert.match(logic, /shared\.employeeCost\(employeeType, employee\.count, \{\s*activeStarEffects: state\.activeStarEffects \?\? \[\],?\s*\}\)/);
  assert.match(logic, /\.employeePurchaseCosts\(employeeType, employee\.count, quantity, \{\s*activeStarEffects: state\.activeStarEffects \?\? \[\],?\s*\}\)/);
  const context = src("context/GameContext.jsx");
  assert.match(context, /\.employeePurchaseCosts\(employeeType, employee\.count, quantity, hireEffects\)/);
  const shop = src("components/Shop.jsx");
  assert.match(shop, /price=\{employeeCost\(employeeType, 0, \{ activeStarEffects \}\)\}/);
  assert.match(shop, /hireCostMultiplier=\{hireCostMultiplier\}/);
  // The Hire card shows the old price while one is live.
  const card = src("components/EmployeeCard.jsx");
  assert.match(card, /tag="@deprecated"/);
  assert.match(card, /value: `was \$\{formatMoney\(listCost\)\}`/);
  assert.match(src("components/LockedEmployeeCard.jsx"), /formatMoney\(price \?\? config\.baseCost\)/);
});

// --- Server ---

test("the server accepts Hype and hiring buffs at their config values only", () => {
  const save = (effect, multiplier) =>
    validateSave(
      { state: initialSaveState(), savedAtMs: T0 },
      {
        playerId: PLAYER_ID,
        state: { ...initialSaveState(), activeStarEffects: live(effect, multiplier, T0 + 90_000) },
        actionsSinceLastSave: zeroActions(),
      },
      T0 + 60_000
    );
  assert.deepEqual(save("hype", 2), { ok: true });
  assert.deepEqual(save("hype", 0.5), { ok: true });
  assert.deepEqual(save("hiring", 0.5), { ok: true });
  assert.deepEqual(save("hiring", 1.5), { ok: true });
  for (const [effect, multiplier] of [["hype", 3], ["hype", 1.5], ["hiring", 2], ["hiring", 0.25], ["warpDrive", 2]]) {
    const result = save(effect, multiplier);
    assert.equal(result.ok, false, `${effect} ${multiplier} rejected`);
  }
});

// --- Achievements ---

const NEW_IDS = [
  "hypeSpringsEternal",
  "shipWhileItsHot",
  "viralLoad",
  "ticketToHype",
  "artificialGeneralDiscount",
  "fireSaleHireSale",
  "collectiveBargainingChip",
  "singularityAdjacent",
];

test("eight new achievements, on the existing tier pattern, copy clean", () => {
  for (const id of NEW_IDS) {
    const def = findAchievement(id);
    assert.ok(def, id);
    assert.equal(def.hidden, false);
    assert.ok(def.thresholds.length >= 1);
    for (let i = 1; i < def.thresholds.length; i += 1) {
      assert.ok(def.thresholds[i] > def.thresholds[i - 1]);
    }
    for (const threshold of def.thresholds) {
      const text = def.describe(threshold);
      noDash(text, id);
      assert.ok(text.length > 0);
    }
    noDash(def.name, id);
    noDash(def.flavor, id);
  }
  assert.deepEqual(
    Object.fromEntries(NEW_IDS.map((id) => [id, findAchievement(id).metric])),
    {
      hypeSpringsEternal: "hypeTrains",
      shipWhileItsHot: "hypeShips",
      viralLoad: "hypeCashCents",
      ticketToHype: "constellationLevel",
      artificialGeneralDiscount: "agiTriggers",
      fireSaleHireSale: "agiHires",
      collectiveBargainingChip: "unionDrives",
      singularityAdjacent: "constellationLevel",
    }
  );
  assert.deepEqual(findAchievement("ticketToHype").thresholds, [6]);
  assert.deepEqual(findAchievement("singularityAdjacent").thresholds, [7]);
  assert.deepEqual([1, 2, 3, 4].map(achievementTierBuffPercent), [1, 2, 3, 5]);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length, "ids unique");
});

test("star claims move the right counters: Hype Train, AGI, and Union Drive (red crash only)", () => {
  const z = zeroAchievementsState();
  assert.deepEqual(z.starStats, Object.fromEntries(STAR_STAT_KEYS.map((k) => [k, 0])));
  assert.equal(recordStarClaimStats(z, { effect: "hype", good: true }).starStats.hypeTrains, 1);
  assert.deepEqual(recordStarClaimStats(z, { effect: "hype", good: false }), z, "Derailment counts nothing");
  assert.equal(recordStarClaimStats(z, { effect: "hiring", good: true }).starStats.agiTriggers, 1);
  assert.equal(recordStarClaimStats(z, { effect: "hiring", good: false, red: true }).starStats.unionDrives, 1);
  assert.deepEqual(recordStarClaimStats(z, { effect: "frenzy", good: true }), z);
  assert.equal(recordStarClaimStats(z, null), z);
  // Junk never reaches a counter.
  assert.deepEqual(recordStarStat(z, "hypeShips", NaN).starStats, z.starStats);
  assert.deepEqual(recordStarStat(z, "notAStat", 5).starStats, z.starStats);
  assert.equal(recordStarStat(z, "hypeCashCents", 1234.9).starStats.hypeCashCents, 1234);
});

test("the counters latch their tiers; Constellation v6/v7 latch Ticket to Hype / Singularity Adjacent", () => {
  let a = zeroAchievementsState();
  a = recordStarStat(a, "hypeTrains", 5);
  a = recordStarStat(a, "hypeShips", 100);
  a = recordStarStat(a, "hypeCashCents", 1_000_000);
  a = recordStarStat(a, "agiTriggers", 1);
  a = recordStarStat(a, "agiHires", 10);
  a = recordStarStat(a, "unionDrives", 3);
  const { achievements, unlocked } = evaluateAchievements(a, { constellationLevel: 7 });
  const tiers = achievements.tiers;
  assert.equal(tiers.hypeSpringsEternal, 2);
  assert.equal(tiers.shipWhileItsHot, 2);
  assert.equal(tiers.viralLoad, 1);
  assert.equal(tiers.artificialGeneralDiscount, 1);
  assert.equal(tiers.fireSaleHireSale, 1);
  assert.equal(tiers.collectiveBargainingChip, 2);
  assert.equal(tiers.ticketToHype, 1);
  assert.equal(tiers.singularityAdjacent, 1);
  assert.ok(unlocked.some((u) => u.id === "singularityAdjacent"));
  const atSix = evaluateAchievements(zeroAchievementsState(), { constellationLevel: 6 }).achievements.tiers;
  assert.equal(atSix.ticketToHype, 1);
  assert.equal(atSix.singularityAdjacent, 0);
  // The client context carries the level.
  assert.match(src("context/gameLogic.js"), /constellationLevel: state\.openSourceProjects\?\.constellation\?\.level \?\? 0/);
});

test("old saves get fresh starStats (no backfill); the shape and monotonic checks cover them", () => {
  const old = zeroAchievementsState();
  delete old.starStats;
  const normalized = normalizeAchievementsState(old);
  assert.deepEqual(normalized.starStats, zeroAchievementsState().starStats);
  assert.equal(achievementsStateError(normalized), null);
  assert.ok(ACHIEVEMENTS_STATE_KEYS.includes("starStats"));
  assert.match(achievementsStateError(old) ?? "", /unknown or missing keys/);
  const bad = { ...normalized, starStats: { ...normalized.starStats, hypeShips: -1 } };
  assert.match(achievementsStateError(bad), /starStats\.hypeShips/);
  const prev = recordStarStat(normalized, "agiHires", 5);
  assert.equal(achievementsDecreased(prev, normalized), "starStats.agiHires");
  assert.equal(achievementsDecreased(normalized, prev), null);
});

test("the reducer hooks: claims, hype ships (manual and auto), AGI hires", () => {
  const context = src("context/GameContext.jsx");
  assert.match(context, /achievements: shared\.recordStarClaimStats\(/);
  assert.match(context, /achievements: recordHypeShips\(state, 1, payout\)/);
  assert.match(context, /achievements: recordHypeShips\(state, autoShipCount, autoShipCash\)/);
  assert.match(context, /"agiHires",\s*agiLive \? quantity : 0/);
  // Only a GOOD hype buff (Hype Train) counts ships.
  assert.match(context, /function recordHypeShips[\s\S]*?starBuffIsGood\(\{ effect: "hype"/);
});

// --- Copy ---

test("reward text, email subjects and flavor: locked names, no em dashes, within the caps", () => {
  assert.equal(starRewardDetail({ effect: "hype", multiplier: 2 }), "Freelance payouts 2x");
  assert.equal(starRewardDetail({ effect: "hype", multiplier: 0.5 }), "Freelance payouts 0.5x");
  assert.equal(starRewardDetail({ effect: "hiring", multiplier: 0.5 }), "Hires 50% off");
  assert.equal(starRewardDetail({ effect: "hiring", multiplier: 1.5 }), "Hires cost 50% more");
  for (const effect of ["hype", "hiring"]) {
    for (const good of [true, false]) {
      const claim = resolveStarClaim({ effect, good, locPerSecond: 1, money: 0, linesOfCode: 0, employeeCounts: {} });
      const flavor = starEffectFlavor(effect, good);
      assert.ok(typeof flavor === "string" && flavor.length > 40, `${effect} ${good} has flavor`);
      const mail = buildStarRewardEmail({
        effectName: starEffectName(effect, good),
        rewardText: starRewardDetail(claim),
        good,
        flavor,
      });
      assert.equal(mail.body, flavor);
      assert.ok(mail.subject.startsWith(`${starEffectName(effect, good)}: `), "subject shows the effect");
      assert.ok(mail.subject.length <= EMAIL_CONFIG.maxSubjectLength);
      assert.ok(mail.body.length <= EMAIL_CONFIG.maxBodyLength);
      noDash(mail.subject, "subject");
      noDash(mail.body, "body");
    }
  }
  // The vibes: a rando on X, AGI devaluing labor, the union pushback.
  assert.match(starEffectFlavor("hype", true), /rando on X/);
  assert.match(starEffectFlavor("hiring", true), /LLM costs less than a human/);
  assert.match(starEffectFlavor("hiring", false), /not being priced like a chatbot/);
  // Effects without a story keep the generic sign-off.
  assert.equal(starEffectFlavor("frenzy", true), null);
  assert.equal(
    buildStarRewardEmail({ effectName: "Overclock", rewardText: "Production 3x", good: true }).body,
    "The GitNub sky provides. Mostly."
  );
  assert.match(src("email/email.js"), /flavor: starEffectFlavor\(starClaim\.effect, starClaim\.good\)/);
});

// --- Visuals (source checks: the components import React) ---

test("Hype Train makes shippable project cards glow green and sparkle; Derailment dims them red", () => {
  const card = src("components/ProjectCard.jsx");
  assert.match(card, /hypeTone === "hype"\s*\?\s*"hype-train"/);
  assert.match(card, /"hype-derailed"/);
  assert.match(card, /<Panel/);
  const projects = src("components/Projects.jsx");
  assert.match(projects, /hypeTone=\{hypeTone\}/);
  const styles = css();
  assert.match(styles, /\.hype-train \{/);
  assert.match(styles, /\.hype-train::after \{[\s\S]*?pointer-events: none;/);
  assert.match(styles, /@keyframes grq-hype-sparkle/);
  assert.match(styles, /\.hype-derailed \{/);
  assert.match(styles, /prefers-reduced-motion: reduce\) \{\s*\.hype-train \{\s*animation: none;/);
  // The rate note turns red under a Derailment.
  assert.match(src("components/ProjectRateLine.jsx"), /payout\.rateTone === "loss" \? "text-red-400" : "text-green-400"/);
});
