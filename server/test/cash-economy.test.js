/**
 * The cash economy pass (issue #244, the design on issue #200 as
 * revised and decided).
 *
 * One cash basis, S = 21 cents x P, from one helper
 * (cashBasisCentsPerSecond). Night Shift levels cost 10 / 15 / 20 /
 * 30 / 45 minutes of S; the barn and llamas cost seconds of S. Every
 * llama stores its sell value in cents on its stall when it enters the
 * farm (half of the price paid, or produce seconds x S at birth) and
 * never recomputes it: the floating sell price is gone. No schema bump
 * and no wipe: a llama saved before stored values is stamped once at
 * par (what it sold for under the old rules), identically on client
 * and server, and the stamp persists.
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
  applyFarmBirths,
  boughtLlamaSellCents,
  buffedLocPerSecond,
  cashBasisCentsPerSecond,
  emptyFarmState,
  farmPurchaseCostCents,
  initialFarmState,
  initialSaveState,
  kidLlamaSellCents,
  legacyLlamaParSellCents,
  llamaBuyPriceCents,
  moveFarmLlama,
  nightShiftPriceCents,
  normalizeSaveState,
  storedLlamaSellCents,
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
 * A pre-#244 owned barn: stalls carry llama and lighting only, no
 * stored sell value (the shape every live save has today).
 */
function legacyFarm(placed) {
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
      llama: placed[i] ?? null,
      lighting: "red",
    })),
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

test("the old production-value basis and the float helper are gone from the shared module", () => {
  assert.equal(shared.farmProductionValueCentsPerSecond, undefined);
  assert.equal(shared.llamaSellPriceCents, undefined);
  assert.equal(LLAMA_ECONOMY.sellFraction, undefined);
});

// --- Price tables at sampled P ---

