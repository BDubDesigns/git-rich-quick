/**
 * Tests for prestige Slice 2 (the permanent store): the five store
 * tracks, the frozen Starting Capital quote, the post-sale
 * intermission, and the store endpoints' idempotency. Runs against
 * a real store backed by in-memory Postgres (pg-mem), with an
 * injected clock — the same harness as prestige.test.js. Player
 * states are set by updating the save row directly, except where the
 * test saves through the real /api/save endpoint to prove the normal
 * path still enforces its rules around a purchase.
 *
 * Acceptance criteria from the v2 prestige design, section 9:
 * 18. Store offers five upgrade tracks (Starting Capital, Keyboard,
 *     Engineering Handbook, Client Network, Company Template) with
 *     ranks purchasable in order, prices fixed in Equity, and the
 *     total cost of all ranks exactly 85 Equity.
 * 19. Starting Capital is a production-time benefit priced from the
 *     frozen outgoing quote: at R=3,660, q=$0.21, rank 1 = $192.15,
 *     rank 2 = $384.30, rank 3 = $768.60. The quote is frozen at the
 *     sale (buying a rank in the intermission does not recalculate
 *     from the empty new company), the grant applies once, and the
 *     one-minute grant ($46,116) is rejected.
 * 20. Buying a store rank in the intermission applies once (no
 *     double-apply on reload or retry), and purchases are available
 *     only in the intermission.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  applyPrestigeSale,
  availableEquity,
  bestFreelancePayoutPerLocCents,
  clientNetworkPayoutMultiplier,
  completePrestigeIntermission,
  handbookProductionMultiplier,
  initialSaveState,
  keyboardClickBonus,
  locPerClick,
  locPerSecond,
  normalizeSaveState,
  prestigeSaleQuote,
  startingCapitalGrantCents,
  startingCapitalQuoteCents,
  storeMaxRank,
  storeNextRankCost,
  storePurchaseEstimate,
  storeRankCost,
  storeTotalEquityCost,
  PRESTIGE_CONFIG,
  PRESTIGE_STORE_CONFIG,
  PRESTIGE_STORE_IDS,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;

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
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
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

/** Set a player's stored state directly (test setup, not the save path). */
async function setState(srv, playerId, overrides) {
  const state = initialSaveState();
  for (const [key, value] of Object.entries(overrides)) {
    state[key] =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? { ...state[key], ...value }
        : value;
  }
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return state;
}

/** Store a raw state object as-is (no initial-state merge). */
async function setRawState(srv, playerId, state) {
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return state;
}

async function loadState(base, playerId) {
  const res = await fetch(`${base}/api/load?playerId=${playerId}`);
  assert.equal(res.status, 200);
  return (await res.json()).state;
}

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

/** A sale request for a pre-sale state, with a fresh sale id. */
function sellBody(playerId, state, saleId = randomUUID()) {
  return {
    playerId,
    saleId,
    state,
    actionsSinceLastSave: zeroActions(),
  };
}

async function sell(base, playerId, state, saleId) {
  return post(base, "/api/save/sell", sellBody(playerId, state, saleId));
}

/** A store-buy request for a state carrying the open intermission. */
function buyBody(playerId, storeId, rank, state) {
  return {
    playerId,
    storeId,
    rank,
    state,
    actionsSinceLastSave: zeroActions(),
  };
}

async function buy(base, playerId, storeId, rank, state) {
  return post(
    base,
    "/api/save/store/buy",
    buyBody(playerId, storeId, rank, state)
  );
}

/** An intermission-completion request for a state carrying it. */
function completeBody(playerId, state) {
  return {
    playerId,
    state,
    actionsSinceLastSave: zeroActions(),
  };
}

async function complete(base, playerId, state) {
  return post(
    base,
    "/api/save/intermission/complete",
    completeBody(playerId, state)
  );
}

