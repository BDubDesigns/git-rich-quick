/**
 * The cash economy (issue #244, the design on issue #200), with the
 * sell side floating again (Brandon's playtest verdict on #245: a
 * llama's price should not be fixed at the time it arrived).
 *
 * One cash basis, S = 21 cents x P, from one helper
 * (cashBasisCentsPerSecond). Night Shift levels cost 10 / 15 / 20 /
 * 30 / 45 minutes of S; the barn and llamas cost seconds of S. A llama
 * sells for its TYPE's sellSeconds x S at the CURRENT P
 * (llamaSellPriceCents), the same for bought and born llamas. Nothing
 * is stored on a stall. No schema bump and no wipe: a stall written by
 * the stored-value build carries a `sellCents` key, which is stripped
 * on load and on save, and tolerated by the validator.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { createStore, SAVE_SCHEMA_VERSION } from "../src/store.js";
import { createServer } from "../src/server.js";
import { validateSave, validateSeedState } from "../src/validate.js";
import * as shared from "../../shared/game-balance.js";
import {
  BALANCE,
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FREELANCE_PROJECT_KEYS,
  LLAMA_ECONOMY,
  LLAMA_TYPES,
  NIGHT_SHIFT_CONFIG,
  OPEN_SOURCE_IDS,
  buffedLocPerSecond,
  cashBasisCentsPerSecond,
  farmPurchaseCostCents,
  initialFarmState,
  initialSaveState,
  llamaBuyPriceCents,
  llamaSellPriceCents,
  applyFarmBirths,
  moveFarmLlama,
  emptyFarmState,
  nightShiftPriceCents,
  normalizeSaveState,
  worstCentsPerLoc,
} from "../../shared/game-balance.js";
import { applyLlamaBuy } from "../../client/src/utils/llamaShop.js";
import {
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

/** Sampled P values: the floor, early, the Nov 20 save, the latest save. */
const SAMPLED_P = [0, 1_000, 9_210_000, 4_870_000_000];

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

function save(prevState, newState) {
  return validateSave(
    { state: prevState, savedAtMs: T0 },
    { playerId: PLAYER_ID, state: newState, actionsSinceLastSave: zeroActions() },
    T0 + 60_000
  );
}

/** A save at `interns` interns (P = interns, nothing else buffs it). */
function saveAt(interns) {
  const base = initialSaveState();
  return { ...base, employees: { ...base.employees, intern: interns } };
}

/**
 * An owned barn. With `sellCents` set, every stall carries the key the
 * stored-value build (#245) wrote: a llama a number, an empty stall
 * null. Live saves and stale cached clients have this shape today.
 */
function barnFarm(placed, { sellCents = false } = {}) {
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => {
      const stall = { llama: placed[i] ?? null, lighting: "red" };
      if (sellCents) stall.sellCents = placed[i] ? 4_242 : null;
      return stall;
    }),
    unlockedTypes: [...new Set(Object.values(placed))],
    unseenBirths: 0,
  };
}

// --- The basis ---

test("S is 21 cents x P, the worst freelance rate, derived from BALANCE", () => {
  const quantum = BALANCE.freelanceProjects.quantumToDoList;
  assert.equal(quantum.reward / quantum.loc, 21);
  assert.equal(worstCentsPerLoc(), 21);
  for (const key of FREELANCE_PROJECT_KEYS) {
    const p = BALANCE.freelanceProjects[key];
    assert.ok(p.reward / p.loc >= worstCentsPerLoc(), key);
  }
  assert.equal(cashBasisCentsPerSecond(100), 2_100);
  // Floored at 10 LOC/s, NaN-guarded, the same floor as before.
  assert.equal(cashBasisCentsPerSecond(0), 210);
  assert.equal(cashBasisCentsPerSecond(Number.NaN), 210);
  assert.equal(cashBasisCentsPerSecond(9_210_000), 193_410_000); // $1,934,100/s
});

test("the old production-value basis and the stored-value helpers are gone", () => {
  assert.equal(shared.farmProductionValueCentsPerSecond, undefined);
  assert.equal(LLAMA_ECONOMY.sellFraction, undefined);
  for (const name of [
    "boughtLlamaSellCents",
    "kidLlamaSellCents",
    "storedLlamaSellCents",
    "isLlamaSellCents",
    "legacyLlamaParSellCents",
    "LEGACY_LLAMA_PAR",
    "stampLegacyLlamaSellValues",
    "farmNeedsSellStamp",
  ]) {
    assert.equal(shared[name], undefined, name);
  }
  assert.equal(LLAMA_ECONOMY.kidProduceSeconds, undefined);
  assert.equal(LLAMA_ECONOMY.boughtSellFraction, undefined);
  // The float helper is back.
  assert.equal(typeof shared.llamaSellPriceCents, "function");
});

