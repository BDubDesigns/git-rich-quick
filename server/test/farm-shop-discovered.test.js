/**
 * Tests for issue #203: a discovered llama type stays buyable after the
 * last one is sold. Brandon, Nov 20: "Once discovered a llama should be
 * buyable again after sold like my quantum llama."
 *
 * The shop sells llamaShopTypes(farm.unlockedTypes): the base types
 * always, plus every discovered bred type, at the unchanged
 * llamaBuyPriceCents. Undiscovered bred types are not offered. The buy
 * rule (client/src/utils/llamaShop.js, called by the reducer) is
 * otherwise unchanged: farm owned, empty stall, the cash.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSave } from "../src/validate.js";
import {
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FREELANCE_PROJECT_KEYS,
  LLAMA_BASE_TYPES,
  LLAMA_ECONOMY,
  LLAMA_TYPES,
  OPEN_SOURCE_IDS,
  initialSaveState,
  llamaBuyPriceCents,
  llamaShopTypes,
} from "../../shared/game-balance.js";
import { applyLlamaBuy } from "../../client/src/utils/llamaShop.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
const BRED = LLAMA_TYPES.filter((type) => !LLAMA_BASE_TYPES.includes(type));
const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

/** An owned barn: llamas placed by stall index, plus extra discovered types. */
function farmWith(placed, discovered = []) {
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
      llama: placed[i] ?? null,
      lighting: "warm",
    })),
    unlockedTypes: [...new Set([...Object.values(placed), ...discovered])],
  };
}

function zeroActions() {
  const counts = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
  return {
    clicks: 0,
    employeesBought: counts(EMPLOYEE_TYPES),
    projectsCompleted: counts(FREELANCE_PROJECT_KEYS),
    autoShips: counts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: counts(OPEN_SOURCE_IDS),
  };
}

test("the shop always offers the base types, discovered or not", () => {
  for (const unlocked of [[], ["classic"], ["quantum"], [...LLAMA_TYPES]]) {
    for (const type of LLAMA_BASE_TYPES) {
      assert.ok(llamaShopTypes(unlocked).includes(type), `${type} with ${JSON.stringify(unlocked)}`);
    }
  }
  assert.deepEqual(llamaShopTypes([]), [...LLAMA_BASE_TYPES]);
  assert.deepEqual(llamaShopTypes(undefined), [...LLAMA_BASE_TYPES]);
  assert.deepEqual(llamaShopTypes("junk"), [...LLAMA_BASE_TYPES]);
});

test("a discovered bred type is offered with zero owned; an undiscovered one is not", () => {
  // Quantum discovered, then the last one sold: no Quantum in any stall.
  const farm = farmWith({ 0: "classic", 2: "drama" }, ["quantum"]);
  assert.ok(!farm.stalls.some((stall) => stall.llama === "quantum"), "zero Quantum owned");
  const shop = llamaShopTypes(farm.unlockedTypes);
  assert.ok(shop.includes("quantum"));
  for (const type of BRED.filter((t) => t !== "quantum")) {
    assert.ok(!shop.includes(type), `undiscovered ${type} not offered`);
  }
  // Every discovered bred type joins, in herd-book order, base types first.
  assert.deepEqual(llamaShopTypes(["ai", "spaghetti"]), [...LLAMA_BASE_TYPES, "spaghetti", "ai"]);
  assert.deepEqual(llamaShopTypes(LLAMA_TYPES), [...LLAMA_TYPES]);
});

test("buying a discovered type charges the shared helper's price and places it", () => {
  const rate = 1_000_000;
  const farm = farmWith({ 0: "classic" }, ["quantum"]);
  const price = llamaBuyPriceCents("quantum", rate);
  assert.ok(price > 0);
  const bought = applyLlamaBuy({ farm, money: price + 7, stallIndex: 4, type: "quantum", buffedLocPerSec: rate });
  assert.ok(bought, "the buy goes through");
  assert.equal(bought.price, price);
  assert.equal(bought.money, 7);
  assert.equal(bought.farm.stalls[4].llama, "quantum");
  assert.equal(bought.farm.stalls[4].lighting, "warm", "the stall keeps its lighting");
  assert.equal(bought.farm.stalls.filter((s) => s.llama).length, 2, "only that stall changes");
  assert.deepEqual(bought.farm.unlockedTypes.filter((t) => t === "quantum"), ["quantum"], "no duplicate unlock");
  // Exactly the price, at any rate: the helper is the only price.
  for (const r of [0, 10, 5_000, 2.39e9]) {
    const wallet = 1e15; // exact in a double, so the difference is exact
    const b = applyLlamaBuy({ farm, money: wallet, stallIndex: 1, type: "quantum", buffedLocPerSec: r });
    assert.equal(wallet - b.money, llamaBuyPriceCents("quantum", r));
  }
  // A base type buys exactly as before.
  const classic = applyLlamaBuy({ farm, money: 1e18, stallIndex: 1, type: "classic", buffedLocPerSec: rate });
  assert.equal(classic.price, llamaBuyPriceCents("classic", rate));
});

