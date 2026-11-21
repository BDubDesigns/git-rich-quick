/**
 * Farm follow-ups (Brandon, Nov 21, 2026), after #251, #252 and #253.
 *
 * 1. A locked llama cannot be sold at all until it is unlocked. The
 *    single SELL_LLAMA refuses it, the server refuses a save where a
 *    llama that was locked left the barn (MONOTONIC, like a closed
 *    stall opening again in #253), and the chip's Sell button is
 *    disabled and reads "Unlock to sell". Sell All is unchanged.
 * 2. Mamas are never bred. A stall with only Mamas beside it is no
 *    nest and makes no kid. A Mama still boosts the kid chance of a
 *    nest with another llama, and that kid copies the other llama.
 * 3. An undiscovered ??? row in the herd book hides its prices: it
 *    shows only "??? (undiscovered)" and the hint.
 *
 * No price, odd or save schema changed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { validateSave } from "../src/validate.js";
import {
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FARM_LIGHTING_COLORS,
  FREELANCE_PROJECT_KEYS,
  LLAMA_TYPES,
  OPEN_SOURCE_IDS,
  farmEligibleBreedingStalls,
  farmKidChance,
  farmSellableStalls,
  initialSaveState,
  moveFarmLlama,
  normalizeSaveState,
  recordLlamaSold,
  rollFarmBreeding,
  rollFarmKid,
  toggleFarmLlamaLock,
} from "../../shared/game-balance.js";
import { breedingGuideSections } from "../../client/src/utils/breedingGuide.js";
import { saveStateToGameFields, stateToSaveState } from "../../client/src/save/serialize.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const context = src("context/GameContext.jsx");
const farmCard = src("components/Farm.jsx");

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

/** A normalized save with an owned barn: `placed` maps index to type, `locked` lists locked stalls. */
function barnSave(placed, locked = []) {
  const base = initialSaveState();
  return normalizeSaveState({
    ...base,
    employees: { ...base.employees, intern: 100, senior: 10 },
    farm: {
      owned: true,
      stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
        llama: placed[i] ?? null,
        lighting: "warm",
        locked: locked.includes(i),
        open: true,
      })),
      unlockedTypes: [...new Set(Object.values(placed))],
      unseenBirths: 0,
    },
  });
}

/** The same save with the llama in `stallIndex` sold (stall emptied, sale recorded). */
function sold(state, stallIndex) {
  const type = state.farm.stalls[stallIndex].llama;
  const stalls = state.farm.stalls.map((stall, i) =>
    i === stallIndex ? { ...stall, llama: null, locked: false } : stall
  );
  return {
    ...state,
    achievements: recordLlamaSold(state.achievements, type, 1),
    farm: { ...state.farm, stalls },
  };
}

const LAYOUT = { 1: "classic", 3: "classic", 4: "mama", 5: "drama" };

// --- 1. A locked llama cannot be sold until it is unlocked ---

test("SELL_LLAMA refuses a locked llama before it pays anything; Sell All still loops the unlocked stalls", () => {
  const sell = context.slice(context.indexOf('case "SELL_LLAMA": {'), context.indexOf('case "SELL_UNLOCKED_LLAMAS": {'));
  const guard = sell.indexOf("if (farm.stalls[stallIndex].locked === true) return state;");
  assert.ok(guard > 0, "the lock guard is in SELL_LLAMA");
  assert.ok(guard < sell.indexOf("money: state.money + value"), "the guard runs before the payout");
  const sellAll = context.slice(context.indexOf('case "SELL_UNLOCKED_LLAMAS": {'), context.indexOf('case "TOGGLE_LLAMA_LOCK": {'));
  assert.match(sellAll, /for \(const stallIndex of shared\.farmSellableStalls\(farm\.stalls\)\)/);
  // Sell All never reaches a locked stall, so the guard never stops it.
  assert.deepEqual(farmSellableStalls(barnSave(LAYOUT, [1, 4]).farm.stalls), [3, 5]);
});