// --- Price tables at sampled P ---

test("Night Shift prices are 2.5 / 3.75 / 5 / 7.5 / 11.25 minutes of S at every sampled P (Brandon, Nov 21: a quarter of #244)", () => {
  const minutes = [2.5, 3.75, 5, 7.5, 11.25];
  assert.deepEqual(NIGHT_SHIFT_CONFIG.levels.map((l) => l.priceSeconds / 60), minutes);
  for (const p of SAMPLED_P) {
    minutes.forEach((m, i) => {
      assert.equal(
        nightShiftPriceCents(i + 1, p),
        Math.round(m * 60 * cashBasisCentsPerSecond(p)),
        `L${i + 1} at P=${p}`
      );
    });
  }
  // The proposal's dollar figures.
  assert.equal(nightShiftPriceCents(1, 1_000), 3_150_000); // $31,500
  assert.equal(nightShiftPriceCents(1, 4_870_000_000), 15_340_500_000_000); // $153.4B
});

test("Night Shift rates, caps and gates are unchanged", () => {
  assert.deepEqual(
    NIGHT_SHIFT_CONFIG.levels.map((l) => [l.rate, l.capHours, { ...l.gate }]),
    [
      [0.1, 4, { minLocPerSecond: 100, employeeType: "junior", employeeCount: 10 }],
      [0.2, 8, { minLocPerSecond: 1_000, employeeType: "senior", employeeCount: 5 }],
      [0.3, 12, { minLocPerSecond: 10_000, employeeType: "projectManager", employeeCount: 10 }],
      [0.4, 16, { minLocPerSecond: 100_000, employeeType: "releaseManager", employeeCount: 10 }],
      [0.5, 24, { minLocPerSecond: 1_000_000, employeeType: "senior", employeeCount: 25 }],
    ]
  );
  // The permanent store's contract stays 2 Equity.
  assert.deepEqual([...shared.PRESTIGE_STORE_CONFIG.nightShiftContract.rankCosts], [2]);
});

test("farm buy prices are seconds of S at every sampled P", () => {
  const table = { mama: 20, classic: 30, drama: 40, spaghetti: 80, quantum: 120, blockchain: 200, ai: 300 };
  assert.equal(LLAMA_ECONOMY.barnSeconds, 60);
  assert.deepEqual({ ...LLAMA_ECONOMY.typeSeconds }, table);
  for (const p of SAMPLED_P) {
    const s = cashBasisCentsPerSecond(p);
    assert.equal(farmPurchaseCostCents(p), Math.round(60 * s), `barn at P=${p}`);
    for (const [type, seconds] of Object.entries(table)) {
      assert.equal(llamaBuyPriceCents(type, p), Math.round(seconds * s), `${type} at P=${p}`);
    }
  }
  // The proposal's figures: the barn at P = 1,000, a Classic on the Nov 20 save.
  assert.equal(farmPurchaseCostCents(1_000), 1_260_000); // $12,600
  assert.equal(llamaBuyPriceCents("classic", 9_210_000), 5_802_300_000); // $58.02M
});

test("buy, barn and Night Shift numbers are pinned at P = 9.21M", () => {
  const p = 9_210_000;
  assert.equal(farmPurchaseCostCents(p), 11_604_600_000);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((level) => nightShiftPriceCents(level, p)),
    [29_011_500_000, 43_517_250_000, 58_023_000_000, 87_034_500_000, 130_551_750_000]
  );
  assert.deepEqual(
    Object.fromEntries(LLAMA_TYPES.map((type) => [type, llamaBuyPriceCents(type, p)])),
    {
      classic: 5_802_300_000,
      drama: 7_736_400_000,
      mama: 3_868_200_000,
      spaghetti: 15_472_800_000,
      quantum: 23_209_200_000,
      blockchain: 38_682_000_000,
      ai: 58_023_000_000,
    }
  );
});

// --- The floating sell price ---

const SELL_SECONDS = { mama: 4, classic: 6, drama: 8, spaghetti: 16, quantum: 24, blockchain: 40, ai: 60 };

