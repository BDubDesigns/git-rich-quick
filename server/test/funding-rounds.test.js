/**
 * Tests for Funding Rounds (issue #170, design in #169).
 *
 * - The round track: five permanent store ranks (Seed, Series A,
 *   Series B, Series C, IPO) at 5 / 20 / 60 / 150 / 300 Equity. Each
 *   rank raises the level caps of CoffeeScript, Junior Achievement,
 *   Senior Moment, Scrum Master and Commitment Issues. The rank
 *   survives sales; the levels still reset on sale.
 * - The validator refuses a level above the owned round's cap.
 * - The save wipe: a row stored before SAVE_SCHEMA_VERSION is reset to
 *   a fresh company the first time it is touched (load, save, sale,
 *   store buy, intermission), and a write against it is a 409 WIPE so
 *   the client adopts the fresh state.
 * - Lifetime LOC past 2^53: the new curve passes the float-safe limit a
 *   few days after IPO, and saves there must still validate.
 *
 * The click to passive invariant at the round plateaus lives in
 * click-balance.test.js; the per-level track math in
 * doubling-upgrades.test.js.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore, SAVE_SCHEMA_VERSION } from "../src/store.js";
import { createServer } from "../src/server.js";
import { validateSave } from "../src/validate.js";
import {
  BALANCE,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  FUNDING_ROUNDS_CONFIG,
  OPEN_SOURCE_IDS,
  PRESTIGE_STORE_CONFIG,
  PRESTIGE_STORE_IDS,
  applyPrestigeSale,
  doublingTrackMultiplier,
  entitledEquity,
  equityThresholdLoc,
  fundingRoundName,
  fundingRoundRank,
  fundingRoundRankForLevel,
  initialSaveState,
  isRoundGatedProject,
  openSourceLevelCap,
  openSourceNextLevelNeedsRound,
  projectManagerBoostFraction,
  storeRankCost,
} from "../../shared/game-balance.js";
import { SaveSync } from "../../client/src/save/saveSync.js";
import { saveStateToGameFields } from "../../client/src/save/serialize.js";
import { sortOpenSourceProjectIds } from "../../client/src/utils/unlockProgress.js";

const T0 = 1_700_000_000_000;
const GATED = [
  "coffeeScript",
  "juniorAchievement",
  "seniorMoment",
  "scrumMaster",
  "commitmentIssues",
];

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
    store,
    advance(ms) {
      nowMs += ms;
    },
    async stop() {
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

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

async function loadState(base, playerId) {
  const res = await fetch(`${base}/api/load?playerId=${playerId}`);
  assert.equal(res.status, 200);
  return (await res.json()).state;
}

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

/** Store a state directly (test setup, not the save path). */
async function setState(srv, playerId, state) {
  await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [
    JSON.stringify(state),
    playerId,
  ]);
  return state;
}

/** Age a row to the schema before Funding Rounds (what every live row is at deploy). */
async function setSchemaVersion(srv, playerId, version) {
  await srv.pool.query(
    `UPDATE git_saves SET schema_version = $1 WHERE player_id = $2`,
    [version, playerId]
  );
}

async function schemaVersionOf(srv, playerId) {
  const res = await srv.pool.query(
    `SELECT schema_version FROM git_saves WHERE player_id = $1`,
    [playerId]
  );
  return Number(res.rows[0].schema_version);
}

/** Brandon's Nov 18 save, roughly: old-scale lifetime LOC and levels. */
function oldScaleState() {
  const s = initialSaveState();
  s.totalLinesOfCode = 353_500_000_000;
  s.linesOfCode = 1_000_000;
  s.employees = { ...s.employees, intern: 60, junior: 50, senior: 40 };
  return s;
}

// --- Config ---