test("the server refuses a save that sold a locked llama, like other illegal farm changes", () => {
  const prev = barnSave(LAYOUT, [1]);
  const result = save(prev, sold(prev, 1));
  assert.equal(result.ok, false);
  assert.equal(result.rule, "MONOTONIC");
  assert.match(result.detail, /sold a locked classic llama/);
  // Moved first (the lock goes with it), then sold: still refused.
  const moved = { ...prev, farm: moveFarmLlama(prev.farm, 1, 2) };
  assert.equal(moved.farm.stalls[2].locked, true);
  assert.equal(save(prev, sold(moved, 2)).ok, false);
  // An unlocked Classic twin (stall 3) does not hide it: types look
  // alike, so the check is on the locked count, which dropped.
  assert.equal(prev.farm.stalls[3].llama, "classic");
  // Known limit: an unlock and a sale in ONE save read the same, so
  // that is refused too (normally the unlock saves on its own first).
  const unlockedAndSold = sold({ ...prev, farm: toggleFarmLlamaLock(prev.farm, 1) }, 1);
  assert.equal(save(prev, unlockedAndSold).ok, false);
});

test("the server still accepts the legal paths: unlock then sell, an unlocked twin, moves, Sell All", () => {
  const prev = barnSave(LAYOUT, [1]);
  // Unlock, save, then sell: both saves pass.
  const unlocked = { ...prev, farm: toggleFarmLlamaLock(prev.farm, 1) };
  assert.equal(save(prev, unlocked).ok, true);
  assert.equal(save(unlocked, sold(unlocked, 1)).ok, true);
  // Selling the unlocked Classic while the locked one stays: passes.
  assert.equal(save(prev, sold(prev, 3)).ok, true);
  // Moving a locked llama is not a sale.
  assert.equal(save(prev, { ...prev, farm: moveFarmLlama(prev.farm, 1, 2) }).ok, true);
  // Sell All: every unlocked llama gone, the locked one stays.
  let all = prev;
  for (const i of farmSellableStalls(prev.farm.stalls)) all = sold(all, i);
  assert.deepEqual(all.farm.stalls.map((s) => s.llama), [null, "classic", null, null, null, null, null, null, null]);
  assert.equal(save(prev, all).ok, true);
  // An old save with no lock key has nothing locked, so selling passes.
  const legacy = barnSave(LAYOUT);
  assert.equal(save(legacy, sold(legacy, 1)).ok, true);
});

