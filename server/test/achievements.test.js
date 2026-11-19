/**
 * Tests for the achievements system (issue #132): tier ladders, the
 * ONE shared LOC buff helper (buffedLocMultiplier / buffedLocPerSecond),
 * the tracking counters and their record helpers, the save shape and
 * MONOTONIC rules, the sale carry-over, the client's pre-write payload
 * check, and the copy rules (no em dashes in any player-facing text).
 *
 * Buff ladder: tier 1 +1%, tier 2 +2%, tier 3 +3%, tier 4 and up +5%.
 * Tiers of one achievement stack; all achievements add into one
 * multiplier 1 + total% / 100, which multiplies the Founder
 * multiplier. No migration: a save without achievements gets a fresh
 * record (every tier locked, every counter 0).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave } from "../src/validate.js";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_IDS,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  LLAMA_TYPES,
  OPEN_SOURCE_IDS,
  achievementBuffPercent,
  achievementCumulativeBuffPercent,
  achievementLocMultiplier,
  achievementMaxTier,
  achievementMetricValue,
  achievementProgress,
  achievementTierBuffPercent,
  achievementTierDescription,
  achievementTiersEarned,
  achievementsStateError,
  applyPrestigeSale,
  buffedLocMultiplier,
  buffedLocPerSecond,
  buildAchievementEmail,
  evaluateAchievements,
  founderMultiplier,
  initialSaveState,
  locPerClick,
  locPerSecond,
  maxAchievementBuffPercent,
  normalizeSaveState,
  prestigeSaleQuote,
  recordClicks,
  recordHires,
  recordLlamaBought,
  recordLlamaSold,
  recordPeakLocPerSecond,
  sanitizeAchievementsState,
  sumCounts,
  zeroAchievementsState,
} from "../../shared/game-balance.js";
import {
  bigActionFields,
  bigActionIncreased,
  isInitialSaveState,
  saveStateToGameFields,
  savePayloadError,
  stateToSaveState,
} from "../../client/src/save/serialize.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";

function zeroActions() {
  const counts = (keys) =>
    keys.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {});
  return {
    clicks: 0,
    employeesBought: counts(EMPLOYEE_TYPES),
    projectsCompleted: counts(FREELANCE_PROJECT_KEYS),
    autoShips: counts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: counts(OPEN_SOURCE_IDS),
  };
}

function save(prevState, newState) {
  return validateSave(
    { state: prevState, savedAtMs: T0 },
    { playerId: PLAYER_ID, state: newState, actionsSinceLastSave: zeroActions() },
    T0 + 60_000
  );
}

function withTiers(tiers) {
  const a = zeroAchievementsState();
  return { ...a, tiers: { ...a.tiers, ...tiers } };
}

test("buff ladder: tier 1 is 1%, tier 2 2%, tier 3 3%, tier 4+ 5%", () => {
  assert.equal(achievementTierBuffPercent(0), 0);
  assert.equal(achievementTierBuffPercent(1), 1);
  assert.equal(achievementTierBuffPercent(2), 2);
  assert.equal(achievementTierBuffPercent(3), 3);
  assert.equal(achievementTierBuffPercent(4), 5);
  assert.equal(achievementTierBuffPercent(7), 5);
  // Higher tiers never give less than lower ones.
  for (let t = 2; t <= 8; t += 1) {
    assert.ok(achievementTierBuffPercent(t) >= achievementTierBuffPercent(t - 1));
  }
  // Tiers stack within one achievement: tiers 1-5 = 1+2+3+5+5.
  assert.equal(achievementCumulativeBuffPercent(5), 16);
});

test("every buff value is one of 1, 2, 3, or 5 percent", () => {
  for (const def of ACHIEVEMENTS) {
    for (let t = 1; t <= def.thresholds.length; t += 1) {
      assert.ok([1, 2, 3, 5].includes(achievementTierBuffPercent(t)));
    }
  }
});

test("achievement definitions: unique ids, ascending thresholds, required families", () => {
  assert.equal(new Set(ACHIEVEMENT_IDS).size, ACHIEVEMENT_IDS.length);
  for (const def of ACHIEVEMENTS) {
    assert.ok(def.thresholds.length >= 1, def.id);
    for (let i = 1; i < def.thresholds.length; i += 1) {
      assert.ok(def.thresholds[i] > def.thresholds[i - 1], def.id);
    }
  }
  const metrics = new Set(ACHIEVEMENTS.map((def) => def.metric));
  // The families the issue lists (a floor, not a ceiling).
  for (const type of EMPLOYEE_TYPES) {
    const def = ACHIEVEMENTS.find((d) => d.metric === `hires:${type}`);
    assert.ok(def, `hires family for ${type}`);
    assert.deepEqual([...def.thresholds], [1, 5, 10, 25, 100]);
  }
  const total = ACHIEVEMENTS.find((d) => d.metric === "totalHires");
  assert.deepEqual([...total.thresholds].slice(0, 5), [1, 5, 10, 25, 100]);
  assert.ok(total.thresholds.length > 5, "total employees goes above 100");
  for (const metric of [
    "peakLocPerSecond",
    "runLoc",
    "lifetimeLoc",
    "achievementTiers",
    "llamasBought",
    "llamasSold",
  ]) {
    assert.ok(metrics.has(metric), metric);
  }
  assert.ok(ACHIEVEMENTS.some((def) => def.hidden), "has hidden achievements");
});

test("no em dashes in any achievement name, flavor, description, or email", () => {
  for (const def of ACHIEVEMENTS) {
    assert.ok(!def.name.includes("—"), def.id);
    assert.ok(!def.flavor.includes("—"), def.id);
    for (let t = 1; t <= def.thresholds.length; t += 1) {
      assert.ok(!achievementTierDescription(def.id, t).includes("—"), def.id);
    }
  }
  const mail = buildAchievementEmail({
    unlocked: ACHIEVEMENTS.map((def) => ({ id: def.id, tier: 1 })),
  });
  for (const text of [mail.sender, mail.subject, mail.body]) {
    assert.ok(!text.includes("—"));
  }
});

test("tier descriptions format the threshold and pluralize", () => {
  assert.equal(achievementTierDescription("internalAffairs", 1), "Hire 1 Intern.");
  assert.equal(achievementTierDescription("internalAffairs", 5), "Hire 100 Interns.");
  assert.match(achievementTierDescription("legacyCode", 3), /1M lines of code/);
});

test("achievementLocMultiplier: 1 with nothing earned, 1 + total% / 100 otherwise", () => {
  assert.equal(achievementLocMultiplier(zeroAchievementsState()), 1);
  assert.equal(achievementLocMultiplier(undefined), 1);
  const a = withTiers({ internalAffairs: 3, helloWorld: 1 });
  assert.equal(achievementBuffPercent(a), 1 + 2 + 3 + 1);
  assert.equal(achievementLocMultiplier(a), 1.07);
  // A tier beyond the max (a tampered record) never buffs past the max.
  const over = withTiers({ helloWorld: 99 });
  assert.equal(achievementBuffPercent(over), 1);
  assert.ok(maxAchievementBuffPercent() > 0);
});

test("buffedLocMultiplier is the Founder multiplier times the achievement buff", () => {
  const state = {
    lifetimeEquityEarned: 10,
    achievements: withTiers({ internalAffairs: 2 }),
  };
  assert.equal(
    buffedLocMultiplier(state),
    founderMultiplier(10) * achievementLocMultiplier(state.achievements)
  );
  assert.equal(buffedLocMultiplier({}), 1);
});

test("buffedLocPerSecond prices off the buffed rate, never raw base LOC/s", () => {
  const base = initialSaveState();
  const state = {
    ...base,
    employees: { ...base.employees, intern: 1000 },
    lifetimeEquityEarned: 5,
    achievements: withTiers({ internalAffairs: 5, legacyCode: 6 }),
  };
  const raw = locPerSecond(state.employees, state.openSourceProjects);
  const buffed = buffedLocPerSecond(state);
  assert.equal(raw, 1000);
  // 1000 x 1.5 (Founder at 5) x (1 + 16% + 21%).
  assert.equal(buffed, Math.floor(1000 * 1.5 * 1.37 + 1e-9));
  assert.ok(buffed > raw);
});

test("the achievement buff boosts clicks too (through the shared multiplier)", () => {
  const a = withTiers({ carpalTunnelVision: 5 }); // +16%
  const mult = buffedLocMultiplier({ lifetimeEquityEarned: 0, achievements: a });
  const counts = {};
  for (const type of EMPLOYEE_TYPES) counts[type] = 0;
  const levels = {};
  for (const id of OPEN_SOURCE_IDS) levels[id] = 0;
  assert.equal(locPerClick(levels, counts, 1, 1), 1);
  // 1 x 1.16 floors to 1, so measure on a bigger click: 100 specialists.
  counts.commitSpecialist = 100; // 1 + 20 = 21 LOC per click unbuffed
  assert.equal(locPerClick(levels, counts, 1, 1), 21);
  assert.equal(locPerClick(levels, counts, 1, mult), Math.floor(21 * 1.16 + 1e-9));
});

test("prestigeSaleQuote freezes the buffed healthy rate", () => {
  const base = initialSaveState();
  const state = {
    ...base,
    employees: { ...base.employees, intern: 100 },
    achievements: withTiers({ legacyCode: 6 }), // +21%
  };
  assert.equal(prestigeSaleQuote(state).healthyPassiveLocPerSec, 121);
  assert.equal(
    prestigeSaleQuote(state).healthyPassiveLocPerSec,
    buffedLocPerSecond(state)
  );
});

test("initial save carries a fresh record; an old save without one gets a fresh one", () => {
  const initial = initialSaveState();
  assert.deepEqual(initial.achievements, zeroAchievementsState());
  assert.equal(achievementsStateError(initial.achievements), null);
  const old = { ...initial };
  delete old.achievements;
  const normalized = normalizeSaveState(old);
  assert.deepEqual(normalized.achievements, zeroAchievementsState());
  assert.equal(save(old, initial).ok, true);
});

test("normalize fills a missing count with 0 and leaves a wrong value for the shape check", () => {
  const initial = initialSaveState();
  const partial = zeroAchievementsState();
  delete partial.hires.intern;
  delete partial.clicks;
  const normalized = normalizeSaveState({ ...initial, achievements: partial });
  assert.equal(normalized.achievements.hires.intern, 0);
  assert.equal(normalized.achievements.clicks, 0);
  const bad = { ...zeroAchievementsState(), clicks: -3 };
  const result = save(initial, { ...initial, achievements: bad });
  assert.equal(result.ok, false);
  assert.equal(result.rule, "SHAPE");
});

test("shape: unknown keys, null counts, and tiers past the max are rejected", () => {
  const initial = initialSaveState();
  const cases = [
    { ...zeroAchievementsState(), extra: 1 },
    { ...zeroAchievementsState(), clicks: null },
    { ...zeroAchievementsState(), peakLocPerSecond: "fast" },
    withTiers({ helloWorld: achievementMaxTier("helloWorld") + 1 }),
    withTiers({ notAnAchievement: 1 }),
    { ...zeroAchievementsState(), llamasSold: { ...zeroAchievementsState().llamasSold, unicorn: 1 } },
  ];
  for (const achievements of cases) {
    const result = save(initial, { ...initial, achievements });
    assert.equal(result.ok, false, JSON.stringify(achievements).slice(0, 80));
    assert.equal(result.rule, "SHAPE");
  }
});

test("MONOTONIC: an earned tier and every lifetime counter only grow", () => {
  const initial = initialSaveState();
  const earned = {
    ...initial,
    achievements: {
      ...withTiers({ internalAffairs: 2 }),
      hires: { ...zeroAchievementsState().hires, intern: 5 },
      clicks: 50,
      peakLocPerSecond: 12,
      llamasBought: { ...zeroAchievementsState().llamasBought, classic: 2 },
      llamasSold: { ...zeroAchievementsState().llamasSold, classic: 1 },
    },
  };
  assert.equal(save(initial, earned).ok, true);
  const drops = [
    { tiers: { ...earned.achievements.tiers, internalAffairs: 1 } },
    { hires: { ...earned.achievements.hires, intern: 4 } },
    { clicks: 49 },
    { peakLocPerSecond: 11 },
    { llamasBought: { ...earned.achievements.llamasBought, classic: 1 } },
    { llamasSold: { ...earned.achievements.llamasSold, classic: 0 } },
  ];
  for (const drop of drops) {
    const next = { ...earned, achievements: { ...earned.achievements, ...drop } };
    const result = save(earned, next);
    assert.equal(result.ok, false, Object.keys(drop)[0]);
    assert.equal(result.rule, "MONOTONIC");
  }
});

test("a sale keeps every achievement and counter (permanent buffs survive)", () => {
  const base = initialSaveState();
  const achievements = {
    ...withTiers({ legacyCode: 3, exitStrategy: 0 }),
    hires: { ...zeroAchievementsState().hires, intern: 40 },
    clicks: 1234,
  };
  const pre = {
    ...base,
    totalLinesOfCode: 80_000_000,
    linesOfCode: 10,
    employees: { ...base.employees, intern: 40 },
    achievements,
  };
  const post = applyPrestigeSale(pre, "123e4567-e89b-42d3-a456-426614174999");
  assert.deepEqual(post.achievements, achievements);
  assert.equal(post.employees.intern, 0);
});

test("record helpers: hires, clicks, peak, llamas bought and sold", () => {
  let a = zeroAchievementsState();
  a = recordHires(a, "intern", 10);
  a = recordHires(a, "notAType", 10);
  a = recordClicks(a, 3);
  a = recordPeakLocPerSecond(a, 50);
  a = recordPeakLocPerSecond(a, 20); // lower: the peak stays
  a = recordLlamaBought(a, "classic");
  a = recordLlamaBought(a, "drama", 2);
  a = recordLlamaSold(a, "classic");
  a = recordLlamaSold(a, "unicorn");
  assert.equal(a.hires.intern, 10);
  assert.equal(sumCounts(a.hires), 10);
  assert.equal(a.clicks, 3);
  assert.equal(a.peakLocPerSecond, 50);
  assert.equal(sumCounts(a.llamasBought), 3);
  assert.equal(sumCounts(a.llamasSold), 1);
  for (const type of LLAMA_TYPES) {
    assert.ok(Number.isInteger(a.llamasBought[type]));
  }
});

test("evaluateAchievements latches every tier crossed, lowest first, and is a no-op when nothing moved", () => {
  const a = recordHires(zeroAchievementsState(), "intern", 12);
  const { achievements, unlocked } = evaluateAchievements(a, { achievements: a });
  assert.equal(achievements.tiers.internalAffairs, 3);
  assert.equal(achievements.tiers.headcountHoarder, 3);
  assert.deepEqual(
    unlocked.filter((u) => u.id === "internalAffairs"),
    [
      { id: "internalAffairs", tier: 1 },
      { id: "internalAffairs", tier: 2 },
      { id: "internalAffairs", tier: 3 },
    ]
  );
  const again = evaluateAchievements(achievements, { achievements });
  assert.equal(again.unlocked.length, 0);
});

test("evaluateAchievements never lowers a tier when the live metric drops", () => {
  const a = withTiers({ runningCode: 4 });
  // A sale reset the run LOC to 0: the tier stays.
  const { achievements, unlocked } = evaluateAchievements(a, {
    achievements: a,
    totalLinesOfCode: 5,
    lifetimeLocAtLastSale: 5,
  });
  assert.equal(achievements.tiers.runningCode, 4);
  assert.equal(unlocked.length, 0);
});

test("Meta Data counts the tiers earned in the same pass, not itself", () => {
  // 12 interns: Hello World is not earned; Intern-al Affairs III and
  // Headcount Hoarder III make 6 tiers -> Meta Data I (5).
  const a = recordHires(zeroAchievementsState(), "intern", 12);
  const { achievements } = evaluateAchievements(a, { achievements: a });
  assert.equal(achievements.tiers.metaData, 1);
  assert.equal(
    achievementTiersEarned(achievements, { excludeId: "metaData" }),
    6
  );
});

test("NaN guard: a NaN or negative counter never unlocks a tier", () => {
  const poisoned = {
    ...zeroAchievementsState(),
    clicks: Number.NaN,
    hires: { ...zeroAchievementsState().hires, intern: -5 },
  };
  const { achievements, unlocked } = evaluateAchievements(poisoned, {
    achievements: poisoned,
    totalLinesOfCode: Number.NaN,
  });
  assert.equal(unlocked.length, 0);
  assert.equal(achievements.clicks, 0);
  assert.equal(achievements.hires.intern, 0);
  assert.equal(achievementMetricValue("lifetimeLoc", { totalLinesOfCode: NaN }), 0);
});

test("live metrics: run vs lifetime LOC, roles, hidden achievements", () => {
  const ctx = {
    totalLinesOfCode: 5000,
    lifetimeLocAtLastSale: 3000,
    employees: { intern: 3, junior: 1 },
    money: 0,
    emailCount: 0,
  };
  assert.equal(achievementMetricValue("runLoc", ctx), 2000);
  assert.equal(achievementMetricValue("lifetimeLoc", ctx), 5000);
  assert.equal(achievementMetricValue("distinctRoles", ctx), 2);
  assert.equal(achievementMetricValue("inboxZero", ctx), 1);
  assert.equal(achievementMetricValue("inboxZero", { ...ctx, totalLinesOfCode: 10 }), 0);
  assert.equal(achievementMetricValue("brokeWithPayroll", ctx), 0);
  assert.equal(
    achievementMetricValue("brokeWithPayroll", { ...ctx, employees: { intern: 10 } }),
    1
  );
  const stalls = Array.from({ length: 9 }, () => ({ llama: "classic", lighting: "red" }));
  const farm = { owned: true, stalls, unlockedTypes: ["classic"] };
  assert.equal(achievementMetricValue("fullBarn", { farm }), 1);
  assert.equal(achievementMetricValue("allStallsRed", { farm }), 1);
  assert.equal(achievementMetricValue("llamaTypes", { farm }), 1);
  assert.equal(
    achievementMetricValue("dosesTaken", { subtracterall: { phase: "burst" } }),
    1
  );
});

test("achievementProgress reports the next threshold and the fraction toward it", () => {
  const a = withTiers({ internalAffairs: 2 });
  a.hires = { ...a.hires, intern: 7 };
  const p = achievementProgress("internalAffairs", { achievements: a });
  assert.equal(p.tier, 2);
  assert.equal(p.nextThreshold, 10);
  assert.equal(p.current, 7);
  assert.equal(p.fraction, 0.7);
  const done = achievementProgress("helloWorld", {
    achievements: withTiers({ helloWorld: 1 }),
  });
  assert.equal(done.complete, true);
  assert.equal(done.fraction, 1);
});

test("client save mapping: round-trips the record and sanitizes NaN on the way out", () => {
  const saveState = initialSaveState();
  saveState.achievements = withTiers({ helloWorld: 1 });
  const fields = saveStateToGameFields(saveState);
  assert.deepEqual(fields.achievements, saveState.achievements);
  const clientState = {
    ...fields,
    achievements: { ...fields.achievements, clicks: Number.NaN },
  };
  const out = stateToSaveState(clientState);
  assert.equal(out.achievements.clicks, 0);
  assert.equal(savePayloadError(out), null);
});

test("client pre-write check: a bad payload is caught before it is sent", () => {
  const good = initialSaveState();
  assert.equal(savePayloadError(good), null);
  assert.match(savePayloadError({ ...good, money: Number.NaN }), /money/);
  assert.match(
    savePayloadError({ ...good, achievements: { tiers: {} } }),
    /achievements/
  );
  // The sanitizer always yields a payload the shared rule accepts.
  assert.equal(
    achievementsStateError(sanitizeAchievementsState({ clicks: "x", tiers: null })),
    null
  );
});

test("an earned tier is progress and a big action (it saves promptly)", () => {
  const initial = initialSaveState();
  assert.equal(isInitialSaveState(initial), true);
  const earned = { ...initial, achievements: withTiers({ helloWorld: 1 }) };
  assert.equal(isInitialSaveState(earned), false);
  assert.equal(
    bigActionIncreased(bigActionFields(initial), bigActionFields(earned)),
    true
  );
  const clicked = { ...initial, achievements: recordClicks(initial.achievements, 1) };
  assert.equal(isInitialSaveState(clicked), false);
});

test("the achievement email batches every tier from one action into one mail", () => {
  const mail = buildAchievementEmail({
    unlocked: [
      { id: "internalAffairs", tier: 1 },
      { id: "internalAffairs", tier: 2 },
      { id: "helloWorld", tier: 1 },
    ],
  });
  assert.equal(mail.subject, "3 achievements unlocked");
  assert.match(mail.body, /Intern-al Affairs I: \+1% LOC/);
  assert.match(mail.body, /Intern-al Affairs II: \+2% LOC/);
  assert.match(mail.body, /Hello, World: \+1% LOC/);
  const single = buildAchievementEmail({ unlocked: [{ id: "helloWorld", tier: 1 }] });
  assert.equal(single.subject, "Achievement unlocked: Hello, World");
});
