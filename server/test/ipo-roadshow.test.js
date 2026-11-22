/**
 * IPO Roadshow (issue #266): six milestones on the Series C to IPO
 * climb that pay 100 BONUS Equity.
 *
 * - The table: six milestones in order, gates 25T / 75T / 150T / 300T /
 *   500T / 800T run LOC, prices 10 / 20 / 30 / 45 / 60 / 90 minutes of S,
 *   Equity 10 / 15 / 15 / 20 / 20 / 20 (100 in total).
 * - Open only at Series C (rank 4) with IPO not owned; prices are minutes
 *   of cashBasisCentsPerSecond at buffed P.
 * - The stage moves only through POST /api/save/roadshow/buy, one step
 *   at a time, with the gate met and the cash paid (the server deducts
 *   it). An ordinary save cannot move it, and bonus Equity is never a
 *   client number.
 * - The bonus is a separate pool: spendable everywhere (one helper,
 *   spendableEquity), never part of lifetimeEquityEarned, so the next
 *   sale's claimable Equity is unchanged; buying the IPO with it works
 *   end to end.
 * - Progress persists across sales; old saves load at stage 0.
 * - One GITMail per milestone, linking to the card in Settings.
 *
 * Runs against a real store backed by in-memory Postgres (pg-mem), the
 * prestige-store.test.js harness. Component checks are source checks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  FUNDING_ROUNDS_CONFIG,
  OPEN_SOURCE_IDS,
  ROADSHOW_CONFIG,
  ROADSHOW_EMAIL_ITEM_ID,
  ROADSHOW_MAX_STAGE,
  applyPrestigeSale,
  availableEquity,
  buffedLocPerSecond,
  buildRoadshowReadyEmail,
  cashBasisCentsPerSecond,
  claimableEquity,
  emailTargetError,
  entitledEquity,
  initialSaveState,
  normalizeSaveState,
  roadshowBonusEquity,
  roadshowGateProgress,
  roadshowNextPurchase,
  roadshowOpen,
  roadshowPriceCents,
  roadshowReadyMilestone,
  roadshowStageOf,
  roadshowVisible,
  spendableEquity,
  storeRankCost,
  zeroStoreRanks,
} from "../../shared/game-balance.js";
import { validateRoadshowBuy, validateSave, validateStoreBuy } from "../src/validate.js";
import {
  bigActionFields,
  bigActionIncreased,
  isInitialSaveState,
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";
import { SaveSync } from "../../client/src/save/saveSync.js";
import {
  addEmail,
  collectTriggerEmails,
  emailDetailModel,
} from "../../client/src/email/email.js";
import { equityStripModel } from "../../client/src/utils/equityStrip.js";
import { claimableOf } from "../../client/src/utils/equitySweep.js";
import {
  ROADSHOW_OPEN_KEY,
  readRoadshowOpen,
  roadshowCardModel,
  writeRoadshowOpen,
} from "../../client/src/utils/roadshowCard.js";
import { highlightMatches, navigateToTarget } from "../../client/src/navigation/highlight.js";
import { withClientBuild } from "./helpers/client-build.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const T0 = 1_700_000_000_000;
const T = 1e12;

const src = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// --- Harness (prestige-store.test.js) ---

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
    body: JSON.stringify(withClientBuild(path, body)),
  });
}

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

async function setRawState(srv, playerId, state) {
  await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [
    JSON.stringify(state),
    playerId,
  ]);
  return state;
}

async function loadState(base, playerId) {
  const res = await fetch(`${base}/api/load?playerId=${playerId}`);
  assert.equal(res.status, 200);
  return (await res.json()).state;
}

function zeroActions() {
  const counts = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
  return {
    clicks: 0,
    employeesBought: counts(EMPLOYEE_TYPES),
    projectsCompleted: counts(FREELANCE_PROJECT_KEYS),
    autoShips: counts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: counts(OPEN_SOURCE_IDS),
  };
}

async function roadshowBuy(base, playerId, stage, state) {
  return post(base, "/api/save/roadshow/buy", {
    playerId,
    stage,
    state,
    actionsSinceLastSave: zeroActions(),
  });
}

async function sell(base, playerId, state) {
  return post(base, "/api/save/sell", {
    playerId,
    saleId: randomUUID(),
    state,
    actionsSinceLastSave: zeroActions(),
  });
}

async function storeBuy(base, playerId, storeId, rank, state) {
  return post(base, "/api/save/store/buy", {
    playerId,
    storeId,
    rank,
    state,
    actionsSinceLastSave: zeroActions(),
  });
}

/**
 * A company at Series C: Funding Rounds rank 4, `runLoc` LOC this
 * company, plenty of cash, Equity books like Brandon's (370 earned, 322
 * spent) unless overridden. 100 interns give a known P.
 */