test("the existing rules apply unchanged: undiscovered, no barn, occupied stall, short cash, bad stall", () => {
  const rate = 1_000;
  const farm = farmWith({ 0: "classic" }, ["quantum"]);
  const rich = 1e18;
  assert.equal(applyLlamaBuy({ farm, money: rich, stallIndex: 3, type: "ai", buffedLocPerSec: rate }), null, "undiscovered");
  assert.equal(applyLlamaBuy({ farm: { ...farm, owned: false }, money: rich, stallIndex: 3, type: "quantum", buffedLocPerSec: rate }), null, "no barn");
  assert.equal(applyLlamaBuy({ farm, money: rich, stallIndex: 0, type: "quantum", buffedLocPerSec: rate }), null, "occupied");
  const price = llamaBuyPriceCents("quantum", rate);
  assert.equal(applyLlamaBuy({ farm, money: price - 1, stallIndex: 3, type: "quantum", buffedLocPerSec: rate }), null, "short cash");
  assert.ok(applyLlamaBuy({ farm, money: price, stallIndex: 3, type: "quantum", buffedLocPerSec: rate }), "exact cash");
  for (const stallIndex of [-1, FARM_CONFIG.stallCount, 1.5, "2", undefined]) {
    assert.equal(applyLlamaBuy({ farm, money: rich, stallIndex, type: "quantum", buffedLocPerSec: rate }), null, String(stallIndex));
  }
  assert.equal(applyLlamaBuy({ farm, money: rich, stallIndex: 3, type: "unicorn", buffedLocPerSec: rate }), null);
});

test("no economy change from #203: the price table is the #244 table", () => {
  assert.deepEqual({ ...LLAMA_ECONOMY.typeSeconds }, {
    mama: 20,
    classic: 30,
    drama: 40,
    spaghetti: 80,
    quantum: 120,
    blockchain: 200,
    ai: 300,
  });
  assert.equal(LLAMA_ECONOMY.boughtSellFraction, 0.5);
});

test("the server accepts a save that re-bought a discovered Quantum", () => {
  const rate = 1_000;
  const price = llamaBuyPriceCents("quantum", rate);
  const prev = { ...initialSaveState(), money: price, farm: farmWith({ 0: "classic" }, ["quantum"]) };
  const bought = applyLlamaBuy({ farm: prev.farm, money: prev.money, stallIndex: 2, type: "quantum", buffedLocPerSec: rate });
  const next = { ...prev, money: bought.money, farm: bought.farm };
  const r = validateSave(
    { state: prev, savedAtMs: T0 },
    { playerId: PLAYER_ID, state: next, actionsSinceLastSave: zeroActions() },
    T0 + 60_000
  );
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("wiring: the reducer and the shop UI both read llamaShopTypes; the copy has no dashes", () => {
  const context = src("context/GameContext.jsx");
  assert.match(context, /const bought = applyLlamaBuy\(\{/);
  assert.ok(!/LLAMA_BASE_TYPES/.test(context), "the reducer no longer hardcodes the base list");
  const farm = src("components/Farm.jsx");
  assert.match(farm, /\{llamaShopTypes\(farm\.unlockedTypes\)\.map\(\(type\) => \{\s*const price = llamaBuyPriceCents\(type, pricingRate\);/);
  assert.match(farm, /const forSale = llamaShopTypes\(farm\.unlockedTypes\)\.includes\(type\);/);
  assert.ok(!/LLAMA_BASE_TYPES/.test(farm));
  assert.ok(!farm.includes("—") && !farm.includes("–"), "no em or en dashes in Farm.jsx");
  assert.match(farm, /a fancy type joins the shop once you\s*have bred one\./);
});