test("config: locked round names and prices, 622 Equity for the whole store", () => {
  assert.deepEqual(FUNDING_ROUNDS_CONFIG.roundNames, [
    "Seed",
    "Series A",
    "Series B",
    "Series C",
    "IPO",
  ]);
  assert.deepEqual(FUNDING_ROUNDS_CONFIG.rankCosts, [5, 20, 60, 150, 300]);
  assert.equal(PRESTIGE_STORE_IDS[0], "fundingRounds");
  assert.deepEqual(PRESTIGE_STORE_CONFIG.fundingRounds.rankCosts, [5, 20, 60, 150, 300]);
  assert.equal(storeRankCost("fundingRounds", 1), 5);
  assert.equal(storeRankCost("fundingRounds", 5), 300);
  assert.equal(storeRankCost("fundingRounds", 6), null);
  for (const text of [
    PRESTIGE_STORE_CONFIG.fundingRounds.displayName,
    PRESTIGE_STORE_CONFIG.fundingRounds.description,
    ...FUNDING_ROUNDS_CONFIG.roundNames,
  ]) {
    assert.ok(!text.includes("—"), `no em dash: ${text}`);
  }
});

test("caps by round match the build spec (issue #170 section 4)", () => {
  const capsAt = (id) => [0, 1, 2, 3, 4, 5].map((r) => openSourceLevelCap(id, { fundingRounds: r }));
  for (const id of ["coffeeScript", "juniorAchievement", "seniorMoment"]) {
    assert.deepEqual(capsAt(id), [6, 9, 12, 15, 18, 21], id);
  }
  assert.deepEqual(capsAt("scrumMaster"), [5, 8, 11, 14, 17, 20]);
  assert.deepEqual(capsAt("commitmentIssues"), [6, 8, 10, 12, 14, 16]);
  // The multipliers those caps give: 7.5x .. 1,171x, 6% .. 21%, 64x .. 65,536x.
  assert.deepEqual(
    capsAt("seniorMoment").map((l) => doublingTrackMultiplier("seniorMoment", l).toFixed(1)),
    ["7.5", "20.7", "56.7", "155.6", "426.9", "1171.4"]
  );
  assert.deepEqual(
    capsAt("scrumMaster").map((l) =>
      Math.round(projectManagerBoostFraction({ projectManager: 1 }, 1, { scrumMaster: l }) * 100)
    ),
    [6, 9, 12, 15, 18, 21]
  );
  assert.deepEqual(
    capsAt("commitmentIssues").map((l) => doublingTrackMultiplier("commitmentIssues", l)),
    [64, 256, 1024, 4096, 16384, 65536]
  );
  // The top cap is the whole track; every other project is ungated.
  for (const id of GATED) {
    assert.ok(isRoundGatedProject(id), id);
    assert.equal(openSourceLevelCap(id, { fundingRounds: 5 }), BALANCE.openSource[id].levels.length);
  }
  for (const id of OPEN_SOURCE_IDS.filter((x) => !GATED.includes(x))) {
    assert.equal(isRoundGatedProject(id), false, id);
    assert.equal(openSourceLevelCap(id, {}), BALANCE.openSource[id].levels.length, id);
  }
  assert.equal(openSourceLevelCap("notAProject", {}), 0);
});