test("a llama sells for sellSeconds x S at the current P, at every sampled P", () => {
  assert.deepEqual({ ...LLAMA_ECONOMY.sellSeconds }, SELL_SECONDS);
  for (const p of SAMPLED_P) {
    for (const [type, seconds] of Object.entries(SELL_SECONDS)) {
      assert.equal(
        llamaSellPriceCents(type, p),
        Math.round(seconds * cashBasisCentsPerSecond(p)),
        `${type} at P=${p}`
      );
    }
  }
  // The Nov 20 save: a Classic sells for $11,604,600, an AI for $116,046,000.
  assert.equal(llamaSellPriceCents("classic", 9_210_000), 1_160_460_000);
  assert.equal(llamaSellPriceCents("ai", 9_210_000), 11_604_600_000);
  // Unknown types and the floor.
  assert.equal(llamaSellPriceCents("unicorn", 9_210_000), 0);
  assert.equal(llamaSellPriceCents("classic", 0), 1260); // 6 x 210
  assert.equal(llamaSellPriceCents("classic", Number.NaN), 1260);
});

test("a llama's sell price rises when P rises", () => {
  for (const type of LLAMA_TYPES) {
    let last = -1;
    for (const p of [10, 1_000, 50_000, 9_210_000, 4_870_000_000]) {
      const price = llamaSellPriceCents(type, p);
      assert.ok(price > last, `${type} at P=${p}`);
      last = price;
    }
    assert.equal(llamaSellPriceCents(type, 100_000), 100 * llamaSellPriceCents(type, 1_000), type);
  }
});

test("every llama sells for one fifth of its buy price (Brandon, Nov 21)", () => {
  for (const type of LLAMA_TYPES) {
    assert.equal(LLAMA_ECONOMY.sellSeconds[type] * 5, LLAMA_ECONOMY.typeSeconds[type], type);
  }
});

test("sell price is always below that type's current buy price", () => {
  for (const type of LLAMA_TYPES) {
    assert.ok(LLAMA_ECONOMY.sellSeconds[type] > 0, type);
    assert.ok(LLAMA_ECONOMY.sellSeconds[type] < LLAMA_ECONOMY.typeSeconds[type], type);
    for (const p of [...SAMPLED_P, 1, 37, 123_456_789]) {
      assert.ok(
        llamaSellPriceCents(type, p) < llamaBuyPriceCents(type, p),
        `${type} at P=${p}`
      );
    }
  }
});

test("bought and born llamas of the same type sell for the same, and nothing is stored", () => {
  const p = 1_000;
  const price = llamaBuyPriceCents("classic", p);
  const bought = applyLlamaBuy({
    farm: initialFarmState(["classic"]),
    money: price,
    stallIndex: 4,
    type: "classic",
    buffedLocPerSec: p,
  });
  assert.equal(bought.money, 0);
  assert.deepEqual(bought.farm.stalls[4], { llama: "classic", lighting: "warm", locked: false, open: true });
  const bred = applyFarmBirths(bought.farm, [{ stallIndex: 5, type: "classic" }]);
  assert.deepEqual(bred.stalls[5], { llama: "classic", lighting: "warm", locked: false, open: true });
  // Same shape, same type, so one price; it follows P, not the day each arrived.
  for (const at of [p, p * 100]) {
    assert.equal(llamaSellPriceCents(bred.stalls[4].llama, at), llamaSellPriceCents(bred.stalls[5].llama, at));
  }
  const moved = moveFarmLlama(bred, 4, 1);
  assert.deepEqual(moved.stalls[1], { llama: "classic", lighting: "warm", locked: false, open: true });
  assert.deepEqual(moved.stalls[4], { llama: null, lighting: "warm", locked: false, open: true });
  // Issue #241: a fresh barn opens the starter stalls only.
  for (const stalls of [initialFarmState().stalls, emptyFarmState().stalls]) {
    for (const [i, stall] of stalls.entries()) {
      assert.deepEqual(stall, {
        llama: null,
        lighting: "warm",
        locked: false,
        open: FARM_CONFIG.starterStalls.includes(i),
      });
    }
  }
});

