/**
 * Tests for the llama economy v2 (issue #129): LOC/s-scaled dynamic
 * pricing off the BUFFED passive rate, selling at half the CURRENT buy
 * value, moving llamas, the Mama Llama's breed boost, buy/sell
 * tracking through the achievements counters (issue #132), and the
 * server's rule that llamas only leave the barn through a recorded
 * sale.
 *
 * Anchor: R = 60 cents per LOC (the To Do List App, 50 LOC for $30).
 * P = buffedLocPerSecond (Founder and achievement buffs in). B = P x R.
 * A price is seconds x B; P is floored at 10 LOC/s for pricing only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave } from "../src/validate.js";
import {
  BALANCE,
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FARM_LIGHTING,
  FREELANCE_PROJECT_KEYS,
  LLAMA_BASE_TYPES,
  LLAMA_ECONOMY,
  LLAMA_TYPES,
  LLAMA_TYPE_DESCRIPTIONS,
  LLAMA_TYPE_NAMES,
  OPEN_SOURCE_IDS,
  achievementsStateError,
  bestCentsPerLoc,
  buffedLocPerSecond,
  evaluateAchievements,
  farmKidChance,
  farmLlamaCountsByType,
  cashBasisCentsPerSecond,
  farmPurchaseCostCents,
  initialSaveState,
  llamaBuyPriceCents,
  moveFarmLlama,
  normalizeSaveState,
  recordLlamaBought,
  recordLlamaSold,
  rollFarmKid,
  sumCounts,
  zeroAchievementsState,
} from "../../shared/game-balance.js";
import { collectTriggerEmails } from "../../client/src/email/email.js";
import { saveStateToGameFields } from "../../client/src/save/serialize.js";

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

/** An owned barn with the given llamas placed by stall index. */
function farmWith(placed, lighting = "warm") {
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
      llama: placed[i] ?? null,
      lighting,
    })),
    unlockedTypes: [...new Set(Object.values(placed))],
  };
}

function farmState(placed) {
  return { ...initialSaveState(), farm: farmWith(placed) };
}

test("R is 60 cents per LOC, derived from the To Do List App", () => {
  const todo = BALANCE.freelanceProjects.toDoListApp;
  assert.equal(todo.loc, 50);
  assert.equal(todo.reward, 3000);
  assert.equal(bestCentsPerLoc(), 60);
});

test("S is P x 21 cents, with P floored at the pricing minimum and NaN-guarded", () => {
  assert.equal(cashBasisCentsPerSecond(100), 2100);
  assert.equal(
    cashBasisCentsPerSecond(0),
    LLAMA_ECONOMY.minPricingLocPerSecond * 21
  );
  assert.equal(
    cashBasisCentsPerSecond(Number.NaN),
    LLAMA_ECONOMY.minPricingLocPerSecond * 21
  );
  assert.equal(cashBasisCentsPerSecond(-5), 210);
});

test("the barn is 60 x S (issue #244)", () => {
  assert.equal(LLAMA_ECONOMY.barnSeconds, 60);
  assert.equal(farmPurchaseCostCents(100), 60 * 2100);
});

test("every llama costs seconds of S, more advanced types cost more", () => {
  for (const type of LLAMA_TYPES) {
    const seconds = LLAMA_ECONOMY.typeSeconds[type];
    assert.ok(seconds >= 20, `${type} costs at least 20 seconds`);
    assert.ok(seconds <= 300, `${type} costs at most 5 minutes`);
  }
  const order = ["classic", "drama", "spaghetti", "quantum", "blockchain", "ai"];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(
      LLAMA_ECONOMY.typeSeconds[order[i]] > LLAMA_ECONOMY.typeSeconds[order[i - 1]],
      order[i]
    );
  }
  // The Mama Llama does not cost much: the cheapest type.
  const cheapest = Math.min(...Object.values(LLAMA_ECONOMY.typeSeconds));
  assert.equal(LLAMA_ECONOMY.typeSeconds.mama, cheapest);
  assert.equal(llamaBuyPriceCents("classic", 100), 30 * 2100);
  assert.equal(llamaBuyPriceCents("unicorn", 100), 0);
});