test("round helpers: names, the round a level needs, and NaN guards", () => {
  assert.equal(fundingRoundName(0), "Bootstrapped");
  assert.equal(fundingRoundName(1), "Seed");
  assert.equal(fundingRoundName(5), "IPO");
  assert.equal(fundingRoundName(99), "IPO");
  assert.equal(fundingRoundName(Number.NaN), "Bootstrapped");
  assert.equal(fundingRoundRank({ fundingRounds: 3 }), 3);
  assert.equal(fundingRoundRank({ fundingRounds: 9 }), 5);
  assert.equal(fundingRoundRank({ fundingRounds: Number.NaN }), 0);
  assert.equal(fundingRoundRank(undefined), 0);
  assert.equal(fundingRoundRank({ fundingRounds: -2 }), 0);
  // A NaN rank reads Bootstrapped caps, never NaN.
  assert.equal(openSourceLevelCap("seniorMoment", { fundingRounds: Number.NaN }), 6);
  assert.equal(fundingRoundRankForLevel("seniorMoment", 6), 0);
  assert.equal(fundingRoundRankForLevel("seniorMoment", 7), 1);
  assert.equal(fundingRoundRankForLevel("seniorMoment", 21), 5);
  assert.equal(fundingRoundRankForLevel("seniorMoment", 22), null);
  assert.equal(fundingRoundRankForLevel("commitmentIssues", 9), 2);
  assert.equal(fundingRoundRankForLevel("shipHappens", 3), null);
  // The next level is round-locked only between the cap and the end.
  assert.equal(openSourceNextLevelNeedsRound("seniorMoment", 5, {}), false);
  assert.equal(openSourceNextLevelNeedsRound("seniorMoment", 6, {}), true);
  assert.equal(openSourceNextLevelNeedsRound("seniorMoment", 6, { fundingRounds: 1 }), false);
  assert.equal(openSourceNextLevelNeedsRound("seniorMoment", 21, { fundingRounds: 5 }), false);
  assert.equal(openSourceNextLevelNeedsRound("shipHappens", 9, {}), false);
});

test("the GitNub list sinks a round-capped track below buyable ones, above maxed ones", () => {
  const state = {
    openSourceProjects: Object.fromEntries(
      OPEN_SOURCE_IDS.map((id) => [id, { level: 0 }])
    ),
    favoriteOpenSourceProjects: [],
    permanentStoreRanks: { fundingRounds: 0 },
  };
  state.openSourceProjects.seniorMoment = { level: 6 }; // at the Bootstrapped cap
  state.openSourceProjects.blocker = { level: 5 }; // maxed
  state.openSourceProjects.coffeeScript = { level: 2 }; // buyable
  const sorted = sortOpenSourceProjectIds(["blocker", "seniorMoment", "coffeeScript"], state);
  assert.deepEqual(sorted, ["coffeeScript", "seniorMoment", "blocker"]);
  // Raise the round and Senior Moment is buyable again.
  const seeded = { ...state, permanentStoreRanks: { fundingRounds: 1 } };
  assert.deepEqual(
    sortOpenSourceProjectIds(["blocker", "seniorMoment", "coffeeScript"], seeded),
    ["seniorMoment", "coffeeScript", "blocker"]
  );
});

// --- Validator ---

test("validator: a gated level above the owned round's cap is a shape rejection", () => {
  const prevState = initialSaveState();
  const ok = (state) =>
    validateSave(
      { state: prevState, savedAtMs: T0 },
      { playerId: randomUUID(), state, actionsSinceLastSave: zeroActions() },
      T0 + 60_000
    );
  // Bootstrapped: Senior Moment 6 is fine, 7 is not; Commitment Issues 7 is not.
  const at6 = initialSaveState();
  at6.openSourceProjects.seniorMoment = 6;
  assert.equal(ok(at6).ok, true, JSON.stringify(ok(at6)));
  const at7 = initialSaveState();
  at7.openSourceProjects.seniorMoment = 7;
  assert.equal(ok(at7).rule, "SHAPE");
  assert.match(ok(at7).detail, /0-6/);
  const ci7 = initialSaveState();
  ci7.openSourceProjects.commitmentIssues = 7;
  assert.equal(ok(ci7).rule, "SHAPE");
});

test("validator: a round raises the cap; past the track end is always rejected", () => {
  const withRound = (round, levels) => {
    const state = initialSaveState();
    state.permanentStoreRanks.fundingRounds = round;
    Object.assign(state.openSourceProjects, levels);
    return state;
  };
  const check = (round, levels) =>
    validateSave(
      { state: withRound(round, {}), savedAtMs: T0 },
      { playerId: randomUUID(), state: withRound(round, levels), actionsSinceLastSave: zeroActions() },
      T0 + 60_000
    );
  assert.equal(check(1, { seniorMoment: 9, scrumMaster: 8, commitmentIssues: 8 }).ok, true);
  assert.equal(check(1, { seniorMoment: 10 }).rule, "SHAPE");
  assert.equal(check(5, { seniorMoment: 21, scrumMaster: 20, commitmentIssues: 16 }).ok, true);
  assert.equal(check(5, { seniorMoment: 22 }).rule, "SHAPE");
  assert.equal(check(5, { commitmentIssues: 17 }).rule, "SHAPE");
});