function seriesCState({
  runLoc = 200 * T,
  lastSale = 500 * T,
  money = 1e15,
  earned = 370,
  spent = 322,
  rank = 4,
  stage = 0,
} = {}) {
  const state = initialSaveState();
  state.totalLinesOfCode = lastSale + runLoc;
  state.linesOfCode = 1_000;
  state.lifetimeLocAtLastSale = lastSale;
  state.money = money;
  state.employees = { ...state.employees, intern: 100 };
  state.lifetimeEquityEarned = earned;
  state.equitySpent = spent;
  state.saleCount = 5;
  state.lastSaleId = randomUUID();
  state.permanentStoreRanks = { ...zeroStoreRanks(), fundingRounds: rank };
  state.roadshowStage = stage;
  return state;
}

// --- The table (shared/game-balance.js) ---

test("the table: six milestones, the issue's gates, prices and Equity, 100 in total", () => {
  assert.equal(ROADSHOW_MAX_STAGE, 6);
  assert.deepEqual(
    ROADSHOW_CONFIG.milestones.map((m) => m.gateRunLoc),
    [25 * T, 75 * T, 150 * T, 300 * T, 500 * T, 800 * T]
  );
  assert.deepEqual(ROADSHOW_CONFIG.milestones.map((m) => m.priceMinutes), [10, 20, 30, 45, 60, 90]);
  assert.deepEqual(ROADSHOW_CONFIG.milestones.map((m) => m.equity), [10, 15, 15, 20, 20, 20]);
  assert.equal(roadshowBonusEquity(6), 100);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(roadshowBonusEquity), [0, 10, 25, 40, 60, 80, 100]);
  // Junk stages are 0, past the end is clamped.
  assert.equal(roadshowBonusEquity(undefined), 0);
  assert.equal(roadshowBonusEquity("x"), 0);
  assert.equal(roadshowBonusEquity(-3), 0);
  assert.equal(roadshowBonusEquity(99), 100);
  assert.equal(roadshowStageOf(2.7), 2);
  assert.equal(ROADSHOW_CONFIG.fundingRank, 4);
  assert.equal(FUNDING_ROUNDS_CONFIG.roundNames[3], "Series C");
});

test("availability window: Series C only, hidden before it, closed at IPO", () => {
  for (const rank of [0, 1, 2, 3]) {
    assert.equal(roadshowOpen({ fundingRounds: rank }), false, `rank ${rank}`);
    assert.equal(roadshowVisible({ fundingRounds: rank }), false, `rank ${rank}`);
  }
  assert.equal(roadshowOpen({ fundingRounds: 4 }), true);
  assert.equal(roadshowVisible({ fundingRounds: 4 }), true);
  assert.equal(roadshowOpen({ fundingRounds: 5 }), false, "IPO owned: closed");
  assert.equal(roadshowVisible({ fundingRounds: 5 }), true, "shown as finished at IPO");
  const base = { stage: 0, money: 1e18, runLoc: 900 * T, buffedLocPerSec: 1e9 };
  assert.equal(roadshowNextPurchase({ ...base, storeRanks: { fundingRounds: 3 } }), null);
  assert.equal(roadshowNextPurchase({ ...base, storeRanks: { fundingRounds: 5 } }), null);
  assert.equal(roadshowNextPurchase({ ...base, storeRanks: { fundingRounds: 4 } }).stage, 1);
  assert.equal(
    roadshowNextPurchase({ ...base, stage: 6, storeRanks: { fundingRounds: 4 } }),
    null,
    "all six bought"
  );
});

test("gates read this company's LOC and are met exactly at the threshold", () => {
  assert.deepEqual(roadshowGateProgress(1, 25 * T - 1), { current: 25 * T - 1, target: 25 * T, met: false });
  assert.equal(roadshowGateProgress(1, 25 * T).met, true);
  assert.equal(roadshowGateProgress(6, 799 * T).met, false);
  assert.equal(roadshowGateProgress(6, 800 * T).met, true);
  assert.equal(roadshowGateProgress(7, 1e18), null);
  assert.equal(roadshowGateProgress(1, Number.NaN).current, 0);
  // Run LOC, not lifetime LOC: 900T lifetime but only 10T this company.
  const state = seriesCState({ runLoc: 10 * T, lastSale: 890 * T });
  assert.equal(roadshowReadyMilestone(state), 0);
  assert.equal(roadshowReadyMilestone(seriesCState({ runLoc: 25 * T })), 1);
});