test("prices read the BUFFED rate: achievements and Founder raise them", () => {
  const base = initialSaveState();
  const plain = { ...base, employees: { ...base.employees, intern: 100 } };
  const a = zeroAchievementsState();
  const buffed = {
    ...plain,
    lifetimeEquityEarned: 10, // Founder 2x
    achievements: { ...a, tiers: { ...a.tiers, legacyCode: 6 } }, // +21%
  };
  assert.equal(buffedLocPerSecond(plain), 100);
  assert.equal(buffedLocPerSecond(buffed), 242);
  assert.ok(
    llamaBuyPriceCents("drama", buffedLocPerSecond(buffed)) >
      llamaBuyPriceCents("drama", buffedLocPerSecond(plain))
  );
  assert.equal(
    farmPurchaseCostCents(buffedLocPerSecond(buffed)),
    60 * 242 * 21
  );
});

test("the Mama Llama is a shop type, named and described, with no em dashes", () => {
  assert.ok(LLAMA_TYPES.includes("mama"));
  assert.ok(LLAMA_BASE_TYPES.includes("mama"));
  assert.equal(LLAMA_TYPE_NAMES.mama, "Mama Llama");
  assert.ok(LLAMA_TYPE_DESCRIPTIONS.mama.length > 0);
  for (const text of [LLAMA_TYPE_NAMES.mama, LLAMA_TYPE_DESCRIPTIONS.mama]) {
    assert.ok(!text.includes("—"));
  }
});

test("a stall beside a Mama Llama rolls kids 3x as often, capped at 90%", () => {
  assert.equal(farmKidChance("warm", ["classic", "drama"]), FARM_LIGHTING.warm.kidChance);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  close(farmKidChance("warm", ["classic", "mama"]), 0.45);
  close(farmKidChance("green", ["mama", "drama"]), 0.6);
  // Red is 30%: 3x would be 90%, exactly the cap; two mamas do not stack.
  close(farmKidChance("red", ["mama", "mama"]), 0.9);
});

test("rollFarmKid: a 0.3 roll fails without a Mama and succeeds with one", () => {
  // Stall 1 (top middle) has neighbours 0, 2 and 4.
  const plain = farmWith({ 0: "classic", 2: "classic" }).stalls;
  const withMama = farmWith({ 0: "classic", 2: "mama" }).stalls;
  const rolls = (values) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  const unlocked = LLAMA_TYPES.filter((t) => t !== "mama").concat("mama");
  assert.equal(rollFarmKid(1, plain, unlocked, rolls([0.3, 0.99, 0])), null);
  // With a mama: the kid takes the non-mama parent's type.
  assert.equal(rollFarmKid(1, withMama, unlocked, rolls([0.3, 0.99, 0.99])), "classic");
});

test("a mama-only nest has no kid; breeding never discovers a Mama", () => {
  // Brandon, Nov 21: Mamas are never bred.
  const mamas = farmWith({ 0: "mama", 2: "mama" }).stalls;
  assert.equal(rollFarmKid(1, mamas, LLAMA_TYPES, () => 0), null);
  // Nothing unlocked, and a forced new-type roll: the pool excludes mama.
  for (let k = 0; k < 6; k += 1) {
    const pick = k / 6 + 0.01;
    let call = 0;
    const rng = () => [0, 0, pick][call++];
    const kid = rollFarmKid(1, farmWith({ 0: "classic", 2: "drama" }).stalls, [], rng);
    assert.notEqual(kid, "mama");
  }
});

test("moveFarmLlama moves to an empty stall; lighting stays with the stall", () => {
  const farm = farmWith({ 0: "drama" });
  farm.stalls[0].lighting = "red";
  farm.stalls[5].lighting = "blue";
  const moved = moveFarmLlama(farm, 0, 5);
  assert.equal(moved.stalls[0].llama, null);
  assert.equal(moved.stalls[5].llama, "drama");
  assert.equal(moved.stalls[0].lighting, "red");
  assert.equal(moved.stalls[5].lighting, "blue");
  // The original is untouched (pure).
  assert.equal(farm.stalls[0].llama, "drama");
});

test("moveFarmLlama refuses bad moves", () => {
  const farm = farmWith({ 0: "drama", 1: "classic" });
  assert.equal(moveFarmLlama(farm, 0, 1), null, "occupied target");
  assert.equal(moveFarmLlama(farm, 3, 4), null, "empty source");
  assert.equal(moveFarmLlama(farm, 0, 0), null, "same stall");
  assert.equal(moveFarmLlama(farm, 0, 9), null, "out of range");
  assert.equal(moveFarmLlama(farm, 0, 1.5), null, "not an integer");
  assert.equal(moveFarmLlama({ ...farm, owned: false }, 0, 4), null, "unowned");
  assert.equal(moveFarmLlama(null, 0, 4), null, "no farm");
});