/**
 * A pre-sale company with a known healthy rate: 100 interns at 1
 * LOC/s each, no open-source levels, no Founder multiplier, so
 * R = 100. All seven freelance projects unlocked, so the best payout
 * per LOC is Quantum's 21 cents. Lifetime LOC 16,533,977 entitles 4
 * Equity, the same seeded figure as the Slice 1 tests.
 */
function richPreSaleState() {
  const state = initialSaveState();
  state.linesOfCode = 9_792_056;
  state.totalLinesOfCode = 16_533_977;
  state.money = 38800;
  state.employees = {
    intern: 100,
    junior: 0,
    senior: 0,
    projectManager: 0,
    commitSpecialist: 0,
    releaseManager: 0,
  };
  state.unlockedFreelanceProjects = {
    toDoListApp: true,
    hobbyWebsite: true,
    paradigmShiftingBlockchainProject: true,
    aiPoweredDashboard: true,
    nftMarketplace: true,
    metaverseRealEstate: true,
    quantumToDoList: true,
  };
  return state;
}

/** Sell the rich company through the API; returns the post-sale state. */
async function sellRichCompany(srv, playerId) {
  const pre = await setState(srv, playerId, richPreSaleState());
  const res = await sell(srv.base, playerId, pre);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  return body.state;
}

// --- Pure store math (criteria 18, 19) ---

test("the store totals exactly 87 Equity for all ranks (criterion 18 + issue #149)", () => {
  assert.deepEqual(PRESTIGE_STORE_IDS, [
    "startingCapital",
    "keyboard",
    "engineeringHandbook",
    "clientNetwork",
    "companyTemplate",
    "nightShiftContract",
  ]);
  assert.deepEqual(PRESTIGE_STORE_CONFIG.startingCapital.rankCosts, [1, 3, 8]);
  assert.deepEqual(PRESTIGE_STORE_CONFIG.keyboard.rankCosts, [2, 5, 10]);
  assert.deepEqual(PRESTIGE_STORE_CONFIG.engineeringHandbook.rankCosts, [
    3, 8, 20,
  ]);
  assert.deepEqual(PRESTIGE_STORE_CONFIG.clientNetwork.rankCosts, [2, 6, 15]);
  assert.deepEqual(PRESTIGE_STORE_CONFIG.companyTemplate.rankCosts, [2]);
  assert.deepEqual(PRESTIGE_STORE_CONFIG.nightShiftContract.rankCosts, [2]);
  // 85 for the Slice 2 store plus 2 for the Night Shift Contract.
  assert.equal(storeTotalEquityCost(), 87);
  assert.equal(PRESTIGE_CONFIG.totalStoreEquityCost, 87);
  // Prices are per rank, not cumulative: rank 2 of Starting Capital
  // costs 3, not 1 + 3.
  assert.equal(storeRankCost("startingCapital", 1), 1);
  assert.equal(storeRankCost("startingCapital", 2), 3);
  assert.equal(storeRankCost("startingCapital", 3), 8);
  assert.equal(storeRankCost("startingCapital", 4), null);
  assert.equal(storeRankCost("companyTemplate", 1), 2);
  assert.equal(storeRankCost("companyTemplate", 2), null);
  assert.equal(storeMaxRank("startingCapital"), 3);
  assert.equal(storeMaxRank("companyTemplate"), 1);
  assert.equal(storeNextRankCost("keyboard", 0), 2);
  assert.equal(storeNextRankCost("keyboard", 2), 10);
  assert.equal(storeNextRankCost("keyboard", 3), null);
});