test("prices are minutes of S at the sampled buffed P (floored, never free)", () => {
  for (const p of [0, 10, 1e6, 1e9, 15_515_767_332]) {
    const s = cashBasisCentsPerSecond(p);
    ROADSHOW_CONFIG.milestones.forEach((m, i) => {
      assert.equal(roadshowPriceCents(i + 1, p), Math.round(m.priceMinutes * 60 * s), `P=${p} #${i + 1}`);
    });
  }
  // S = P x 21 cents: at P = 1B LOC/s, milestone 1 (10 minutes) is $126B.
  assert.equal(roadshowPriceCents(1, 1e9), 600 * 1e9 * 21);
  // P below the floor prices from 10 LOC/s: 10 minutes = $1,260.
  assert.equal(roadshowPriceCents(1, 0), 126_000);
  assert.equal(roadshowPriceCents(0, 1e9), 0);
  assert.equal(roadshowPriceCents(7, 1e9), 0);
  // Affordability uses that price.
  const ranks = { fundingRounds: 4 };
  const price = roadshowPriceCents(1, 1e6);
  const exact = roadshowNextPurchase({ stage: 0, storeRanks: ranks, money: price, runLoc: 30 * T, buffedLocPerSec: 1e6 });
  assert.equal(exact.canBuy, true);
  const short = roadshowNextPurchase({ stage: 0, storeRanks: ranks, money: price - 1, runLoc: 30 * T, buffedLocPerSec: 1e6 });
  assert.deepEqual([short.affordable, short.canBuy], [false, false]);
  const gated = roadshowNextPurchase({ stage: 0, storeRanks: ranks, money: 1e18, runLoc: 1, buffedLocPerSec: 1e6 });
  assert.deepEqual([gated.gate.met, gated.canBuy], [false, false]);
});

// --- Server rules (validate.js) ---

test("stage advance rules: only the next milestone, gate met, cash covers the price", () => {
  const prev = normalizeSaveState(seriesCState({ runLoc: 200 * T, stage: 2 }));
  // The next one (3, gate 150T) with the cash: ok, priced at the sent state's P.
  const ok = validateRoadshowBuy(prev, prev, 3);
  assert.equal(ok.ok, true);
  assert.equal(ok.priceCents, roadshowPriceCents(3, buffedLocPerSecond(prev)));
  // Already bought: idempotent, no charge.
  assert.equal(validateRoadshowBuy(prev, prev, 2).alreadyOwned, true);
  assert.equal(validateRoadshowBuy(prev, prev, 1).alreadyOwned, true);
  // Skipping ahead, a zero or junk stage.
  for (const stage of [4, 6, 7, 0, 1.5, "3"]) {
    const r = validateRoadshowBuy(prev, prev, stage);
    assert.equal(r.ok, false, String(stage));
    assert.equal(r.rule, "ROADSHOW");
    if (stage === 4) assert.match(r.detail, /not the next one/);
  }
  // Gate unmet: 4 needs 300T this company.
  const stage3 = { ...prev, roadshowStage: 3 };
  assert.match(validateRoadshowBuy(stage3, stage3, 4).detail, /needs 300000000000000 LOC/);
  // Not enough cash.
  const broke = { ...prev, money: 5 };
  assert.match(validateRoadshowBuy(prev, broke, 3).detail, /costs/);
  // A sent stage that moved on its own.
  assert.equal(validateRoadshowBuy(prev, { ...prev, roadshowStage: 3 }, 3).rule, "ROADSHOW");
});

test("server window: rejected before Series C, at IPO and in the intermission", () => {
  for (const rank of [3, 5]) {
    const s = normalizeSaveState(seriesCState({ rank }));
    const r = validateRoadshowBuy(s, s, 1);
    assert.equal(r.ok, false);
    assert.match(r.detail, /only open at Series C/);
  }
  const inIntermission = normalizeSaveState({
    ...seriesCState(),
    prestigeIntermission: { saleId: randomUUID(), frozenHealthyPassiveLocPerSec: 1, frozenBestPayoutPerLocCents: 21 },
  });
  assert.match(validateRoadshowBuy(inIntermission, inIntermission, 1).detail, /intermission/);
});