test("Night Shift prices are 10 / 15 / 20 / 30 / 45 minutes of S at every sampled P", () => {
  const minutes = [10, 15, 20, 30, 45];
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
  assert.equal(nightShiftPriceCents(1, 1_000), 12_600_000); // $126,000
  assert.equal(nightShiftPriceCents(1, 4_870_000_000), 61_362_000_000_000); // $613.6B
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

test("kid values are the flat produce ladder in seconds of S at every sampled P", () => {
  const ladder = { mama: 1, classic: 1.5, drama: 2, spaghetti: 3, quantum: 4, blockchain: 5, ai: 6 };
  assert.deepEqual({ ...LLAMA_ECONOMY.kidProduceSeconds }, ladder);
  for (const p of SAMPLED_P) {
    for (const [type, seconds] of Object.entries(ladder)) {
      assert.equal(
        kidLlamaSellCents(type, p),
        Math.round(seconds * cashBasisCentsPerSecond(p)),
        `${type} kid at P=${p}`
      );
    }
  }
  // Revision 2's figure: a Classic kid on the Nov 20 save is $2,901,150.
  assert.equal(kidLlamaSellCents("classic", 9_210_000), 290_115_000);
  assert.equal(kidLlamaSellCents("unicorn", 9_210_000), 0);
});

// --- Stored value invariants ---

test("a bought llama stores half of what was paid and sells for that after P grows 100x", () => {
  const p = 1_000;
  const price = llamaBuyPriceCents("classic", p);
  const bought = applyLlamaBuy({
    farm: initialFarmState(),
    money: price,
    stallIndex: 4,
    type: "classic",
    buffedLocPerSec: p,
  });
  assert.equal(bought.money, 0);
  assert.equal(bought.farm.stalls[4].sellCents, boughtLlamaSellCents(price));
  assert.equal(bought.farm.stalls[4].sellCents, Math.floor(price / 2));

  // P grows 100x: the save normalizes, loads and saves at the new P,
  // and the llama still sells for half of what was paid.
  const grown = { ...saveAt(p * 100), farm: bought.farm };
  assert.equal(buffedLocPerSecond(grown), p * 100);
  const normalized = normalizeSaveState(grown);
  assert.equal(storedLlamaSellCents(normalized.farm.stalls[4]), Math.floor(price / 2));
  const loaded = saveStateToGameFields(normalized);
  assert.equal(storedLlamaSellCents(loaded.farm.stalls[4]), Math.floor(price / 2));
  const resaved = stateToSaveState(loaded);
  assert.equal(resaved.farm.stalls[4].sellCents, Math.floor(price / 2));
  // Today's buy price is 100x, and the sell value ignores it.
  assert.equal(llamaBuyPriceCents("classic", p * 100), price * 100);
});

test("a kid's value is fixed at its birth P and does not move when P moves", () => {
  const bornAt = 50_000;
  const farm = initialFarmState(["classic"]);
  farm.stalls[0] = { ...farm.stalls[0], llama: "classic", sellCents: 1 };
  farm.stalls[2] = { ...farm.stalls[2], llama: "mama", sellCents: 1 };
  const bred = applyFarmBirths(farm, [{ stallIndex: 1, type: "classic" }], {
    buffedLocPerSec: bornAt,
  });
  const value = kidLlamaSellCents("classic", bornAt);
  assert.equal(bred.stalls[1].sellCents, value);
  // A second kid born later, at a higher P, is worth more; the first is not touched.
  const later = applyFarmBirths(bred, [{ stallIndex: 3, type: "classic" }], {
    buffedLocPerSec: bornAt * 10,
  });
  assert.equal(later.stalls[1].sellCents, value);
  assert.equal(later.stalls[3].sellCents, kidLlamaSellCents("classic", bornAt * 10));
  // Two llamas of one type, two different values: each stall keeps its own.
  assert.notEqual(later.stalls[1].sellCents, later.stalls[3].sellCents);
  // Through normalize and a load at a very different P, still the birth value.
  for (const p of [10, bornAt * 1_000]) {
    const loaded = saveStateToGameFields(normalizeSaveState({ ...saveAt(p), farm: later }));
    assert.equal(loaded.farm.stalls[1].sellCents, value, `P=${p}`);
  }
});

test("moving a llama keeps its value and leaves the old stall without one", () => {
  const farm = initialFarmState(["ai"]);
  farm.stalls[0] = { ...farm.stalls[0], llama: "ai", sellCents: 123_456 };
  const moved = moveFarmLlama(farm, 0, 8);
  assert.deepEqual(moved.stalls[8], { llama: "ai", lighting: "warm", sellCents: 123_456 });
  assert.deepEqual(moved.stalls[0], { llama: null, lighting: "warm", sellCents: null });
  const before = { ...saveAt(100), farm };
  assert.equal(save(before, { ...before, farm: moved }).ok, true);
});

test("the float path is gone: selling reads only the stored value", () => {
  // The helper: the stored value or nothing, never a current price.
  assert.equal(storedLlamaSellCents({ llama: "classic", lighting: "warm", sellCents: 777 }), 777);
  assert.equal(storedLlamaSellCents({ llama: "classic", lighting: "warm", sellCents: null }), null);
  assert.equal(storedLlamaSellCents({ llama: "classic", lighting: "warm" }), null);
  assert.equal(storedLlamaSellCents({ llama: null, lighting: "warm", sellCents: null }), null);
  // The reducer's SELL_LLAMA pays the stored value and reads no price or P.
  const context = src("context/GameContext.jsx");
  const sell = context.slice(
    context.indexOf('case "SELL_LLAMA": {'),
    context.indexOf('case "MOVE_LLAMA": {')
  );
  assert.match(sell, /const value = shared\.storedLlamaSellCents\(farm\.stalls\[stallIndex\]\);/);
  assert.match(sell, /if \(value === null\) return state;/);
  assert.match(sell, /money: state\.money \+ value,/);
  assert.doesNotMatch(sell, /getBaseLocPerSecond|llamaBuyPriceCents|PriceCents/);
  // No source anywhere still computes a sell price from a current price.
  for (const path of ["components/Farm.jsx", "context/GameContext.jsx", "utils/llamaShop.js", "save/serialize.js"]) {
    assert.doesNotMatch(src(path), /llamaSellPriceCents|farmProductionValueCentsPerSecond|sellFraction\b/, path);
  }
  const balance = readFileSync(new URL("../../shared/game-balance.js", import.meta.url), "utf8");
  assert.doesNotMatch(balance, /llamaSellPriceCents|farmProductionValueCentsPerSecond/);
  // The Farm card's Sell button and stall tiles show the stored value.
  const farmCard = src("components/Farm.jsx");
  assert.match(farmCard, /const selectedSellCents = storedLlamaSellCents\(selected\);/);
  assert.match(farmCard, /Sell \(\{formatMoney\(selectedSellCents \?\? 0\)\}\)/);
  assert.match(farmCard, /Sells for \{formatMoney\(storedLlamaSellCents\(stall\) \?\? 0\)\}/);
});

test("the shape check: a llama needs a whole-cent value, an empty stall needs null", () => {
  const farm = initialFarmState(["classic"]);
  farm.stalls[0] = { ...farm.stalls[0], llama: "classic", sellCents: 500 };
  const ok = { ...saveAt(100), farm };
  assert.equal(validateSeedState(ok).ok, true);
  const bad = (stall) => {
    const stalls = farm.stalls.map((s, i) => (i === 0 ? { ...s, ...stall } : s));
    return validateSeedState({ ...ok, farm: { ...farm, stalls } });
  };
  for (const sellCents of [null, -1, 1.5, "500", Number.NaN]) {
    assert.equal(bad({ sellCents }).ok, false, String(sellCents));
  }
  assert.equal(bad({ llama: null, sellCents: 500 }).ok, false, "an empty stall with a value");
  assert.equal(bad({ llama: null, sellCents: null }).ok, true);
});

// --- Legacy saves: no bump, no wipe, a par stamp ---

test("no schema bump: SAVE_SCHEMA_VERSION stays 3", () => {
  assert.equal(SAVE_SCHEMA_VERSION, 3);
});

test("par is exactly the old rules' sell price: half of 60 cents x P x the old seconds", () => {
  const oldSeconds = { mama: 60, classic: 90, drama: 120, spaghetti: 240, quantum: 360, blockchain: 600, ai: 900 };
  for (const p of SAMPLED_P) {
    const b = Math.max(10, p) * 60;
    for (const [type, seconds] of Object.entries(oldSeconds)) {
      assert.equal(legacyLlamaParSellCents(type, p), Math.floor(Math.round(seconds * b) / 2), `${type} at P=${p}`);
    }
  }
  // #200's Nov 20 save: a Classic sold for $248.67M the moment before the build.
  assert.equal(legacyLlamaParSellCents("classic", 9_210_000), 24_867_000_000);
  assert.equal(legacyLlamaParSellCents("unicorn", 100), 0);
});

test("a legacy v3 save with unstamped llamas stamps at par once, the same on client and server", () => {
  const legacy = { ...saveAt(100), farm: legacyFarm({ 0: "classic", 1: "mama", 4: "ai" }) };
  const p = buffedLocPerSecond(legacy);
  assert.equal(p, 100);
  // Server: normalize stamps each llama at par, each empty stall at null.
  const server = normalizeSaveState(legacy);
  assert.equal(server.farm.stalls[0].sellCents, legacyLlamaParSellCents("classic", p));
  assert.equal(server.farm.stalls[0].sellCents, 270_000); // half of 90 x 100 x 60
  assert.equal(server.farm.stalls[1].sellCents, 180_000);
  assert.equal(server.farm.stalls[4].sellCents, 2_700_000);
  for (const i of [2, 3, 5, 6, 7, 8]) assert.equal(server.farm.stalls[i].sellCents, null);
  // The input is not mutated.
  assert.equal("sellCents" in legacy.farm.stalls[0], false);
  // Client: the load stamps the same numbers.
  const client = saveStateToGameFields(legacy);
  assert.deepEqual(
    client.farm.stalls.map((s) => s.sellCents),
    server.farm.stalls.map((s) => s.sellCents)
  );
  // The validator accepts the legacy save as the stored state and as the sent state.
  assert.equal(validateSeedState(legacy).ok, true);
  assert.equal(save(legacy, legacy).ok, true);
  assert.equal(save(legacy, stateToSaveState(client)).ok, true);
  // Exactly once: a stamped save at a 100x P keeps the stamp.
  const grown = { ...stateToSaveState(client), employees: { ...legacy.employees, intern: 10_000 } };
  assert.equal(buffedLocPerSecond(grown), 10_000);
  assert.deepEqual(
    normalizeSaveState(grown).farm.stalls.map((s) => s.sellCents),
    server.farm.stalls.map((s) => s.sellCents)
  );
  assert.deepEqual(
    saveStateToGameFields(grown).farm.stalls.map((s) => s.sellCents),
    server.farm.stalls.map((s) => s.sellCents)
  );
  // Normalize is idempotent.
  assert.deepEqual(normalizeSaveState(server), server);
});

test("a legacy stamp reads the save's buffed P, the same on client and server", () => {
  const base = saveAt(100);
  const a = shared.zeroAchievementsState();
  const legacy = {
    ...base,
    lifetimeEquityEarned: 10, // Founder 2x
    achievements: { ...a, tiers: { ...a.tiers, legacyCode: 6 } }, // +21%
    farm: legacyFarm({ 0: "quantum", 2: "classic" }),
  };
  const p = buffedLocPerSecond(legacy);
  assert.equal(p, 242);
  const server = normalizeSaveState(legacy).farm.stalls[0].sellCents;
  assert.equal(server, legacyLlamaParSellCents("quantum", 242));
  assert.equal(saveStateToGameFields(legacy).farm.stalls[0].sellCents, server);
});

test("a legacy v3 save with no farm, or an unbought one, is untouched", () => {
  const noFarm = saveAt(100);
  delete noFarm.farm;
  assert.deepEqual(normalizeSaveState(noFarm).farm, emptyFarmState());
  assert.equal(validateSeedState(noFarm).ok, true);
  // An unbought legacy farm: every stall empty, so every stamp is null.
  const unbought = { ...saveAt(100), farm: { ...legacyFarm({}), owned: false, unlockedTypes: [] } };
  const normalized = normalizeSaveState(unbought);
  assert.ok(normalized.farm.stalls.every((s) => s.llama === null && s.sellCents === null));
  assert.equal(validateSeedState(unbought).ok, true);
  assert.deepEqual(saveStateToGameFields(unbought).farm.stalls, normalized.farm.stalls);
});

// --- End to end: the stamp persists through the real server ---

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

test("end to end: a stored legacy v3 save loads, stamps at par, saves, and the stamp survives the round trip", async () => {
  const srv = await startTestServer();
  try {
    const minted = await post(srv.base, "/api/player", {});
    assert.equal(minted.status, 201);
    const { playerId } = await minted.json();
    const legacy = {
      ...saveAt(100),
      employees: { ...saveAt(100).employees, senior: 10 },
      farm: legacyFarm({ 0: "classic", 1: "mama", 4: "ai" }),
    };
    await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [
      JSON.stringify(legacy),
      playerId,
    ]);
    const row = await srv.pool.query(`SELECT schema_version FROM git_saves WHERE player_id = $1`, [playerId]);
    assert.equal(row.rows[0].schema_version, 3);

    // Load: the server hands back the stored (unstamped) save, not a wipe.
    const loaded = await (await fetch(`${srv.base}/api/load?playerId=${playerId}`)).json();
    assert.equal(loaded.state.farm.owned, true);
    assert.equal(loaded.state.farm.stalls[0].llama, "classic");
    const p = buffedLocPerSecond(loaded.state);
    const par = [0, 1, 4].map((i) => legacyLlamaParSellCents(loaded.state.farm.stalls[i].llama, p));

    // The client stamps on load and saves the stamp.
    const client = saveStateToGameFields(loaded.state);
    assert.deepEqual([0, 1, 4].map((i) => client.farm.stalls[i].sellCents), par);
    srv.advance(60_000);
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: stateToSaveState({ ...loaded.state, ...client }),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200, await saved.clone().text());

    // The stored save carries the stamp now.
    const stored = await srv.pool.query(`SELECT state FROM git_saves WHERE player_id = $1`, [playerId]);
    const storedState = typeof stored.rows[0].state === "string" ? JSON.parse(stored.rows[0].state) : stored.rows[0].state;
    assert.deepEqual([0, 1, 4].map((i) => storedState.farm.stalls[i].sellCents), par);

    // P grows 100x and the next load and save keep the stamp exactly.
    srv.advance(60_000);
    const grown = { ...storedState, employees: { ...storedState.employees, intern: 30_000 } };
    const grownSave = await post(srv.base, "/api/save", {
      playerId,
      state: grown,
      actionsSinceLastSave: { ...zeroActions(), employeesBought: { ...zeroActions().employeesBought, intern: 29_900 } },
    });
    assert.equal(grownSave.status, 200, await grownSave.clone().text());
    const reloaded = await (await fetch(`${srv.base}/api/load?playerId=${playerId}`)).json();
    assert.ok(buffedLocPerSecond(reloaded.state) >= 100 * p);
    assert.deepEqual([0, 1, 4].map((i) => reloaded.state.farm.stalls[i].sellCents), par);
    assert.deepEqual(
      [0, 1, 4].map((i) => saveStateToGameFields(reloaded.state).farm.stalls[i].sellCents),
      par
    );
  } finally {
    await srv.stop();
  }
});

// --- Copy ---

test("zero em or en dashes in the player-facing copy this pass touched", () => {
  const farmCard = src("components/Farm.jsx");
  const nightShift = src("components/NightShiftCard.jsx");
  for (const [name, text] of [
    ["Farm.jsx", farmCard],
    ["NightShiftCard.jsx", nightShift],
    ["farm email", shared.buildFarmPurchasedEmail().body],
  ]) {
    assert.ok(!text.includes("—") && !text.includes("–"), name);
  }
  assert.match(nightShift, /minutes of shipping income/);
  assert.match(shared.buildFarmPurchasedEmail().body, /sells back for half of what you paid/);
  for (const type of LLAMA_TYPES) assert.ok(LLAMA_ECONOMY.kidProduceSeconds[type] > 0, type);
});