test("Starting Capital quotes at R=3,660, q=$0.21 are $192.15 / $384.30 / $768.60 (criterion 19)", () => {
  assert.equal(startingCapitalQuoteCents(3660, 21, 1), 19215);
  assert.equal(startingCapitalQuoteCents(3660, 21, 2), 38430);
  assert.equal(startingCapitalQuoteCents(3660, 21, 3), 76860);
  // The one-minute grant ($46,116) is explicitly rejected: the rank
  // seconds are 0.25 / 0.50 / 1.00, never 60.
  assert.notEqual(startingCapitalQuoteCents(3660, 21, 3), 4611600);
  // The grant is max(current money, one base-price Intern, quote):
  // the $25 Intern floor beats a zero quote, and money already held
  // beats the quote.
  assert.equal(startingCapitalGrantCents(0, 0, 0, 1), 2500);
  assert.equal(startingCapitalGrantCents(0, 3660, 21, 3), 76860);
  assert.equal(startingCapitalGrantCents(100000, 3660, 21, 3), 100000);
  // No rank, no grant: normal new-company defaults.
  assert.equal(startingCapitalGrantCents(0, 3660, 21, 0), 0);
  assert.equal(startingCapitalGrantCents(500, 3660, 21, 0), 500);
});

test("the best payout per LOC is the highest-tier unlocked project's rate (criterion 19)", () => {
  const all = {
    toDoListApp: true,
    hobbyWebsite: true,
    paradigmShiftingBlockchainProject: true,
    aiPoweredDashboard: true,
    nftMarketplace: true,
    metaverseRealEstate: true,
    quantumToDoList: true,
  };
  // Quantum unlocked: 21 cents per LOC, the design's reference q.
  assert.equal(bestFreelancePayoutPerLocCents(all), 21);
  // Only the To Do List App: 60 cents per LOC.
  assert.equal(
    bestFreelancePayoutPerLocCents({ toDoListApp: true }),
    60
  );
  // Client Network applies to q (and is never applied a second time
  // to the grant): rank 3 is 21 x 1.15 = 24.15 cents per LOC.
  assert.equal(
    bestFreelancePayoutPerLocCents(all, { clientNetwork: 3 }),
    24.15
  );
});

test("Keyboard, Handbook, and Client Network effects are exact (criterion 18)", () => {
  const zeroLevels = OPEN_SOURCE_IDS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
  const noEmployees = EMPLOYEE_TYPES.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
  // Keyboard adds to the base click of 1: max rank makes it 4
  // before multipliers.
  assert.equal(locPerClick(zeroLevels, noEmployees, 1, 1), 1);
  assert.equal(
    locPerClick(zeroLevels, noEmployees, 1, 1, { keyboard: 1 }),
    2
  );
  assert.equal(
    locPerClick(zeroLevels, noEmployees, 1, 1, { keyboard: 3 }),
    4
  );
  assert.equal(keyboardClickBonus({}), 0);
  assert.equal(keyboardClickBonus({ keyboard: 3 }), 3);
  // Handbook is one additive rank bonus, multiplied once with the
  // Founder multiplier: 100 interns at rank 3 are 115 LOC/s, not
  // three compounded 1.05x steps (100 x 1.05^3 = 115.76, floored
  // 115 either way — so check rank 1 too: 105, not 105.0 floored
  // from a compound).
  const hundredInterns = { ...noEmployees, intern: 100 };
  assert.equal(locPerSecond(hundredInterns, zeroLevels, 1), 100);
  assert.equal(
    locPerSecond(hundredInterns, zeroLevels, 1, {
      engineeringHandbook: 1,
    }),
    105
  );
  assert.equal(
    locPerSecond(hundredInterns, zeroLevels, 1, {
      engineeringHandbook: 3,
    }),
    115
  );
  assert.equal(handbookProductionMultiplier({}), 1);
  assert.equal(
    handbookProductionMultiplier({ engineeringHandbook: 3 }),
    1.15
  );
  // Client Network multiplies freelance payouts only: 1.05 / 1.10 /
  // 1.15, and it never changes LOC costs (no LOC function reads it).
  assert.equal(clientNetworkPayoutMultiplier({}), 1);
  assert.equal(clientNetworkPayoutMultiplier({ clientNetwork: 1 }), 1.05);
  assert.equal(clientNetworkPayoutMultiplier({ clientNetwork: 2 }), 1.1);
  assert.equal(clientNetworkPayoutMultiplier({ clientNetwork: 3 }), 1.15);
});

