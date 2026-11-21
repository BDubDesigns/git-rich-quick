/**
 * Lock a llama and Sell All (issue #240).
 *
 * A llama can be locked (parents, the Mama, a layout's buffers). Sell
 * All sells every llama that is NOT locked, in one action, at the same
 * floating price a single Sell pays (llamaSellPriceCents at the buffed
 * P), by running SELL_LLAMA once per sellable stall. Locked and empty
 * stalls are skipped; nothing sellable disables the button. The lock
 * belongs to the llama: a move carries it and the stall it left is
 * unlocked. A single Sell is unchanged (it works locked or not).
 *
 * Saves: a stall gains `locked` (boolean). No schema bump, no wipe: a
 * save from before the lock loads with every llama unlocked, through
 * normalizeSaveState, the client loader and the real server.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { createStore, SAVE_SCHEMA_VERSION } from "../src/store.js";
import { createServer } from "../src/server.js";
import { validateSave, validateSeedState } from "../src/validate.js";
import {
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  applyFarmBirths,
  buffedLocPerSecond,
  emptyFarmState,
  farmSellAllPreview,
  farmSellableStalls,
  initialFarmState,
  initialSaveState,
  llamaSellPriceCents,
  moveFarmLlama,
  normalizeSaveState,
  recordLlamaSold,
  toggleFarmLlamaLock,
} from "../../shared/game-balance.js";
import { applyLlamaBuy } from "../../client/src/utils/llamaShop.js";
import {
  bigActionFields,
  bigActionIncreased,
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
const SAMPLED_P = [0, 1_000, 9_210_000, 4_870_000_000];

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

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

/** A save at `interns` interns, with 10 seniors so the barn is unlocked. */
function saveAt(interns) {
  const base = initialSaveState();
  return { ...base, employees: { ...base.employees, intern: interns, senior: 10 } };
}

/**
 * An owned barn. `placed` maps a stall index to a type; `locked` lists
 * the locked stall indices. With `legacy`, stalls have no `locked` key
 * at all: the shape every save written before this issue has.
 */
function barnFarm(placed, { locked = [], legacy = false } = {}) {
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => {
      const stall = { llama: placed[i] ?? null, lighting: "warm" };
      if (!legacy) stall.locked = locked.includes(i);
      return stall;
    }),
    unlockedTypes: [...new Set(Object.values(placed))],
    unseenBirths: 0,
  };
}

const LAYOUT = { 0: "mama", 1: "classic", 3: "classic", 4: "drama", 8: "ai" };

// --- Saves: no bump, no wipe, every old llama unlocked ---

test("no schema bump: SAVE_SCHEMA_VERSION stays 3", () => {
  assert.equal(SAVE_SCHEMA_VERSION, 3);
});

test("an old save with no lock key loads with every llama unlocked, and normalize is idempotent", () => {
  const old = { ...saveAt(100), farm: barnFarm(LAYOUT, { legacy: true }) };
  const normalized = normalizeSaveState(old);
  for (const stall of normalized.farm.stalls) {
    assert.deepEqual(Object.keys(stall).sort(), ["lighting", "llama", "locked", "open"]);
    assert.equal(stall.locked, false);
  }
  assert.deepEqual(normalized.farm.stalls.map((s) => s.llama), barnFarm(LAYOUT).stalls.map((s) => s.llama));
  // The input is not mutated, and a second pass changes nothing.
  assert.ok(old.farm.stalls.every((s) => !("locked" in s)));
  assert.deepEqual(normalizeSaveState(normalized), normalized);
  // The same as a save written with every llama unlocked.
  assert.deepEqual(normalized, normalizeSaveState({ ...saveAt(100), farm: barnFarm(LAYOUT) }));
  // The client loader agrees, and its save writes the same stalls.
  const client = saveStateToGameFields(old);
  assert.deepEqual(client.farm.stalls, normalized.farm.stalls);
  assert.deepEqual(stateToSaveState(client).farm.stalls, normalized.farm.stalls);
  // And the server accepts it.
  assert.equal(validateSeedState(old).ok, true);
});

test("a lock survives normalize, the client load and the client save", () => {
  const locked = { ...saveAt(100), farm: barnFarm(LAYOUT, { locked: [0, 4] }) };
  const normalized = normalizeSaveState(locked);
  assert.deepEqual(normalized.farm.stalls.map((s) => s.locked), [true, false, false, false, true, false, false, false, false]);
  assert.deepEqual(normalizeSaveState(normalized), normalized);
  const client = saveStateToGameFields(locked);
  assert.deepEqual(client.farm.stalls, normalized.farm.stalls);
  assert.deepEqual(stateToSaveState(client).farm.stalls, normalized.farm.stalls);
  assert.equal(validateSeedState(locked).ok, true);
});