test("an ordinary save can never move the stage or claim free Equity", () => {
  const prev = { state: normalizeSaveState(seriesCState({ stage: 1 })), savedAtMs: T0 };
  const send = (state) =>
    validateSave(prev, { playerId: randomUUID(), state, actionsSinceLastSave: zeroActions(), clientBuild: "t" }, T0 + 5000);
  assert.equal(send(prev.state).ok, true);
  const up = send({ ...prev.state, roadshowStage: 6 });
  assert.deepEqual([up.ok, up.rule], [false, "ROADSHOW"]);
  const down = send({ ...prev.state, roadshowStage: 0 });
  assert.deepEqual([down.ok, down.rule], [false, "ROADSHOW"]);
  // A bonus number is not a save field at all.
  const free = send({ ...prev.state, roadshowBonusEquity: 100 });
  assert.deepEqual([free.ok, free.rule], [false, "SHAPE"]);
  // Out-of-range stages fail the shape check.
  for (const bad of [7, -1, 1.5, "1", null]) {
    const r = validateSave(
      { state: normalizeSaveState(seriesCState({ stage: 1 })), savedAtMs: T0 },
      { playerId: randomUUID(), state: { ...prev.state, roadshowStage: bad }, actionsSinceLastSave: zeroActions(), clientBuild: "t" },
      T0 + 5000
    );
    assert.equal(r.rule, "SHAPE", String(bad));
  }
  // Spending may reach earned + bonus, never past it.
  const books = { state: normalizeSaveState(seriesCState({ stage: 6, earned: 370, spent: 470 })), savedAtMs: T0 };
  const sendBooks = (state) =>
    validateSave(books, { playerId: randomUUID(), state, actionsSinceLastSave: zeroActions(), clientBuild: "t" }, T0 + 5000);
  assert.equal(sendBooks(books.state).ok, true, "470 spent of 370 earned + 100 bonus");
  const over = normalizeSaveState(seriesCState({ stage: 0, earned: 370, spent: 371 }));
  const overResult = validateSave({ state: over, savedAtMs: T0 }, { playerId: randomUUID(), state: over, actionsSinceLastSave: zeroActions(), clientBuild: "t" }, T0 + 5000);
  assert.equal(overResult.rule, "PRESTIGE");
});

// --- The bonus pool ---

test("bonus Equity is spendable but never earned: the next sale's claimable is unchanged", () => {
  const lifetime = 509_306_167_821_012;
  const without = seriesCState({ runLoc: 9 * T, lastSale: lifetime - 9 * T, stage: 0 });
  const withAll = { ...without, roadshowStage: 6 };
  assert.equal(spendableEquity(without), 48);
  assert.equal(spendableEquity(withAll), 148);
  assert.equal(availableEquity(370, 322), 48, "the old two-argument call is unchanged");
  assert.equal(availableEquity(370, 322, 100), 148);
  // Claimable reads lifetimeEquityEarned only.
  assert.equal(claimableEquity(withAll.totalLinesOfCode, withAll.lifetimeEquityEarned), claimableEquity(without.totalLinesOfCode, without.lifetimeEquityEarned));
  assert.equal(claimableOf(withAll), claimableOf(without));
  // The header strip ("+N Equity if you sell now") reads the same.
  assert.deepEqual(
    equityStripModel(withAll.totalLinesOfCode, withAll.lifetimeEquityEarned, 1e9),
    equityStripModel(without.totalLinesOfCode, without.lifetimeEquityEarned, 1e9)
  );
  // A sale grants the same Equity and keeps the stage.
  const bigger = { ...withAll, totalLinesOfCode: 1.3e15 };
  const postWith = applyPrestigeSale(bigger, randomUUID());
  const postWithout = applyPrestigeSale({ ...bigger, roadshowStage: 0 }, randomUUID());
  assert.equal(postWith.lifetimeEquityEarned, postWithout.lifetimeEquityEarned);
  assert.equal(postWith.lifetimeEquityEarned, entitledEquity(1.3e15));
  assert.equal(postWith.roadshowStage, 6, "progress survives the sale");
  assert.equal(spendableEquity(postWith) - spendableEquity(postWithout), 100);
});

test("the store-buy check counts the bonus: IPO is affordable only with the roadshow", () => {
  const intermission = { saleId: randomUUID(), frozenHealthyPassiveLocPerSec: 1, frozenBestPayoutPerLocCents: 21 };
  const state = (stage) =>
    normalizeSaveState({ ...seriesCState({ earned: 506, spent: 235, stage }), prestigeIntermission: intermission });
  assert.equal(storeRankCost("fundingRounds", 5), 300);
  const without = validateStoreBuy(state(0), state(0), "fundingRounds", 5);
  assert.equal(without.ok, false);
  assert.match(without.detail, /only 271 spendable/);
  const withRoadshow = validateStoreBuy(state(6), state(6), "fundingRounds", 5);
  assert.deepEqual(withRoadshow, { ok: true, price: 300 });
});