test("the sale freezes the outgoing quote on the intermission (criterion 19)", () => {
  const pre = richPreSaleState();
  const quote = prestigeSaleQuote(pre);
  assert.equal(quote.healthyPassiveLocPerSec, 100);
  assert.equal(quote.bestPayoutPerLocCents, 21);
  const post = applyPrestigeSale(pre, randomUUID());
  assert.notEqual(post, null);
  assert.deepEqual(post.prestigeIntermission, {
    saleId: post.lastSaleId,
    frozenHealthyPassiveLocPerSec: 100,
    frozenBestPayoutPerLocCents: 21,
  });
  // The company is empty, but the quote is the sold company's.
  assert.equal(post.employees.intern, 0);
  assert.equal(post.lifetimeEquityEarned, 4);
  // Completing the intermission with Starting Capital rank 3 grants
  // from the frozen quote (100 x 21 x 1.00 = $21.00) — but the $25
  // one-Intern floor beats it, so the grant is $25.00, not $21.00.
  // The quote path itself is covered by startingCapitalQuoteCents
  // above (and by the R=3,660 HTTP test below, where the quote wins).
  const withRank = {
    ...post,
    permanentStoreRanks: {
      startingCapital: 3,
      keyboard: 0,
      engineeringHandbook: 0,
      clientNetwork: 0,
      companyTemplate: 0,
    },
  };
  const completed = completePrestigeIntermission(withRank);
  assert.equal(completed.money, 2500);
  assert.equal(completed.prestigeIntermission, null);
  // Completing again is a no-op (already completed): no second grant.
  assert.equal(completePrestigeIntermission(completed), null);
  // With no Starting Capital rank, money is unchanged.
  const noRank = completePrestigeIntermission(post);
  assert.equal(noRank.money, 0);
  assert.equal(noRank.prestigeIntermission, null);
});

test("favorites reset on sale unless Company Template is owned (criterion 18)", () => {
  const pre = richPreSaleState();
  pre.favoriteOpenSourceProjects = ["blocker", "overReactFramework"];
  const withoutTemplate = applyPrestigeSale(pre, randomUUID());
  assert.deepEqual(withoutTemplate.favoriteOpenSourceProjects, []);
  const withTemplate = applyPrestigeSale(
    {
      ...pre,
      permanentStoreRanks: {
        startingCapital: 0,
        keyboard: 0,
        engineeringHandbook: 0,
        clientNetwork: 0,
        companyTemplate: 1,
      },
    },
    randomUUID()
  );
  assert.deepEqual(withTemplate.favoriteOpenSourceProjects, [
    "blocker",
    "overReactFramework",
  ]);
});

test("store purchase estimates use the target entitlement and the frozen rate (criterion 18)", () => {
  // Shortfall 3 Equity at 4 earned: target entitlement 7, threshold
  // 49M lifetime LOC; the save has 16,533,977, so 32,466,023 remain;
  // at the frozen 100 LOC/s that is 324,660.23 seconds.
  const estimate = storePurchaseEstimate(4, 16_533_977, 3, 100);
  assert.equal(estimate.targetEntitlement, 7);
  assert.equal(estimate.remainingLoc, 32_466_023);
  assert.ok(Math.abs(estimate.seconds - 324660.23) < 1e-9);
  // The target is already entitled but unclaimed: no earning time.
  const entitled = storePurchaseEstimate(4, 16_533_977, 0, 100);
  assert.equal(entitled.remainingLoc, 0);
  assert.equal(entitled.seconds, 0);
  // No production: the estimate cannot be a duration.
  const noRate = storePurchaseEstimate(4, 16_533_977, 3, 0);
  assert.equal(noRate.seconds, null);
});