test("an empty stall is never locked; a non-boolean lock on a llama is rejected", () => {
  const farm = barnFarm(LAYOUT);
  farm.stalls[2].locked = true; // empty stall
  const normalized = normalizeSaveState({ ...saveAt(100), farm });
  assert.equal(normalized.farm.stalls[2].locked, false);
  assert.equal(saveStateToGameFields({ ...saveAt(100), farm }).farm.stalls[2].locked, false);
  // A tampered value on a llama is left for the shape check to reject.
  const bad = barnFarm(LAYOUT);
  bad.stalls[0].locked = "yes";
  assert.equal(normalizeSaveState({ ...saveAt(100), farm: bad }).farm.stalls[0].locked, "yes");
  const result = validateSeedState({ ...saveAt(100), farm: bad });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? result.error ?? JSON.stringify(result), /locked must be a boolean/);
});

test("the validator accepts old and new stall shapes in every mix", () => {
  const legacy = { ...saveAt(100), farm: barnFarm(LAYOUT, { legacy: true }) };
  const withLocks = { ...saveAt(100), farm: barnFarm(LAYOUT, { locked: [0, 1] }) };
  assert.equal(save(legacy, withLocks).ok, true);
  assert.equal(save(withLocks, legacy).ok, true); // a stale client that predates the lock
  assert.equal(save(withLocks, withLocks).ok, true);
  assert.equal(save(legacy, legacy).ok, true);
});

test("fresh barns and sold barns start with every stall unlocked", () => {
  for (const stalls of [initialFarmState().stalls, emptyFarmState().stalls]) {
    for (const [i, stall] of stalls.entries()) {
      // Issue #241: only the starter stalls are open in a fresh barn.
      assert.deepEqual(stall, {
        llama: null,
        lighting: "warm",
        locked: false,
        open: FARM_CONFIG.starterStalls.includes(i),
      });
    }
  }
});

// --- The lock (pure) ---

test("toggleFarmLlamaLock locks and unlocks a llama, never an empty stall", () => {
  const farm = barnFarm(LAYOUT);
  const locked = toggleFarmLlamaLock(farm, 1);
  assert.equal(locked.stalls[1].locked, true);
  assert.equal(locked.stalls[1].llama, "classic");
  assert.equal(farm.stalls[1].locked, false, "input not mutated");
  // Only that stall changed.
  locked.stalls.forEach((stall, i) => {
    if (i !== 1) assert.deepEqual(stall, farm.stalls[i]);
  });
  assert.equal(toggleFarmLlamaLock(locked, 1).stalls[1].locked, false);
  // Nothing to toggle: an empty stall, a bad index, an unowned barn.
  assert.equal(toggleFarmLlamaLock(farm, 2), null);
  for (const bad of [-1, 9, 1.5, "1", null, undefined]) {
    assert.equal(toggleFarmLlamaLock(farm, bad), null, String(bad));
  }
  assert.equal(toggleFarmLlamaLock({ ...farm, owned: false }, 1), null);
  assert.equal(toggleFarmLlamaLock(null, 1), null);
});

test("the lock goes with the llama on a move; the stall it left is unlocked", () => {
  const farm = barnFarm(LAYOUT, { locked: [4] });
  const moved = moveFarmLlama(farm, 4, 5);
  assert.deepEqual(moved.stalls[5], { llama: "drama", lighting: "warm", locked: true });
  assert.deepEqual(moved.stalls[4], { llama: null, lighting: "warm", locked: false });
  // An unlocked llama stays unlocked.
  const plain = moveFarmLlama(farm, 1, 2);
  assert.equal(plain.stalls[2].locked, false);
  assert.equal(plain.stalls[1].locked, false);
  // A move from a legacy stall (no key) reads as unlocked.
  const legacy = moveFarmLlama(barnFarm(LAYOUT, { legacy: true }), 1, 2);
  assert.equal(legacy.stalls[2].locked, false);
});

test("a bought or born llama arrives unlocked", () => {
  const farm = initialFarmState();
  const bought = applyLlamaBuy({ farm, money: 1e15, stallIndex: 1, type: "classic", buffedLocPerSec: 100 });
  assert.equal(bought.farm.stalls[1].locked, false);
  const bred = applyFarmBirths(barnFarm(LAYOUT, { locked: [0, 1] }), [{ stallIndex: 2, type: "classic" }]);
  assert.equal(bred.stalls[2].llama, "classic");
  assert.equal(bred.stalls[2].locked, false);
  // The parents keep their locks.
  assert.equal(bred.stalls[0].locked, true);
  assert.equal(bred.stalls[1].locked, true);
});

// --- What Sell All sells ---