test("SELL_LLAMA pays the type's current sell price at the buffed P", () => {
  const context = src("context/GameContext.jsx");
  const sell = context.slice(
    context.indexOf('case "SELL_LLAMA": {'),
    context.indexOf('case "MOVE_LLAMA": {')
  );
  assert.match(sell, /const value = shared\.llamaSellPriceCents\(type, getBaseLocPerSecond\(state\)\);/);
  assert.match(sell, /money: state\.money \+ value,/);
  assert.doesNotMatch(sell, /sellCents|storedLlamaSellCents/);
  // No client source still names the stored-value machinery.
  for (const path of ["components/Farm.jsx", "context/GameContext.jsx", "utils/llamaShop.js", "save/serialize.js"]) {
    assert.doesNotMatch(
      src(path),
      /\.sellCents|sellCents:|storedLlamaSellCents|boughtLlamaSellCents|kidLlamaSellCents|stampLegacyLlamaSellValues|farmNeedsSellStamp/,
      path
    );
  }
  // The Farm card shows the floating price on the tile, the chip and the Sell button.
  const farmCard = src("components/Farm.jsx");
  assert.match(farmCard, /const selectedSellCents = selectedLlama\s*\?\s*llamaSellPriceCents\(selectedLlama, pricingRate\)/);
  assert.match(farmCard, /Sell \(\{formatMoney\(selectedSellCents \?\? 0\)\}\)/);
  // The compact tile shows the number only; "sells for" lives in the aria-label and the chip.
  assert.match(farmCard, /tabular-nums">\s*\{formatMoney\(llamaSellPriceCents\(stall\.llama, pricingRate\)\)\}/);
  assert.match(farmCard, /sells for \$\{formatMoney\(\s*llamaSellPriceCents\(stall\.llama, pricingRate\)\s*\)\}/);
  assert.match(farmCard, /The price follows\s+your shipping income/);
  assert.doesNotMatch(farmCard, /stays put|set the day it arrived|half of\s+what you paid/);
});

// --- Saves from the stored-value build: no bump, no wipe, strip sellCents ---

test("no schema bump: SAVE_SCHEMA_VERSION stays 3", () => {
  assert.equal(SAVE_SCHEMA_VERSION, 3);
});

test("normalizeSaveState strips sellCents and stays idempotent", () => {
  const withKey = { ...saveAt(100), farm: barnFarm({ 0: "classic", 1: "mama", 4: "ai" }, { sellCents: true }) };
  const normalized = normalizeSaveState(withKey);
  for (const stall of normalized.farm.stalls) {
    assert.deepEqual(Object.keys(stall).sort(), ["lighting", "llama", "locked", "open"]);
  }
  assert.equal(normalized.farm.stalls[4].llama, "ai");
  assert.equal(normalized.farm.stalls[4].lighting, "red");
  // The input is not mutated.
  assert.equal(withKey.farm.stalls[0].sellCents, 4_242);
  // Idempotent, and the same as a save that never had the key.
  assert.deepEqual(normalizeSaveState(normalized), normalized);
  const without = { ...saveAt(100), farm: barnFarm({ 0: "classic", 1: "mama", 4: "ai" }) };
  assert.deepEqual(normalizeSaveState(without), normalized);
  // The client load strips it too.
  const client = saveStateToGameFields(withKey);
  assert.deepEqual(client.farm.stalls, normalized.farm.stalls);
  assert.deepEqual(stateToSaveState(client).farm.stalls, normalized.farm.stalls);
});

test("the validator accepts a stall with or without sellCents, any value (stripped, not rejected)", () => {
  const plain = { ...saveAt(100), farm: barnFarm({ 0: "classic", 4: "ai" }) };
  const keyed = { ...saveAt(100), farm: barnFarm({ 0: "classic", 4: "ai" }, { sellCents: true }) };
  assert.equal(validateSeedState(plain).ok, true);
  assert.equal(validateSeedState(keyed).ok, true);
  // The stored state comes back stripped.
  assert.ok(validateSeedState(keyed).state.farm.stalls.every((s) => !("sellCents" in s)));
  // Whatever the old build wrote, even a value it would have rejected.
  for (const sellCents of [null, -1, 1.5, "500", 0, 123]) {
    const stalls = keyed.farm.stalls.map((s, i) => (i === 0 ? { ...s, sellCents } : s));
    assert.equal(validateSeedState({ ...keyed, farm: { ...keyed.farm, stalls } }).ok, true, String(sellCents));
  }
  // Every mix of stored and sent shape saves: a #245 row and a fresh client,
  // a fresh row and a stale cached client, and both stale.
  assert.equal(save(keyed, plain).ok, true);
  assert.equal(save(plain, keyed).ok, true);
  assert.equal(save(keyed, keyed).ok, true);
  assert.equal(save(plain, plain).ok, true);
});

test("a save with no farm, or an unbought one, is untouched", () => {
  const noFarm = saveAt(100);
  delete noFarm.farm;
  assert.deepEqual(normalizeSaveState(noFarm).farm, emptyFarmState());
  assert.equal(validateSeedState(noFarm).ok, true);
  const unbought = { ...saveAt(100), farm: { ...barnFarm({}, { sellCents: true }), owned: false, unlockedTypes: [] } };
  const normalized = normalizeSaveState(unbought);
  assert.deepEqual(normalized.farm.stalls, emptyFarmState().stalls.map((s) => ({ ...s, lighting: "red" })));
  assert.equal(validateSeedState(unbought).ok, true);
  assert.deepEqual(saveStateToGameFields(unbought).farm.stalls, normalized.farm.stalls);
});

// --- End to end: a #245 save loads and saves through the real server ---

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

test("end to end: a stored #245 save with sellCents loads without a wipe, saves stripped, and a stale client still saves", async () => {
  const srv = await startTestServer();
  try {
    const minted = await post(srv.base, "/api/player", {});
    assert.equal(minted.status, 201);
    const { playerId } = await minted.json();
    const old = {
      ...saveAt(100),
      employees: { ...saveAt(100).employees, senior: 10 },
      farm: barnFarm({ 0: "classic", 1: "mama", 4: "ai" }, { sellCents: true }),
    };
    await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [
      JSON.stringify(old),
      playerId,
    ]);
    const row = await srv.pool.query(`SELECT schema_version FROM git_saves WHERE player_id = $1`, [playerId]);
    assert.equal(row.rows[0].schema_version, 3);

    // Load: the stored save comes back, not a wipe.
    const loaded = await (await fetch(`${srv.base}/api/load?playerId=${playerId}`)).json();
    assert.equal(loaded.state.farm.owned, true);
    assert.deepEqual([0, 1, 4].map((i) => loaded.state.farm.stalls[i].llama), ["classic", "mama", "ai"]);

    // A fresh client strips the key on load and saves without it.
    const client = saveStateToGameFields(loaded.state);
    assert.ok(client.farm.stalls.every((s) => !("sellCents" in s)));
    srv.advance(60_000);
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: stateToSaveState({ ...loaded.state, ...client }),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const stored = await srv.pool.query(`SELECT state FROM git_saves WHERE player_id = $1`, [playerId]);
    const storedState = typeof stored.rows[0].state === "string" ? JSON.parse(stored.rows[0].state) : stored.rows[0].state;
    assert.ok(storedState.farm.stalls.every((s) => !("sellCents" in s)));
    assert.deepEqual([0, 1, 4].map((i) => storedState.farm.stalls[i].llama), ["classic", "mama", "ai"]);

    // A stale cached client (the #245 build) still sends sellCents: accepted.
    // The store keeps the sent state as is (unchanged behavior), so the
    // key may sit in the row until the next fresh-client save; every
    // reader strips it, and the next save validates.
    srv.advance(60_000);
    const stale = await post(srv.base, "/api/save", {
      playerId,
      state: { ...storedState, farm: barnFarm({ 0: "classic", 1: "mama", 4: "ai" }, { sellCents: true }) },
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(stale.status, 200, await stale.clone().text());
    const reloaded = await (await fetch(`${srv.base}/api/load?playerId=${playerId}`)).json();
    assert.deepEqual([0, 1, 4].map((i) => reloaded.state.farm.stalls[i].llama), ["classic", "mama", "ai"]);
    const reclient = saveStateToGameFields(reloaded.state);
    assert.ok(reclient.farm.stalls.every((s) => !("sellCents" in s)));
    srv.advance(60_000);
    const fresh = await post(srv.base, "/api/save", {
      playerId,
      state: stateToSaveState({ ...reloaded.state, ...reclient }),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(fresh.status, 200, await fresh.clone().text());
    const final = await srv.pool.query(`SELECT state FROM git_saves WHERE player_id = $1`, [playerId]);
    const finalState = typeof final.rows[0].state === "string" ? JSON.parse(final.rows[0].state) : final.rows[0].state;
    assert.ok(finalState.farm.stalls.every((s) => !("sellCents" in s)));
  } finally {
    await srv.stop();
  }
});

// --- Copy ---

test("zero em or en dashes in the player-facing copy this pass touched", () => {
  const farmCard = src("components/Farm.jsx");
  const nightShift = src("components/NightShiftCard.jsx");
  const email = shared.buildFarmPurchasedEmail().body;
  for (const [name, text] of [
    ["Farm.jsx", farmCard],
    ["NightShiftCard.jsx", nightShift],
    ["farm email", email],
  ]) {
    assert.ok(!text.includes("\u2014") && !text.includes("\u2013"), name);
  }
  assert.match(nightShift, /minutes of shipping income/);
  // The barn email describes floating prices, not frozen ones.
  assert.match(email, /a llama's price follows your shipping income/);
  assert.doesNotMatch(email, /half of what you paid|set the day/);
});