test("old saves backfill the store fields and keep validating (criterion 18)", () => {
  const old = initialSaveState();
  delete old.permanentStoreRanks;
  delete old.prestigeIntermission;
  delete old.favoriteOpenSourceProjects;
  const normalized = normalizeSaveState(old);
  assert.deepEqual(normalized.permanentStoreRanks, {
    startingCapital: 0,
    keyboard: 0,
    engineeringHandbook: 0,
    clientNetwork: 0,
    companyTemplate: 0,
    nightShiftContract: 0,
  });
  assert.equal(normalized.prestigeIntermission, null);
  assert.deepEqual(normalized.favoriteOpenSourceProjects, []);
});

// --- HTTP: the intermission flow (criteria 18, 19, 20) ---

test("buying ranks in the intermission charges once and spends Equity (criteria 18, 20)", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const postSale = await sellRichCompany(srv, playerId);
  assert.equal(postSale.lifetimeEquityEarned, 4);
  assert.equal(postSale.equitySpent, 0);
  assert.equal(postSale.prestigeIntermission.frozenHealthyPassiveLocPerSec, 100);
  assert.equal(postSale.prestigeIntermission.frozenBestPayoutPerLocCents, 21);

  // Starting Capital rank 1 costs 1 Equity.
  let res = await buy(srv.base, playerId, "startingCapital", 1, postSale);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadyOwned, false);
  assert.deepEqual(body.purchase, {
    storeId: "startingCapital",
    rank: 1,
    price: 1,
    equitySpent: 1,
    availableEquity: 3,
  });
  assert.equal(body.state.permanentStoreRanks.startingCapital, 1);
  assert.equal(body.state.equitySpent, 1);
  // The intermission is still open after a purchase.
  assert.notEqual(body.state.prestigeIntermission, null);

  // Rank 2 costs 3 Equity (per-rank price, not cumulative).
  res = await buy(
    srv.base,
    playerId,
    "startingCapital",
    2,
    body.state
  );
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.purchase.price, 3);
  assert.equal(body.state.equitySpent, 4);
  assert.equal(body.state.permanentStoreRanks.startingCapital, 2);
  assert.equal(body.purchase.availableEquity, 0);

  // Rank 3 costs 8 Equity and none is left: insufficient funds.
  res = await buy(
    srv.base,
    playerId,
    "startingCapital",
    3,
    body.state
  );
  assert.equal(res.status, 409);
  const rejected = await res.json();
  assert.equal(rejected.rule, "STORE");
  assert.equal(rejected.lastGoodState.state.equitySpent, 4);
  assert.equal(
    rejected.lastGoodState.state.permanentStoreRanks.startingCapital,
    2
  );
});

test("a retried purchase is already-owned with no second charge (criterion 20)", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const postSale = await sellRichCompany(srv, playerId);

  let res = await buy(srv.base, playerId, "keyboard", 1, postSale);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.state.equitySpent, 2);

  // The first response was lost; the client retries the same rank.
  res = await buy(srv.base, playerId, "keyboard", 1, body.state);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadyOwned, true);
  assert.equal(body.state.equitySpent, 2);
  assert.equal(body.state.permanentStoreRanks.keyboard, 1);
  assert.equal(body.purchase.price, null);
});