test("validator: a normal save cannot buy itself a round", () => {
  const raised = initialSaveState();
  raised.permanentStoreRanks.fundingRounds = 1;
  const r = validateSave(
    { state: initialSaveState(), savedAtMs: T0 },
    { playerId: randomUUID(), state: raised, actionsSinceLastSave: zeroActions() },
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "STORE");
});

// --- The round through the real API ---

test("server: sell, raise Seed, and the next company can level past the Bootstrapped cap; the round survives the next sale", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  // 5 Equity: 5^3 x 10M = 1.25B lifetime LOC.
  const pre = initialSaveState();
  pre.totalLinesOfCode = equityThresholdLoc(5);
  pre.linesOfCode = 1_000;
  pre.employees = { ...pre.employees, senior: 10 };
  pre.openSourceProjects.seniorMoment = 6;
  await setState(srv, playerId, pre);
  srv.advance(2000);
  let res = await post(srv.base, "/api/save/sell", {
    playerId,
    saleId: randomUUID(),
    state: pre,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.state.lifetimeEquityEarned, 5);
  // The sale reset the level, like every upgrade.
  assert.equal(body.state.openSourceProjects.seniorMoment, 0);

  res = await post(srv.base, "/api/save/store/buy", {
    playerId,
    storeId: "fundingRounds",
    rank: 1,
    state: body.state,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  body = await res.json();
  assert.deepEqual(body.purchase, {
    storeId: "fundingRounds",
    rank: 1,
    price: 5,
    equitySpent: 5,
    availableEquity: 0,
  });
  res = await post(srv.base, "/api/save/intermission/complete", {
    playerId,
    state: body.state,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  body = await res.json();

  // Seed: Senior Moment 9 now validates in a normal save; 10 does not.
  srv.advance(2000);
  const seeded = {
    ...body.state,
    employees: { ...body.state.employees, senior: 10 },
    openSourceProjects: { ...body.state.openSourceProjects, seniorMoment: 9 },
  };
  res = await post(srv.base, "/api/save", { playerId, state: seeded, actionsSinceLastSave: zeroActions() });
  assert.equal(res.status, 200);
  srv.advance(2000);
  const over = {
    ...seeded,
    openSourceProjects: { ...seeded.openSourceProjects, seniorMoment: 10 },
  };
  res = await post(srv.base, "/api/save", { playerId, state: over, actionsSinceLastSave: zeroActions() });
  // A shape rejection is a 400 (the server's existing mapping).
  assert.equal(res.status, 400);
  assert.equal((await res.json()).rule, "SHAPE");

  // A second sale keeps the round (a permanent rank) and resets the level.
  const grown = { ...seeded, totalLinesOfCode: equityThresholdLoc(6) };
  srv.advance(2000);
  res = await post(srv.base, "/api/save", { playerId, state: grown, actionsSinceLastSave: zeroActions() });
  assert.equal(res.status, 200);
  res = await post(srv.base, "/api/save/sell", {
    playerId,
    saleId: randomUUID(),
    state: grown,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.state.permanentStoreRanks.fundingRounds, 1);
  assert.equal(body.state.openSourceProjects.seniorMoment, 0);
});

test("applyPrestigeSale keeps the round and zeroes every gated level", () => {
  const pre = initialSaveState();
  pre.totalLinesOfCode = equityThresholdLoc(400);
  pre.permanentStoreRanks.fundingRounds = 4;
  for (const id of GATED) pre.openSourceProjects[id] = openSourceLevelCap(id, pre.permanentStoreRanks);
  const post = applyPrestigeSale(pre, randomUUID());
  assert.equal(post.permanentStoreRanks.fundingRounds, 4);
  for (const id of GATED) assert.equal(post.openSourceProjects[id], 0, id);
});

// --- Save wipe (issue #170) ---

test("wipe: new players are written at the current schema and never wiped", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  assert.equal(SAVE_SCHEMA_VERSION, 2);
  const playerId = await mintPlayer(srv.base);
  assert.equal(await schemaVersionOf(srv, playerId), SAVE_SCHEMA_VERSION);
  const s = initialSaveState();
  s.totalLinesOfCode = 12_345;
  s.linesOfCode = 12_345;
  await setState(srv, playerId, s);
  const loaded = await loadState(srv.base, playerId);
  assert.equal(loaded.totalLinesOfCode, 12_345);
});

/**
 * A wiped row is initialSaveState() plus one thing: the unread
 * explanation mail in the inbox (issue #172, pinned in
 * save-wipe-email.test.js). Everything else is the fresh company.
 */
function assertFreshWipedState(state, message) {
  const { emails, ...rest } = state;
  const { emails: freshEmails, ...fresh } = initialSaveState();
  assert.deepEqual(freshEmails, [], message);
  assert.deepEqual(rest, fresh, message);
  assert.equal(emails.length, 1, message);
  assert.equal(emails[0].triggerKey, "save-wipe:v2", message);
  assert.equal(emails[0].read, false, message);
}

test("wipe: loading a pre-Funding-Rounds row returns a fresh company and bumps the row", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  await setState(srv, playerId, oldScaleState());
  await setSchemaVersion(srv, playerId, 1);
  const loaded = await loadState(srv.base, playerId);
  assertFreshWipedState(loaded);
  assert.equal(await schemaVersionOf(srv, playerId), SAVE_SCHEMA_VERSION);
  // A second load does not wipe again.
  const s = { ...initialSaveState(), totalLinesOfCode: 500, linesOfCode: 500 };
  await setState(srv, playerId, s);
  assert.equal((await loadState(srv.base, playerId)).totalLinesOfCode, 500);
});

test("wipe: a save against a pre-Funding-Rounds row is a 409 WIPE with the fresh company, and the old state never lands", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const old = await setState(srv, playerId, oldScaleState());
  await setSchemaVersion(srv, playerId, 1);
  srv.advance(2000);
  const res = await post(srv.base, "/api/save", { playerId, state: old, actionsSinceLastSave: zeroActions() });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.rule, "WIPE");
  assertFreshWipedState(body.lastGoodState.state);
  assertFreshWipedState(await loadState(srv.base, playerId));
  assert.equal(await schemaVersionOf(srv, playerId), SAVE_SCHEMA_VERSION);
  // The very same old state, re-sent, is now validated against the
  // fresh row like any other save (no second wipe).
  srv.advance(2000);
  const again = await post(srv.base, "/api/save", {
    playerId,
    state: initialSaveState(),
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(again.status, 200);
});

test("wipe: sale, store buy and intermission against a pre-Funding-Rounds row are all 409 WIPE", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  for (const [path, extra] of [
    ["/api/save/sell", { saleId: randomUUID() }],
    ["/api/save/store/buy", { storeId: "fundingRounds", rank: 1 }],
    ["/api/save/intermission/complete", {}],
  ]) {
    const playerId = await mintPlayer(srv.base);
    const old = await setState(srv, playerId, oldScaleState());
    await setSchemaVersion(srv, playerId, 1);
    srv.advance(2000);
    const res = await post(srv.base, path, { playerId, state: old, actionsSinceLastSave: zeroActions(), ...extra });
    assert.equal(res.status, 409, path);
    const body = await res.json();
    assert.equal(body.rule, "WIPE", path);
    assertFreshWipedState(body.lastGoodState.state, path);
    assertFreshWipedState(await loadState(srv.base, playerId), path);
  }
});

test("wipe: the client adopts the fresh company when a sale hits a wiped row", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const storage = {
    map: new Map(),
    getItem(key) {
      return this.map.has(key) ? this.map.get(key) : null;
    },
    setItem(key, value) {
      this.map.set(key, String(value));
    },
    removeItem(key) {
      this.map.delete(key);
    },
  };
  let clientState = { ...saveStateToGameFields(initialSaveState()), clickHistory: [], currentCPS: 0 };
  let playerId = null;
  const engine = new SaveSync({
    apiBaseUrl: srv.base,
    getState: () => clientState,
    restore: (saveState) => {
      clientState = { ...clientState, ...saveStateToGameFields(saveState), clickHistory: [], currentCPS: 0 };
    },
    onStatus: () => {},
    onPlayerId: (id) => {
      playerId = id;
    },
    storage,
  });
  t.after(() => engine.stop());
  await engine.init();
  // The deploy happens under a running client: its row is old-schema
  // and its in-memory company is old-scale.
  await setState(srv, playerId, oldScaleState());
  await setSchemaVersion(srv, playerId, 1);
  clientState = { ...clientState, ...saveStateToGameFields(oldScaleState()) };
  srv.advance(2000);
  const result = await engine.sellCompany();
  assert.equal(result.ok, false);
  assert.equal(result.error, "WIPE");
  assert.equal(clientState.totalLinesOfCode, 0, "the client adopted the fresh company");
  assert.equal(clientState.employees.intern.count, 0);
});

// --- Float precision past 2^53 (issue #170) ---

test("2^53: a save with lifetime LOC, bank, money and peak rate past the float-safe limit validates", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  // A few days after IPO the new curve runs lifetime LOC past
  // 2^53 (9.007Qa). These are not safe integers, but they are finite
  // non-negative numbers, and money stays a whole number of cents.
  const big = initialSaveState();
  big.totalLinesOfCode = 2 ** 53 * 4 + 0.5 * 2 ** 3;
  big.linesOfCode = 2 ** 53 * 2;
  big.money = 2 ** 60; // cents: a whole number, not a safe integer
  big.achievements.peakLocPerSecond = 2 ** 55;
  assert.equal(Number.isSafeInteger(big.totalLinesOfCode), false);
  assert.equal(Number.isInteger(big.money), true);
  await setState(srv, playerId, initialSaveState());
  srv.advance(2000);
  let res = await post(srv.base, "/api/save", { playerId, state: big, actionsSinceLastSave: zeroActions() });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  // The values round-trip through JSONB unchanged.
  const loaded = await loadState(srv.base, playerId);
  assert.equal(loaded.totalLinesOfCode, big.totalLinesOfCode);
  assert.equal(loaded.money, big.money);
  // And production keeps landing: a few billion LOC more is still
  // visible at this magnitude (the spacing of doubles here is 4).
  srv.advance(2000);
  const later = { ...big, totalLinesOfCode: big.totalLinesOfCode + 22e9, linesOfCode: big.linesOfCode + 22e9 };
  assert.ok(later.totalLinesOfCode > big.totalLinesOfCode);
  res = await post(srv.base, "/api/save", { playerId, state: later, actionsSinceLastSave: zeroActions() });
  assert.equal(res.status, 200);
});

test("2^53: a sale past the float-safe limit claims the right Equity", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const pre = initialSaveState();
  pre.totalLinesOfCode = equityThresholdLoc(1000) + 12_345_678; // 10Qa, past 2^53
  pre.linesOfCode = 1_000;
  assert.ok(pre.totalLinesOfCode > 2 ** 53);
  assert.equal(entitledEquity(pre.totalLinesOfCode), 1000);
  await setState(srv, playerId, initialSaveState());
  srv.advance(2000);
  const res = await post(srv.base, "/api/save/sell", {
    playerId,
    saleId: randomUUID(),
    state: pre,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sale.gainedEquity, 1000);
  assert.equal(body.state.lifetimeLocAtLastSale, pre.totalLinesOfCode);
});