test("the chip's Sell button is disabled for a locked llama and says to unlock it", () => {
  const start = farmCard.indexOf("{index === chipAfterIndex && (");
  const chip = farmCard.slice(start, farmCard.indexOf("</Fragment>", start));
  assert.match(chip, /onClick=\{handleSellLlama\}\s*disabled=\{selectedLocked\}/);
  assert.match(chip, /selectedLocked \? \(\s*"Unlock to sell"/);
  assert.match(chip, /`Unlock this \$\{LLAMA_TYPE_NAMES\[selectedLlama\]\} to sell it`/);
  assert.match(chip, /Locked: unlock it to sell it\. Sell All skips it\./);
});

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

test("end to end: selling a locked llama gets a 409, and unlocking first then selling saves", async () => {
  const srv = await startTestServer();
  try {
    const minted = await post(srv.base, "/api/player", {});
    assert.equal(minted.status, 201);
    const { playerId } = await minted.json();
    const stored = barnSave(LAYOUT, [1]);
    await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [JSON.stringify(stored), playerId]);
    const loaded = await (await fetch(`${srv.base}/api/load?playerId=${playerId}`)).json();
    const client = { ...loaded.state, ...saveStateToGameFields(loaded.state) };
    assert.equal(client.farm.stalls[1].locked, true);

    srv.advance(60_000);
    const refused = await post(srv.base, "/api/save", {
      playerId,
      state: stateToSaveState(sold(client, 1)),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(refused.status, 409);
    const body = await refused.json();
    assert.equal(body.rule, "MONOTONIC");
    assert.match(body.detail, /locked/);

    const unlocked = { ...client, farm: toggleFarmLlamaLock(client.farm, 1) };
    srv.advance(60_000);
    const ok1 = await post(srv.base, "/api/save", {
      playerId,
      state: stateToSaveState(unlocked),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(ok1.status, 200, await ok1.clone().text());
    srv.advance(60_000);
    const ok2 = await post(srv.base, "/api/save", {
      playerId,
      state: stateToSaveState(sold(unlocked, 1)),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(ok2.status, 200, await ok2.clone().text());
  } finally {
    await srv.stop();
  }
});

// --- 2. Mamas are never bred ---

/** A 3x3 barn with the given llamas and every stall open and warm. */
function barn(llamas = {}, lighting = "warm") {
  return Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
    llama: llamas[i] ?? null,
    lighting,
    locked: false,
    open: true,
  }));
}

/** A small seeded rng (mulberry32), so the long runs are repeatable. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("a stall with only Mamas beside it is no nest and never births, whatever the light or the luck", () => {
  for (const mamas of [{ 1: "mama", 3: "mama" }, { 1: "mama", 3: "mama", 5: "mama", 7: "mama" }]) {
    for (const lighting of FARM_LIGHTING_COLORS) {
      const stalls = barn(mamas, lighting);
      assert.ok(!farmEligibleBreedingStalls(stalls).includes(4), "not a nest");
      // Called directly with a sure-fire roll, nothing met and everything met: no kid.
      for (const met of [[], ["mama"], [...LLAMA_TYPES]]) {
        assert.equal(rollFarmKid(4, stalls, met, () => 0), null);
      }
      const rng = seeded(7);
      for (let tick = 0; tick < 200; tick++) {
        const { kidsBorn } = rollFarmBreeding(stalls, ["mama"], rng);
        assert.deepEqual(kidsBorn, []);
      }
    }
  }
});

test("a Mama still boosts a mixed nest, and its kids are never Mamas", () => {
  const stalls = barn({ 1: "mama", 3: "classic" });
  assert.ok(farmEligibleBreedingStalls(stalls).includes(4));
  assert.ok(farmKidChance("warm", ["mama", "classic"]) > farmKidChance("warm", ["classic", "classic"]));
  // Every kid kind, over many seeded checks of a Mama-heavy barn.
  const heavy = barn({ 0: "mama", 1: "mama", 2: "mama", 3: "mama", 5: "classic", 6: "mama", 8: "mama" }, "red");
  const seen = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const { kidsBorn } = rollFarmBreeding(heavy, ["mama", "classic"], seeded(seed));
    for (const kid of kidsBorn) seen.add(kid);
  }
  assert.ok(seen.size > 0, "the mixed nests did breed");
  assert.ok(!seen.has("mama"), "never a Mama");
});

test("the breeding guide says Mamas are shop-only and a Mama-only stall makes no kid", () => {
  const section = breedingGuideSections().find((s) => s.heading.includes("Mama"));
  const text = section.lines.join("\n");
  assert.match(text, /only sold in the shop/);
  assert.match(text, /never bred/);
  assert.match(text, /A stall with only Mamas beside it makes no kid\./);
  assert.doesNotMatch(text, /does make a Mama/);
  assert.doesNotMatch(text, /[–—]/);
});

// --- 3. ??? rows hide their prices ---

test("an undiscovered ??? row shows only its label and the hint, with no price", () => {
  const book = farmCard.slice(farmCard.indexOf("Herd book ("));
  const start = book.indexOf("if (!forSale) {");
  const hidden = book.slice(start, book.indexOf("</p>", start));
  assert.match(hidden, /<strong>\?\?\? \(undiscovered\)<\/strong>\. Breed one to find it\./);
  assert.doesNotMatch(hidden, /formatMoney|llamaSellPriceCents|llamaBuyPriceCents|typeSeconds|worth|sells for/);
  // Shown rows are only the shop kinds now, so the price says "buy".
  assert.doesNotMatch(book, /forSale \? "buy" : "worth"/);
  assert.doesNotMatch(farmCard, /[–—]/);
});