test("buy validation: no intermission, wrong order, unknown track, past max (criterion 20)", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);

  // No intermission on a fresh save: the store is closed.
  const fresh = await loadState(srv.base, playerId);
  let res = await buy(srv.base, playerId, "keyboard", 1, fresh);
  assert.equal(res.status, 409);
  let body = await res.json();
  assert.equal(body.rule, "STORE");

  const postSale = await sellRichCompany(srv, playerId);

  // Rank 2 before rank 1: ranks are bought in order.
  res = await buy(srv.base, playerId, "keyboard", 2, postSale);
  assert.equal(res.status, 409);
  body = await res.json();
  assert.equal(body.rule, "STORE");

  // Unknown track.
  res = await buy(srv.base, playerId, "goldenParachute", 1, postSale);
  assert.equal(res.status, 409);
  body = await res.json();
  assert.equal(body.rule, "STORE");

  // Company Template has one rank: rank 2 does not exist.
  res = await buy(srv.base, playerId, "companyTemplate", 1, postSale);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.state.permanentStoreRanks.companyTemplate, 1);
  res = await buy(
    srv.base,
    playerId,
    "companyTemplate",
    2,
    body.state
  );
  assert.equal(res.status, 409);
  body = await res.json();
  assert.equal(body.rule, "STORE");
});

test("completing the intermission grants from the frozen quote, once (criterion 19)", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const postSale = await sellRichCompany(srv, playerId);

  // Buy Starting Capital rank 2 in the intermission: the frozen
  // quote is R=100, q=21c, so rank 2 is 100 x 21 x 0.50 = $10.50.
  let res = await buy(srv.base, playerId, "startingCapital", 1, postSale);
  assert.equal(res.status, 200);
  let body = await res.json();
  res = await buy(
    srv.base,
    playerId,
    "startingCapital",
    2,
    body.state
  );
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.state.equitySpent, 4);

  // Complete: the grant uses the frozen quote with the rank owned
  // (2): 100 x 21c x 0.50s = $10.50, below the $25 one-Intern floor,
  // so the grant is $25.00. The point is the grant comes from the
  // frozen quote path, and it applies once.
  res = await complete(srv.base, playerId, body.state);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadyCompleted, false);
  assert.equal(body.grant.applied, true);
  assert.equal(body.grant.cashCents, 2500);
  assert.equal(body.state.money, 2500);
  assert.equal(body.state.prestigeIntermission, null);

  // A retried completion is already-completed with no second grant.
  const completed = body.state;
  res = await complete(srv.base, playerId, completed);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadyCompleted, true);
  assert.equal(body.state.money, 2500);
  assert.equal(body.state.prestigeIntermission, null);
});

test("the frozen quote beats the empty company when the quote is bigger (criterion 19)", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  // A company with R=3,660 and Quantum unlocked: the design's
  // reference numbers. Rank 3 grants $768.60, far above the $25 floor.
  const pre = richPreSaleState();
  pre.employees = {
    intern: 3660,
    junior: 0,
    senior: 0,
    projectManager: 0,
    commitSpecialist: 0,
    releaseManager: 0,
  };
  await setState(srv, playerId, pre);
  const sellRes = await sell(srv.base, playerId, pre);
  assert.equal(sellRes.status, 200);
  let body = await sellRes.json();
  assert.equal(
    body.state.prestigeIntermission.frozenHealthyPassiveLocPerSec,
    3660
  );
  assert.equal(
    body.state.prestigeIntermission.frozenBestPayoutPerLocCents,
    21
  );

  // The sale claimed 4 Equity; rank 3 of Starting Capital costs
  // 1 + 3 + 8 = 12, which the player cannot afford. Buy rank 1
  // instead: 3660 x 21 x 0.25 = $192.15.
  let res = await buy(
    srv.base,
    playerId,
    "startingCapital",
    1,
    body.state
  );
  assert.equal(res.status, 200);
  body = await res.json();
  res = await complete(srv.base, playerId, body.state);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.grant.cashCents, 19215);
  assert.equal(body.state.money, 19215);
});