test("every spendable Equity calculation goes through the one helper", () => {
  const permanentStore = src("client/src/components/PermanentStore.jsx");
  const sellCompany = src("client/src/components/SellCompany.jsx");
  const validate = src("server/src/validate.js");
  const store = src("server/src/store.js");
  for (const [name, text] of [
    ["PermanentStore", permanentStore],
    ["SellCompany", sellCompany],
    ["validate", validate],
    ["store", store],
  ]) {
    assert.match(text, /spendableEquity\(/, `${name} reads spendableEquity`);
    assert.doesNotMatch(text, /availableEquity\(\s*[\w.]*lifetimeEquityEarned/, `${name} has no earned-minus-spent call left`);
  }
  // The sale preview's "unspent afterward" builds on the same number.
  assert.match(sellCompany, /unspentAfter: spendable \+ claimable/);
  // The validator's books invariant counts the bonus.
  assert.match(validate, /newState\.lifetimeEquityEarned \+ roadshowBonusEquity\(newState\.roadshowStage\)/);
});

// --- End to end through the API ---

test("buying milestones charges cash once each, in order, and the stage persists", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const start = await setRawState(srv, playerId, seriesCState({ runLoc: 200 * T }));
  const price1 = roadshowPriceCents(1, buffedLocPerSecond(start));

  let res = await roadshowBuy(srv.base, playerId, 1, start);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.alreadyOwned, false);
  assert.deepEqual(body.purchase, { stage: 1, priceCents: price1, bonusEquity: 10, availableEquity: 58 });
  assert.equal(body.state.roadshowStage, 1);
  assert.equal(body.state.money, start.money - price1);
  assert.equal(body.state.lifetimeEquityEarned, 370, "never earned");

  // A retry of the same milestone: already owned, no second charge.
  res = await roadshowBuy(srv.base, playerId, 1, start);
  assert.equal(res.status, 200);
  const retry = await res.json();
  assert.equal(retry.alreadyOwned, true);
  assert.equal(retry.state.money, body.state.money);

  // Skipping a stage is rejected with the last good state.
  res = await roadshowBuy(srv.base, playerId, 3, body.state);
  assert.equal(res.status, 409);
  let rejected = await res.json();
  assert.equal(rejected.rule, "ROADSHOW");
  assert.equal(rejected.lastGoodState.state.roadshowStage, 1);

  // Milestones 2 and 3 (gates 75T, 150T) are met at 200T run LOC.
  for (const stage of [2, 3]) {
    res = await roadshowBuy(srv.base, playerId, stage, body.state);
    assert.equal(res.status, 200, `stage ${stage}`);
    body = await res.json();
  }
  assert.equal(body.state.roadshowStage, 3);
  assert.equal(body.purchase.bonusEquity, 40);

  // Milestone 4 needs 300T: rejected at 200T.
  res = await roadshowBuy(srv.base, playerId, 4, body.state);
  assert.equal(res.status, 409);
  rejected = await res.json();
  assert.match(rejected.detail, /needs 300000000000000 LOC/);

  // Unaffordable: the sent cash does not cover the price.
  const moreLoc = { ...body.state, totalLinesOfCode: body.state.totalLinesOfCode + 200 * T, money: 1 };
  res = await roadshowBuy(srv.base, playerId, 4, moreLoc);
  assert.equal(res.status, 409);
  assert.match((await res.json()).detail, /costs/);

  // An ordinary save cannot move it either.
  srv.advance(2000);
  res = await post(srv.base, "/api/save", {
    playerId,
    state: { ...body.state, roadshowStage: 6 },
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).rule, "ROADSHOW");

  // A malformed request is a 400.
  res = await post(srv.base, "/api/save/roadshow/buy", { playerId, stage: "4", state: body.state, actionsSinceLastSave: zeroActions() });
  assert.equal(res.status, 400);

  assert.equal((await loadState(srv.base, playerId)).roadshowStage, 3);
});

