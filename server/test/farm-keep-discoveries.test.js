/**
 * Issue #237: discovered llama types survive a company sale.
 *
 * Brandon (Nov 21, from play): "I had quantum llamas and they are gone
 * now." Discovery is knowledge, not inventory, like achievements and
 * cosmetics. A sale still resets the farm exactly as before (barn
 * ownership, stalls, llamas, lighting, the birth badge) EXCEPT
 * farm.unlockedTypes, which carries into the new company's farm.
 *
 * No save-shape change: unlockedTypes already exists. The server agrees
 * through two paths: the sale applies shared applyPrestigeSale itself,
 * and the shape check lets an unbought farm hold types once a company
 * has been sold. The consequences fall out of existing helpers: a
 * re-bought barn keeps the types (BUY_FARM passes them to
 * initialFarmState), llamaShopTypes sells them, and bred parents of a
 * kept type have kids of that type. The 10 Senior Developers gate still
 * applies per company.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { validateSeedState } from "../src/validate.js";
import {
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FREELANCE_PROJECT_KEYS,
  LLAMA_BASE_TYPES,
  LLAMA_TYPES,
  OPEN_SOURCE_IDS,
  applyPrestigeSale,
  emptyFarmState,
  equityThresholdLoc,
  farmStallNeighbours,
  farmUnlockConditionsMet,
  initialFarmState,
  initialSaveState,
  keptLlamaDiscoveries,
  llamaShopTypes,
  rollFarmKid,
} from "../../shared/game-balance.js";
import { applyLlamaBuy } from "../../client/src/utils/llamaShop.js";

const T0 = 1_700_000_000_000;

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

/** A sellable save whose barn holds quantum and spaghetti llamas under colored lights. */
function discoveredSave() {
  const pre = initialSaveState();
  pre.totalLinesOfCode = equityThresholdLoc(2);
  pre.employees = { ...pre.employees, senior: 12 };
  pre.farm = {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
      llama: i === 0 ? "quantum" : i === 1 ? "spaghetti" : i === 2 ? "classic" : null,
      lighting: i < 3 ? "red" : "blue",
    })),
    unlockedTypes: ["classic", "drama", "spaghetti", "quantum"],
    unseenBirths: 3,
  };
  return pre;
}

// --- The sale reset (pure) ---

test("a sale with discovered types keeps unlockedTypes while barn, stalls, llamas and lighting clear", () => {
  const pre = discoveredSave();
  const post = applyPrestigeSale(pre, randomUUID());
  assert.deepEqual(post.farm.unlockedTypes, ["classic", "drama", "spaghetti", "quantum"]);
  assert.equal(post.farm.owned, false);
  assert.equal(post.farm.stalls.length, FARM_CONFIG.stallCount);
  for (const stall of post.farm.stalls) {
    assert.deepEqual(stall, { llama: null, lighting: "warm" });
  }
  assert.equal(post.farm.unseenBirths, 0);
  // Everything but the types is exactly the old reset.
  assert.deepEqual({ ...post.farm, unlockedTypes: [] }, emptyFarmState());
  // A copy, not the sold farm's array.
  assert.notEqual(post.farm.unlockedTypes, pre.farm.unlockedTypes);
});

test("a sale with no discoveries behaves exactly as before", () => {
  const pre = initialSaveState();
  pre.totalLinesOfCode = equityThresholdLoc(2);
  pre.farm = { ...initialFarmState() };
  const post = applyPrestigeSale(pre, randomUUID());
  // The literal pre-#237 reset.
  assert.deepEqual(post.farm, {
    owned: false,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, () => ({
      llama: null,
      lighting: "warm",
    })),
    unlockedTypes: [],
    unseenBirths: 0,
  });
  // A never-bought farm sells the same way.
  const neverBought = initialSaveState();
  neverBought.totalLinesOfCode = equityThresholdLoc(2);
  assert.deepEqual(applyPrestigeSale(neverBought, randomUUID()).farm, emptyFarmState());
});