test("Sell All picks every unlocked llama, skipping locked and empty stalls", () => {
  assert.deepEqual(farmSellableStalls(barnFarm(LAYOUT).stalls), [0, 1, 3, 4, 8]);
  assert.deepEqual(farmSellableStalls(barnFarm(LAYOUT, { locked: [0, 1, 3] }).stalls), [4, 8]);
  assert.deepEqual(farmSellableStalls(barnFarm(LAYOUT, { legacy: true }).stalls), [0, 1, 3, 4, 8]);
  // All locked, or no llamas: nothing to sell.
  assert.deepEqual(farmSellableStalls(barnFarm(LAYOUT, { locked: [0, 1, 3, 4, 8] }).stalls), []);
  assert.deepEqual(farmSellableStalls(initialFarmState().stalls), []);
  assert.deepEqual(farmSellableStalls(undefined), []);
});

test("the Sell All total is the sum of the single sell prices at the same P", () => {
  const stalls = barnFarm(LAYOUT, { locked: [0, 1] }).stalls;
  for (const p of SAMPLED_P) {
    const preview = farmSellAllPreview(stalls, p);
    assert.equal(preview.count, 3);
    assert.equal(
      preview.totalCents,
      llamaSellPriceCents("classic", p) + llamaSellPriceCents("drama", p) + llamaSellPriceCents("ai", p),
      `P = ${p}`
    );
  }
  assert.deepEqual(farmSellAllPreview(barnFarm(LAYOUT, { locked: [0, 1, 3, 4, 8] }).stalls, 9_210_000), { count: 0, totalCents: 0 });
});

test("selling never changes P, so the price on the button is the price paid", () => {
  // Sales only bump the lifetime sold counter; the achievement buff
  // reads stored tiers, so P is the same before and after every sale.
  const state = saveAt(100);
  const before = buffedLocPerSecond(state);
  const after = buffedLocPerSecond({ ...state, achievements: recordLlamaSold(state.achievements, "classic", 50) });
  assert.equal(after, before);
});

test("a Sell All save passes the server: every llama gone is a recorded sale; locked llamas stay", () => {
  const prev = { ...saveAt(100), farm: barnFarm(LAYOUT, { locked: [0, 1] }) };
  const prevNorm = normalizeSaveState(prev);
  let achievements = prevNorm.achievements;
  const stalls = prevNorm.farm.stalls.map((stall) => ({ ...stall }));
  for (const i of farmSellableStalls(stalls)) {
    achievements = recordLlamaSold(achievements, stalls[i].llama, 1);
    stalls[i] = { ...stalls[i], llama: null, locked: false };
  }
  const next = { ...prevNorm, achievements, farm: { ...prevNorm.farm, stalls } };
  assert.deepEqual(next.farm.stalls.map((s) => s.llama), ["mama", "classic", null, null, null, null, null, null, null]);
  assert.equal(save(prevNorm, next).ok, true);
  // Without the recorded sales the server still refuses it.
  assert.equal(save(prevNorm, { ...next, achievements: prevNorm.achievements }).ok, false);
});

// --- The reducer: Sell All is SELL_LLAMA, once per sellable stall ---

const context = src("context/GameContext.jsx");
const caseBody = (name, nextName) =>
  context.slice(context.indexOf(`case "${name}": {`), context.indexOf(`case "${nextName}": {`));

test("SELL_UNLOCKED_LLAMAS runs SELL_LLAMA for each sellable stall, with no price path of its own", () => {
  const sellAll = caseBody("SELL_UNLOCKED_LLAMAS", "TOGGLE_LLAMA_LOCK");
  assert.match(sellAll, /for \(const stallIndex of shared\.farmSellableStalls\(farm\.stalls\)\) \{\s*next = gameReducer\(next, \{ type: "SELL_LLAMA", payload: \{ stallIndex \} \}\);\s*\}/);
  assert.match(sellAll, /if \(!farm\.owned\) return state;/);
  assert.doesNotMatch(sellAll, /llamaSellPriceCents|money:/);
});

test("SELL_LLAMA is unchanged apart from clearing the emptied stall's lock", () => {
  const sell = caseBody("SELL_LLAMA", "SELL_UNLOCKED_LLAMAS");
  assert.match(sell, /const value = shared\.llamaSellPriceCents\(type, getBaseLocPerSecond\(state\)\);/);
  assert.match(sell, /i === stallIndex \? \{ \.\.\.entry, llama: null, locked: false \} : entry/);
  // A single sale does not check the lock (the issue: individual sell stays as it is).
  assert.doesNotMatch(sell, /locked\)|\.locked/);
});

test("TOGGLE_LLAMA_LOCK uses the shared helper", () => {
  const toggle = caseBody("TOGGLE_LLAMA_LOCK", "MOVE_LLAMA");
  assert.match(toggle, /const toggled = shared\.toggleFarmLlamaLock\(state\.farm, stallIndex\);/);
  assert.match(toggle, /if \(!toggled\) return state;/);
});