test("a normal save cannot change store ranks or clear the intermission (criterion 20)", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const postSale = await sellRichCompany(srv, playerId);

  // Buy Keyboard rank 1, then try to smuggle rank 2 in through a
  // normal save.
  let res = await buy(srv.base, playerId, "keyboard", 1, postSale);
  assert.equal(res.status, 200);
  let body = await res.json();
  const bought = body.state;
  srv.advance(2000);
  const smuggled = {
    ...bought,
    permanentStoreRanks: { ...bought.permanentStoreRanks, keyboard: 2 },
  };
  res = await post(srv.base, "/api/save", {
    playerId,
    state: smuggled,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 409);
  body = await res.json();
  assert.equal(body.rule, "STORE");
  assert.equal(body.lastGoodState.state.permanentStoreRanks.keyboard, 1);

  // And a normal save cannot clear the intermission either.
  srv.advance(2000);
  const cleared = { ...bought, prestigeIntermission: null };
  res = await post(srv.base, "/api/save", {
    playerId,
    state: cleared,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 409);
  body = await res.json();
  assert.equal(body.rule, "PRESTIGE");
  assert.notEqual(body.lastGoodState.state.prestigeIntermission, null);
});

test("store ranks persist across a second sale; the new quote uses the new company (criterion 18)", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const postSale = await sellRichCompany(srv, playerId);

  // Buy Keyboard rank 1, then complete the intermission.
  let res = await buy(srv.base, playerId, "keyboard", 1, postSale);
  assert.equal(res.status, 200);
  let body = await res.json();
  res = await complete(srv.base, playerId, body.state);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.state.permanentStoreRanks.keyboard, 1);
  assert.equal(body.state.prestigeIntermission, null);

  // Grow the company again (200 interns) and earn more lifetime
  // LOC, then sell a second time: the rank survives, and the new
  // intermission freezes the NEW company's quote. The Founder
  // multiplier is 1.4x from the 4 Equity earned, so the healthy rate
  // is 200 x 1.4 = 280, not 200: R includes permanent bonuses.
  const grown = {
    ...body.state,
    totalLinesOfCode: 25_000_000,
    employees: {
      intern: 200,
      junior: 0,
      senior: 0,
      projectManager: 0,
      commitSpecialist: 0,
      releaseManager: 0,
    },
  };
  srv.advance(2000);
  res = await post(srv.base, "/api/save", {
    playerId,
    state: grown,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  res = await sell(srv.base, playerId, grown);
  assert.equal(res.status, 200);
  body = await res.json();
  // 25M lifetime LOC entitles 5 Equity; 4 were earned, so 1 more.
  assert.equal(body.state.lifetimeEquityEarned, 5);
  assert.equal(body.state.permanentStoreRanks.keyboard, 1);
  assert.equal(
    body.state.prestigeIntermission.frozenHealthyPassiveLocPerSec,
    280
  );
});

test("a pre-store save backfills the store fields on save (criterion 18)", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const old = initialSaveState();
  delete old.permanentStoreRanks;
  delete old.prestigeIntermission;
  delete old.favoriteOpenSourceProjects;
  await setRawState(srv, playerId, old);
  // /api/load returns the stored state as-is: the fields are absent
  // there. The CLIENT backfills them on load (saveStateToGameFields),
  // so the save it sends carries the backfilled values — which is
  // what the server normalizes and validates here.
  const loaded = await loadState(srv.base, playerId);
  assert.equal(loaded.permanentStoreRanks, undefined);
  assert.equal(loaded.prestigeIntermission, undefined);
  assert.equal(loaded.favoriteOpenSourceProjects, undefined);
  const backfilled = normalizeSaveState(loaded);
  assert.deepEqual(backfilled.permanentStoreRanks, {
    startingCapital: 0,
    keyboard: 0,
    engineeringHandbook: 0,
    clientNetwork: 0,
    companyTemplate: 0,
    nightShiftContract: 0,
  });
  assert.equal(backfilled.prestigeIntermission, null);
  assert.deepEqual(backfilled.favoriteOpenSourceProjects, []);
  // And a normal save of that backfilled state succeeds.
  srv.advance(2000);
  const res = await post(srv.base, "/api/save", {
    playerId,
    state: backfilled,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
});