test("progress persists across a sale and is never re-farmed; the gate counts the new company", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  // Lifetime big enough for a sale: 1.3e15 entitles 506 Equity.
  const start = await setRawState(
    srv,
    playerId,
    seriesCState({ runLoc: 400 * T, lastSale: 900 * T, earned: 500, spent: 235 })
  );
  let state = start;
  for (const stage of [1, 2]) {
    const res = await roadshowBuy(srv.base, playerId, stage, state);
    assert.equal(res.status, 200);
    state = (await res.json()).state;
  }
  const res = await sell(srv.base, playerId, state);
  assert.equal(res.status, 200);
  const postSale = (await res.json()).state;
  assert.equal(postSale.roadshowStage, 2, "the sale keeps the stage");
  assert.equal(postSale.lifetimeEquityEarned, entitledEquity(1.3e15));
  assert.equal(spendableEquity(postSale), postSale.lifetimeEquityEarned - 235 + 25);
  // Milestone 1 again is already owned: nothing is re-farmed.
  const again = validateRoadshowBuy(normalizeSaveState(postSale), normalizeSaveState(postSale), 1);
  assert.equal(again.alreadyOwned, true);
  // Milestone 3 in the new company: blocked by the intermission now,
  // and by the gate (0 LOC this company) after it.
  const after = normalizeSaveState({ ...postSale, prestigeIntermission: null, money: 1e15 });
  assert.match(validateRoadshowBuy(after, after, 3).detail, /needs 150000000000000 LOC this company, only 0/);
});

test("end to end: the roadshow's bonus Equity buys the IPO in the store", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const runIt = async (withRoadshow) => {
    const playerId = await mintPlayer(srv.base);
    let state = await setRawState(
      srv,
      playerId,
      seriesCState({ runLoc: 900 * T, lastSale: 400 * T, earned: 500, spent: 235 })
    );
    if (withRoadshow) {
      for (let stage = 1; stage <= 6; stage += 1) {
        const res = await roadshowBuy(srv.base, playerId, stage, state);
        assert.equal(res.status, 200, `stage ${stage}`);
        state = (await res.json()).state;
      }
      assert.equal(state.roadshowStage, 6);
      assert.equal(spendableEquity(state), 365);
      // Six milestones bought: nothing left to buy.
      const res = await roadshowBuy(srv.base, playerId, 7, state);
      assert.equal(res.status, 409);
    }
    const sold = await sell(srv.base, playerId, state);
    assert.equal(sold.status, 200);
    const postSale = (await sold.json()).state;
    assert.equal(postSale.lifetimeEquityEarned, 506, "claimable is the same with or without");
    const bought = await storeBuy(srv.base, playerId, "fundingRounds", 5, postSale);
    return { postSale, bought, body: await bought.json() };
  };
  const plain = await runIt(false);
  assert.equal(plain.bought.status, 409, "271 spendable cannot buy a 300 Equity IPO");
  assert.match(plain.body.detail, /only 271 spendable/);
  const roadshow = await runIt(true);
  assert.equal(roadshow.bought.status, 200);
  assert.equal(roadshow.body.state.permanentStoreRanks.fundingRounds, 5);
  assert.equal(roadshow.body.state.equitySpent, 535);
  assert.equal(roadshow.body.purchase.availableEquity, 71, "506 + 100 - 535");
  assert.equal(roadshow.body.state.lifetimeEquityEarned, 506);
  // At IPO the roadshow is closed.
  const ipo = normalizeSaveState(roadshow.body.state);
  assert.equal(roadshowOpen(ipo.permanentStoreRanks), false);
});

test("the client engine buys through the endpoint and restores the server's state", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const start = await setRawState(srv, playerId, seriesCState({ runLoc: 30 * T }));
  const storage = new Map([["grq:playerId", playerId]]);
  let clientState = null;
  const engine = new SaveSync({
    apiBaseUrl: srv.base,
    getState: () => clientState,
    restore: (saveState) => {
      clientState = { ...(clientState ?? {}), ...saveStateToGameFields(saveState), clickHistory: [], currentCPS: 0 };
    },
    storage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
  });
  await engine.init();
  assert.equal(clientState.roadshowStage, 0);
  const result = await engine.buyRoadshowMilestone();
  assert.equal(result.ok, true);
  assert.equal(clientState.roadshowStage, 1);
  assert.equal(clientState.money, start.money - roadshowPriceCents(1, buffedLocPerSecond(start)));
  assert.equal(spendableEquity(clientState), 58);
  // Milestone 2 needs 75T: the server says no, the local state is untouched.
  const blocked = await engine.buyRoadshowMilestone();
  assert.deepEqual([blocked.ok, blocked.error], [false, "ROADSHOW"]);
  assert.equal(clientState.roadshowStage, 1);
  engine.stop();
});

// --- Save compatibility ---