test("a lock change saves promptly", () => {
  const before = { ...saveAt(100), farm: barnFarm(LAYOUT) };
  const after = { ...before, farm: toggleFarmLlamaLock(before.farm, 1) };
  assert.equal(bigActionIncreased(bigActionFields(before), bigActionFields(after)), true);
  assert.equal(bigActionIncreased(bigActionFields(before), bigActionFields(before)), false);
});

// --- The Farm card ---

const farmCard = src("components/Farm.jsx");

test("the Sell All button reads the count and total, and is disabled with nothing to sell", () => {
  assert.match(farmCard, /const sellAll = farmSellAllPreview\(farm\.stalls, pricingRate\);/);
  assert.match(farmCard, /<Button\s+onClick=\{handleSellAll\}\s+disabled=\{sellAll\.count === 0\}/);
  assert.match(farmCard, /`Sell \$\{sellAll\.count\} unlocked for \$\{formatMoney\(sellAll\.totalCents\)\}`/);
  assert.match(farmCard, /dispatch\(\{ type: "SELL_UNLOCKED_LLAMAS" \}\);/);
  // One tap, no browser dialogs.
  assert.doesNotMatch(farmCard, /window\.confirm|window\.alert|\bconfirm\(|\balert\(/);
  // It sits in the farm panel, above the stall grid.
  assert.ok(farmCard.indexOf("onClick={handleSellAll}") < farmCard.indexOf("ref={gridRef}"));
});

test("the lock toggle lives in the stall chip next to Sell and Move; locked tiles say so", () => {
  const start = farmCard.indexOf("{index === chipAfterIndex && (");
  const chip = farmCard.slice(start, farmCard.indexOf("</Fragment>", start));
  assert.match(chip, /onClick=\{handleSellLlama\}[\s\S]*setMoving\(true\)[\s\S]*onClick=\{handleToggleLock\}/);
  assert.match(chip, /\{selectedLocked \? "Unlock" : "Lock"\}/);
  assert.match(chip, /Locked: Sell All skips this llama\./);
  assert.match(farmCard, /dispatch\(\{ type: "TOGGLE_LLAMA_LOCK", payload: \{ stallIndex: selectedStall \} \}\);/);
  // The tile: a lock icon (decorative) and ", locked" in its label.
  assert.match(farmCard, /\{stall\.llama && stall\.locked && \(\s*<FaLock/);
  assert.match(farmCard, /\$\{stall\.locked \? ", locked" : ""\}/);
  // No new animation for the lock (reduced motion has nothing to turn off).
  assert.doesNotMatch(chip, /animate-|transition/);
});

test("zero em or en dashes in the Farm card", () => {
  assert.doesNotMatch(farmCard, /[–—]/);
});

// --- End to end: an old save loads unlocked; a lock persists ---

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

test("end to end: a stored pre-lock save loads unlocked, a lock saves and reloads, and a stale client still saves", async () => {
  const srv = await startTestServer();
  try {
    const minted = await post(srv.base, "/api/player", {});
    assert.equal(minted.status, 201);
    const { playerId } = await minted.json();
    const old = { ...saveAt(100), farm: barnFarm(LAYOUT, { legacy: true }) };
    await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [JSON.stringify(old), playerId]);

    const loaded = await (await fetch(`${srv.base}/api/load?playerId=${playerId}`)).json();
    assert.equal(loaded.state.farm.owned, true);
    const client = saveStateToGameFields(loaded.state);
    assert.ok(client.farm.stalls.every((s) => s.locked === false));
    assert.deepEqual(client.farm.stalls.map((s) => s.llama), barnFarm(LAYOUT).stalls.map((s) => s.llama));

    // Lock the Mama and save.
    const lockedFarm = toggleFarmLlamaLock(client.farm, 0);
    srv.advance(60_000);
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: stateToSaveState({ ...loaded.state, ...client, farm: lockedFarm }),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const reloaded = await (await fetch(`${srv.base}/api/load?playerId=${playerId}`)).json();
    const reclient = saveStateToGameFields(reloaded.state);
    assert.equal(reclient.farm.stalls[0].locked, true);
    assert.ok(reclient.farm.stalls.slice(1).every((s) => s.locked === false));

    // A stale cached client (before the lock) sends no key: accepted.
    srv.advance(60_000);
    const stale = await post(srv.base, "/api/save", {
      playerId,
      state: { ...reloaded.state, farm: barnFarm(LAYOUT, { legacy: true }) },
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(stale.status, 200, await stale.clone().text());
  } finally {
    await srv.stop();
  }
});