test("server: a move keeps every type's count and is accepted", () => {
  const before = farmState({ 0: "classic", 1: "drama" });
  const after = { ...before, farm: moveFarmLlama(before.farm, 0, 8) };
  assert.equal(save(before, after).ok, true);
});

test("server: a sale (llama gone, sale recorded, money up) is accepted", () => {
  const before = farmState({ 0: "classic", 1: "drama" });
  const after = {
    ...before,
    money: before.money + 1000,
    farm: { ...before.farm, stalls: before.farm.stalls.map((s, i) => (i === 0 ? { ...s, llama: null } : s)) },
    achievements: recordLlamaSold(before.achievements, "classic"),
  };
  assert.equal(save(before, after).ok, true);
});

test("server: a llama vanishing without a recorded sale is rejected", () => {
  const before = farmState({ 0: "classic", 1: "drama" });
  const after = {
    ...before,
    farm: { ...before.farm, stalls: before.farm.stalls.map((s, i) => (i === 0 ? { ...s, llama: null } : s)) },
  };
  const result = save(before, after);
  assert.equal(result.ok, false);
  assert.equal(result.rule, "MONOTONIC");
});

test("server: a sale recorded for the wrong type does not cover a vanished llama", () => {
  const before = farmState({ 0: "classic", 1: "drama" });
  const after = {
    ...before,
    farm: { ...before.farm, stalls: before.farm.stalls.map((s, i) => (i === 0 ? { ...s, llama: null } : s)) },
    achievements: recordLlamaSold(before.achievements, "drama"),
  };
  assert.equal(save(before, after).ok, false);
});

test("server: a llama swapping type in place needs a sale of the old type", () => {
  const before = farmState({ 0: "classic", 1: "drama" });
  const swapped = {
    ...before,
    farm: {
      ...before.farm,
      stalls: before.farm.stalls.map((s, i) => (i === 0 ? { ...s, llama: "ai" } : s)),
      unlockedTypes: [...before.farm.unlockedTypes, "ai"],
    },
  };
  assert.equal(save(before, swapped).ok, false);
  // Sold the classic, then a kid was born there: legitimate.
  const soldThenBred = {
    ...swapped,
    achievements: recordLlamaSold(before.achievements, "classic"),
  };
  assert.equal(save(before, soldThenBred).ok, true);
});

test("buy/sell tracking lands in the achievements counters (per type and total)", () => {
  let a = zeroAchievementsState();
  a = recordLlamaBought(a, "mama");
  a = recordLlamaBought(a, "classic");
  a = recordLlamaSold(a, "spaghetti");
  assert.equal(a.llamasBought.mama, 1);
  assert.equal(sumCounts(a.llamasBought), 2);
  assert.equal(sumCounts(a.llamasSold), 1);
  assert.equal(achievementsStateError(a), null);
  const { achievements } = evaluateAchievements(a, { achievements: a });
  assert.equal(achievements.tiers.buyLowSpitHigh, 1);
  assert.equal(achievements.tiers.noProbLlama, 1);
});

test("a record from before the Mama Llama gets its mama counters defaulted to 0", () => {
  const a = zeroAchievementsState();
  delete a.llamasBought.mama;
  delete a.llamasSold.mama;
  const normalized = normalizeSaveState({ ...initialSaveState(), achievements: a });
  assert.equal(normalized.achievements.llamasBought.mama, 0);
  assert.equal(normalized.achievements.llamasSold.mama, 0);
  assert.equal(achievementsStateError(normalized.achievements), null);
});

test("farmLlamaCountsByType counts every type, 0 when absent", () => {
  const counts = farmLlamaCountsByType(farmWith({ 0: "mama", 1: "mama", 4: "ai" }).stalls);
  assert.equal(counts.mama, 2);
  assert.equal(counts.ai, 1);
  assert.equal(counts.classic, 0);
  assert.deepEqual(Object.keys(counts), [...LLAMA_TYPES]);
});

test("buying a Mama Llama is a purchase, not a discovery (no new-type email)", () => {
  const base = saveStateToGameFields(initialSaveState());
  const prevState = { ...base, farm: { ...farmWith({}), unlockedTypes: [] } };
  const newState = {
    ...base,
    farm: { ...farmWith({ 0: "mama" }), unlockedTypes: ["mama"] },
  };
  const { emails } = collectTriggerEmails(prevState, newState);
  assert.equal(
    emails.filter((e) => e.triggerKey.startsWith("farm-new-type:")).length,
    0
  );
});