test("old saves load at stage 0, keep validating, and the field round-trips", async (t) => {
  const old = initialSaveState();
  delete old.roadshowStage;
  assert.equal(normalizeSaveState(old).roadshowStage, 0);
  assert.equal(saveStateToGameFields(old).roadshowStage, 0);
  assert.equal(isInitialSaveState(stateToSaveState(saveStateToGameFields(old))), true);
  const fields = saveStateToGameFields({ ...initialSaveState(), roadshowStage: 4 });
  assert.equal(fields.roadshowStage, 4);
  assert.equal(stateToSaveState(fields).roadshowStage, 4);
  assert.equal(isInitialSaveState({ ...initialSaveState(), roadshowStage: 1 }), false);
  assert.equal(
    bigActionIncreased(bigActionFields({ ...initialSaveState(), roadshowStage: 1 }), bigActionFields({ ...initialSaveState(), roadshowStage: 2 })),
    true
  );
  // Through the server: a stored save without the field loads, and a
  // save of it (backfilled the way the client does) is accepted.
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const stored = seriesCState();
  delete stored.roadshowStage;
  await setRawState(srv, playerId, stored);
  const loaded = await loadState(srv.base, playerId);
  assert.equal(loaded.roadshowStage, undefined);
  srv.advance(2000);
  const res = await post(srv.base, "/api/save", {
    playerId,
    state: stateToSaveState(saveStateToGameFields(loaded)),
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  // And the roadshow works on it.
  const buy = await roadshowBuy(srv.base, playerId, 1, normalizeSaveState(loaded));
  assert.equal(buy.status, 200);
  assert.equal((await buy.json()).state.roadshowStage, 1);
});

// --- GITMail ---

test("one GITMail per milestone, once, linking to the card in Settings", () => {
  const sent = [];
  let emails = [];
  // Only the roadshow's mails count here: the plain test states also
  // trip unrelated teaser mails (other unlock thresholds).
  const roadshowKeys = () =>
    emails.map((e) => e.triggerKey).filter((k) => k.startsWith("roadshow-"));
  const step = (prev, next) => {
    const before = roadshowKeys().length;
    const out = collectTriggerEmails({ ...prev, emails }, { ...next, emails });
    emails = out.emails;
    return { newEmailId: roadshowKeys().length > before ? out.newEmailId : null };
  };
  // Before Series C, nothing.
  const early = { ...seriesCState({ rank: 3, runLoc: 900 * T }), emails: [] };
  assert.equal(step(early, early).newEmailId, null);
  // At Series C below the first gate, nothing; crossing it mails #1.
  const below = seriesCState({ runLoc: 10 * T });
  assert.equal(step(below, below).newEmailId, null);
  const crossed = seriesCState({ runLoc: 30 * T });
  assert.notEqual(step(below, crossed).newEmailId, null);
  sent.push(...roadshowKeys());
  // Every later tick at the same stage sends nothing new.
  for (let i = 0; i < 5; i += 1) assert.equal(step(crossed, crossed).newEmailId, null);
  // A save loaded with the gate already met still gets its mail (no
  // transition needed), and a bought milestone moves to the next one.
  for (let stage = 1; stage < 6; stage += 1) {
    const s = seriesCState({ runLoc: 900 * T, stage });
    assert.notEqual(step(s, s).newEmailId, null, `milestone ${stage + 1}`);
    assert.equal(step(s, s).newEmailId, null, `milestone ${stage + 1} only once`);
  }
  assert.deepEqual(
    roadshowKeys(),
    [1, 2, 3, 4, 5, 6].map((n) => `roadshow-ready:${n}`)
  );
  // All six bought, at IPO, or in the intermission: nothing more.
  const done = seriesCState({ runLoc: 900 * T, stage: 6 });
  assert.equal(step(done, done).newEmailId, null);
  const ipo = seriesCState({ runLoc: 900 * T, stage: 2, rank: 5 });
  assert.equal(roadshowReadyMilestone(ipo), 0);
  const inIntermission = { ...seriesCState({ runLoc: 900 * T }), prestigeIntermission: { saleId: "x" } };
  assert.equal(roadshowReadyMilestone(inIntermission), 0);

  // The mails themselves: the issue's names, the link, the label.
  for (const [i, m] of ROADSHOW_CONFIG.milestones.entries()) {
    const mail = buildRoadshowReadyEmail(i + 1);
    assert.deepEqual(mail.target, { tab: "settings", itemId: ROADSHOW_EMAIL_ITEM_ID });
    assert.equal(emailTargetError(mail.target), null);
    assert.ok(mail.body.includes(m.name), m.name);
    assert.ok(mail.body.includes(`${m.equity} bonus Equity`));
    assert.ok(mail.body.includes(`${m.priceMinutes} minutes of shipping income`));
    assert.ok(mail.body.length <= 2000 && mail.subject.length <= 200);
    const { emails: inbox } = addEmail([], mail, `roadshow-ready:${i + 1}`, T0);
    assert.deepEqual(emailDetailModel(inbox[0]).link, {
      target: { tab: "settings", itemId: "roadshow" },
      label: "Open the IPO Roadshow",
    });
  }
  assert.equal(buildRoadshowReadyEmail(7), null);
  // The link opens Settings and the card's anchor picks it up.
  const nav = navigateToTarget({ activeTab: "shop", layoutMode: "mobile", highlightSeq: 0 }, { tab: "settings", itemId: "roadshow" });
  assert.equal(nav.activeTab, "settings");
  assert.equal(highlightMatches(nav.highlightTarget, "settings", "roadshow"), true);
  assert.ok(sent.length === 1);
});

// --- The card ---

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test("the card: its own collapse key, collapsed by default, rows and reasons from the shared helpers", () => {
  const storage = memoryStorage();
  assert.equal(ROADSHOW_OPEN_KEY, "grq:roadshowOpen");
  assert.equal(readRoadshowOpen(storage), false, "collapsed by default");
  writeRoadshowOpen(true, storage);
  assert.equal(storage.map.get("grq:roadshowOpen"), "1");
  assert.equal(readRoadshowOpen(storage), true);
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readRoadshowOpen(throwing), false);
  writeRoadshowOpen(true, throwing);

  assert.equal(roadshowCardModel(seriesCState({ rank: 3 }), 1e9), null, "hidden before Series C");
  assert.equal(
    roadshowCardModel({ ...seriesCState(), prestigeIntermission: { saleId: "x" } }, 1e9),
    null,
    "hidden in the intermission"
  );
  const model = roadshowCardModel(seriesCState({ runLoc: 200 * T, stage: 2, money: 0 }), 1e9);
  assert.equal(model.chip, "2/6");
  assert.equal(model.bonusEquity, 25);
  assert.equal(model.status, "open");
  assert.deepEqual(model.rows.map((r) => r.state), ["bought", "bought", "next", "later", "later", "later"]);
  assert.equal(model.rows[2].priceCents, roadshowPriceCents(3, 1e9));
  assert.equal(model.rows[2].gate.met, true);
  assert.equal(model.rows[3].gate.met, false);
  assert.equal(model.shortReason, "Need more cash");
  const gated = roadshowCardModel(seriesCState({ runLoc: 100 * T, stage: 2 }), 1e9);
  assert.equal(gated.shortReason, "Locked");
  assert.equal(roadshowCardModel(seriesCState({ stage: 6 }), 1e9).chip, "6/6 Done");
  const closed = roadshowCardModel(seriesCState({ rank: 5, stage: 4 }), 1e9);
  assert.equal(closed.chip, "Closed at IPO");
  assert.equal(closed.next, null);
  assert.deepEqual(closed.rows.map((r) => r.state), ["bought", "bought", "bought", "bought", "missed", "missed"]);

  const card = src("client/src/components/RoadshowCard.jsx");
  assert.match(card, /aria-expanded=\{open\}/);
  assert.match(card, /aria-controls=\{detailId\}/);
  assert.match(card, /comment-text/, "JSDoc style");
  assert.match(card, /<ProgressBar/, "gate progress bars");
  assert.match(card, /buyRoadshowMilestone\(\)/, "buys through the server");
  assert.match(card, /disabled=\{busy \|\| !next\.canBuy\}/);
  const settings = src("client/src/components/Settings.jsx");
  assert.match(settings, /<SellCompany \/>[\s\S]*<HighlightAnchor tab="settings" itemId=\{ROADSHOW_EMAIL_ITEM_ID\}>\s*<RoadshowCard \/>/);
});

test("no em or en dashes in the roadshow's player-facing text", () => {
  const texts = [
    ...ROADSHOW_CONFIG.milestones.flatMap((m) => [m.name, m.quip]),
    ...[1, 2, 3, 4, 5, 6].flatMap((n) => {
      const mail = buildRoadshowReadyEmail(n);
      return [mail.sender, mail.subject, mail.body];
    }),
    src("client/src/components/RoadshowCard.jsx"),
    src("client/src/utils/roadshowCard.js"),
  ];
  for (const text of texts) {
    assert.doesNotMatch(text, /[–—]/, text.slice(0, 60));
  }
});

test("the Commit click float stays locked", () => {
  assertCommitFloatLocked();
});