test("the kept list is known types only, no duplicates; junk keeps nothing", () => {
  assert.deepEqual(keptLlamaDiscoveries(["quantum", "quantum", "unicorn", "ai"]), ["quantum", "ai"]);
  assert.deepEqual(keptLlamaDiscoveries(undefined), []);
  assert.deepEqual(keptLlamaDiscoveries("quantum"), []);
  assert.deepEqual(emptyFarmState(), emptyFarmState([]));
  assert.deepEqual(initialFarmState().unlockedTypes, []);
});

test("discoveries survive two sales in a row", () => {
  const first = applyPrestigeSale(discoveredSave(), randomUUID());
  const again = { ...first, totalLinesOfCode: equityThresholdLoc(3), prestigeIntermission: null };
  const second = applyPrestigeSale(again, randomUUID());
  assert.deepEqual(second.farm.unlockedTypes, ["classic", "drama", "spaghetti", "quantum"]);
  assert.equal(second.farm.owned, false);
});

// --- The next company ---

test("the farm unlock gate still applies per company: 10 Senior Developers again", () => {
  const post = applyPrestigeSale(discoveredSave(), randomUUID());
  assert.equal(post.employees.senior, 0);
  assert.equal(farmUnlockConditionsMet(post), false);
  assert.equal(
    farmUnlockConditionsMet({ ...post, employees: { ...post.employees, senior: 9 } }),
    false
  );
  assert.equal(
    farmUnlockConditionsMet({ ...post, employees: { ...post.employees, senior: 10 } }),
    true
  );
  // BUY_FARM still checks the gate before it builds the barn.
  const reducer = src("context/GameContext.jsx");
  const buy = reducer.slice(reducer.indexOf('case "BUY_FARM"'));
  assert.ok(buy.indexOf("isFarmUnlockMet(state)") < buy.indexOf("shared.initialFarmState("));
});

test("re-buying the barn keeps the discoveries (BUY_FARM passes them through)", () => {
  assert.match(
    src("context/GameContext.jsx"),
    /farm: shared\.initialFarmState\(farm\.unlockedTypes\),/
  );
  const post = applyPrestigeSale(discoveredSave(), randomUUID());
  const rebought = initialFarmState(post.farm.unlockedTypes);
  assert.equal(rebought.owned, true);
  assert.deepEqual(rebought.unlockedTypes, ["classic", "drama", "spaghetti", "quantum"]);
  assert.ok(rebought.stalls.every((stall) => stall.llama === null));
});

test("the shop offers the persisted types after the barn is re-bought", () => {
  const post = applyPrestigeSale(discoveredSave(), randomUUID());
  const farm = initialFarmState(post.farm.unlockedTypes);
  const offered = llamaShopTypes(farm.unlockedTypes);
  assert.deepEqual(offered, ["classic", "drama", "mama", "spaghetti", "quantum"]);
  // Still undiscovered types stay out of the shop.
  assert.ok(!offered.includes("blockchain"));
  assert.ok(!offered.includes("ai"));
  // And a kept type actually buys.
  const bought = applyLlamaBuy({
    farm,
    money: 1e15,
    stallIndex: 0,
    type: "quantum",
    buffedLocPerSec: 100,
  });
  assert.ok(bought);
  assert.equal(bought.farm.stalls[0].llama, "quantum");
  // Without the fix (a fresh barn) the shop is back to the base types.
  assert.deepEqual(llamaShopTypes(initialFarmState().unlockedTypes), [...LLAMA_BASE_TYPES]);
});

test("kept types breed again: two quantum parents have a quantum kid", () => {
  const post = applyPrestigeSale(discoveredSave(), randomUUID());
  const farm = initialFarmState(post.farm.unlockedTypes);
  const stallIndex = 4;
  const [a, b] = farmStallNeighbours(stallIndex);
  farm.stalls[a].llama = "quantum";
  farm.stalls[b].llama = "quantum";
  // Rolls: the kid is born (0), the new-type roll fails (0.999), the parent pick (0).
  const rolls = [0, 0.999, 0];
  const kid = rollFarmKid(stallIndex, farm.stalls, farm.unlockedTypes, () => rolls.shift());
  assert.equal(kid, "quantum");
  // A discovery roll only reaches types still undiscovered.
  const discovery = [0, 0, 0];
  const found = rollFarmKid(stallIndex, farm.stalls, farm.unlockedTypes, () => discovery.shift());
  assert.ok(LLAMA_TYPES.includes(found));
  assert.ok(!farm.unlockedTypes.includes(found));
});

// --- The server agrees ---

test("shape check: an unbought farm may hold types after a sale, never before one", () => {
  const post = applyPrestigeSale(discoveredSave(), randomUUID());
  assert.equal(validateSeedState(post).ok, true);
  const firstCompany = initialSaveState();
  firstCompany.farm = emptyFarmState(["quantum"]);
  assert.deepEqual(validateSeedState(firstCompany), {
    ok: false,
    detail: "farm has unlocked types but is not owned",
  });
  // An unbought farm with llamas is still malformed after a sale.
  const stalls = post.farm.stalls.map((stall, i) => (i === 0 ? { ...stall, llama: "quantum" } : stall));
  assert.deepEqual(validateSeedState({ ...post, farm: { ...post.farm, stalls } }), {
    ok: false,
    detail: "farm has llamas but is not owned",
  });
});

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

async function startTestServer() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = createStore(pool);
  await store.ensureSchema();
  let nowMs = T0;
  const server = createServer(store, { clock: () => nowMs });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    pool,
    advance: (ms) => {
      nowMs += ms;
    },
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

async function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("end to end: sell with discoveries, start the next company, re-buy the barn, keep the types", async () => {
  const srv = await startTestServer();
  try {
    const minted = await post(srv.base, "/api/player", {});
    assert.equal(minted.status, 201);
    const { playerId } = await minted.json();
    const pre = discoveredSave();
    pre.linesOfCode = 1_000_000;
    pre.money = 2_000_000;
    await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [
      JSON.stringify(pre),
      playerId,
    ]);

    // The sale keeps the types; the server stores its own reset.
    const sold = await post(srv.base, "/api/save/sell", {
      playerId,
      saleId: randomUUID(),
      state: pre,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(sold.status, 200);
    const soldState = (await sold.json()).state;
    assert.deepEqual(soldState.farm, emptyFarmState(["classic", "drama", "spaghetti", "quantum"]));

    // The next company starts from that farm (a save with an unbought
    // farm holding types validates).
    srv.advance(2000);
    const started = await post(srv.base, "/api/save/intermission/complete", {
      playerId,
      state: soldState,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(started.status, 200);
    const company = (await started.json()).state;
    assert.deepEqual(company.farm.unlockedTypes, ["classic", "drama", "spaghetti", "quantum"]);

    // Re-buy the barn with the types kept: accepted.
    srv.advance(2000);
    const rebought = {
      ...company,
      employees: { ...company.employees, senior: 10 },
      farm: initialFarmState(company.farm.unlockedTypes),
    };
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: rebought,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200);

    // A barn that drops them (the pre-#237 BUY_FARM) is still rejected.
    srv.advance(2000);
    const dropped = await post(srv.base, "/api/save", {
      playerId,
      state: { ...rebought, farm: initialFarmState() },
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(dropped.status, 409);
    assert.match(JSON.stringify(await dropped.json()), /farm llama type unlock lost/);
  } finally {
    await srv.stop();
  }
});

test("the sale screen lists the discovered types as kept, with no dashes", () => {
  const sell = src("components/SellCompany.jsx");
  assert.match(sell, /discoveredTypesKept: \(farm\.unlockedTypes \?\? \[\]\)\.length,/);
  assert.match(sell, /discovered llama type\$\{preview\.discoveredTypesKept === 1 \? "" : "s"\}/);
  const start = sell.indexOf("Kept: {formatNumber");
  const copy = sell.slice(start, sell.indexOf("and your preferences.", start));
  assert.match(copy, /discoveredTypesKept/);
  assert.ok(!copy.includes("—") && !copy.includes("–"));
});
