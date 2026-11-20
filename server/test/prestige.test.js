/**
 * Tests for prestige Slice 1 (Sell the Company): lifetime accounting,
 * Equity, the Founder multiplier, the atomic sale, and the sale
 * endpoint's idempotency. Runs against a real store backed by
 * in-memory Postgres (pg-mem), with an injected clock — the same
 * harness as reset.test.js. Player states are set by updating the
 * save row directly, except where the test saves through the real
 * /api/save endpoint to prove the normal path still enforces its
 * rules around a sale.
 *
 * Acceptance criteria from the v2 prestige design, section 9:
 * 1. Spending 200,000 LOC does not lower lifetime progress.
 * 2. Selling at 1M awards one Equity; a later sale at 4M cumulative
 *    awards one more, not two more.
 * 3. Selling at 6M awards two Equity if none was claimed, and
 *    preserves 6M cumulative progress.
 * 4. Spending Equity leaves the Founder multiplier unchanged.
 * 5. Simultaneous/retried sale actions grant rewards and starting
 *    cash once.
 * 8. Sale and offline intervals settle in timestamp order without lost
 *    or duplicated production. (Slice 1 validates the SALE and
 *    OFFLINE portions; burst/crash belong to Slice 3/4 and are not
 *    applicable yet.)
 * 13. All run automation is actually cleared on sale; permanent UI
 *     preferences do not silently restore purchased managers.
 * 15. Migrating the seeded save (Lifetime LOC 16,533,977) yields four
 *     claimable Equity, zero claimed and zero spendable before sale.
 *     Selling once produces four claimed Equity, four spendable Equity
 *     and 1.40x Founder production. (A seeded fixture, not Brandon's
 *     live save, which was reset Nov 11.)
 * 16. The seeded save's next-Equity estimate is 8,466,023 / 3,660
 *     seconds, approximately 38m 33s, without subtracting its LOC bank.
 * 17. Eighty-five total Equity requires 7.225B lifetime LOC, and the
 *     full store costs exactly 85 Equity.
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
  claimableEquity,
  companyLocEarned,
  emptyFarmState,
  entitledEquity,
  equityThresholdLoc,
  formatEstimateDuration,
  founderMultiplier,
  initialSaveState,
  locPerClick,
  locPerSecond,
  nextEquityEstimate,
  PRESTIGE_CONFIG,
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

/** Store a raw state object as-is (no initial-state merge): for a
 * save that predates prestige, with the prestige fields deleted. */
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

// --- Pure Equity math (criteria 15, 16, 17) ---

test("entitled Equity follows floor(cbrt(lifetime LOC / 10M)) (issue #170)", () => {
  assert.equal(entitledEquity(0), 0);
  assert.equal(entitledEquity(9_999_999), 0);
  assert.equal(entitledEquity(10_000_000), 1);
  assert.equal(entitledEquity(79_999_999), 1);
  assert.equal(entitledEquity(80_000_000), 2);
  assert.equal(entitledEquity(120_000_000), 2);
  assert.equal(entitledEquity(270_000_000), 3);
  assert.equal(entitledEquity(640_000_000), 4);
  assert.equal(entitledEquity(656_533_977), 4);
  assert.equal(entitledEquity(1_250_000_000), 5);
  assert.equal(entitledEquity(10_000_000_000), 10);
  // NaN, negative and missing read as 0, never NaN.
  assert.equal(entitledEquity(Number.NaN), 0);
  assert.equal(entitledEquity(-5), 0);
  assert.equal(entitledEquity(undefined), 0);
  // Exact at every boundary: a float cube root that lands a hair
  // under a whole number can never withhold the point, and just short
  // of a threshold never grants it. Below 2^53 "just short" is one
  // LOC; above it (from 966 Equity, 9.01Qa) doubles are spaced more
  // than 1 apart, so the step is a few units in the last place.
  for (let n = 1; n <= 2000; n += 1) {
    const threshold = equityThresholdLoc(n);
    const step = threshold < 2 ** 53 ? 1 : threshold * 2 ** -50;
    assert.equal(entitledEquity(threshold), n, `at ${n}`);
    assert.equal(entitledEquity(threshold - step), n - 1, `below ${n}`);
  }
});

test("Equity thresholds are 10M x n^3; the 622-Equity store needs 2.41Qa lifetime LOC (criterion 17, issue #170)", () => {
  assert.equal(equityThresholdLoc(0), 0);
  assert.equal(equityThresholdLoc(1), 10_000_000);
  assert.equal(equityThresholdLoc(2), 80_000_000);
  assert.equal(equityThresholdLoc(4), 640_000_000);
  assert.equal(equityThresholdLoc(87), 6_585_030_000_000);
  assert.equal(equityThresholdLoc(Number.NaN), 0);
  // The store grew to 622 with Funding Rounds (issue #170).
  assert.equal(PRESTIGE_CONFIG.totalStoreEquityCost, 622);
  assert.equal(equityThresholdLoc(622), 2_406_418_480_000_000);
});

test("Founder multiplier: 1 + 0.10P to P=50, then log growth", () => {
  assert.equal(founderMultiplier(0), 1);
  assert.equal(founderMultiplier(1), 1.1);
  assert.equal(founderMultiplier(4), 1.4);
  assert.equal(founderMultiplier(10), 2);
  assert.equal(founderMultiplier(50), 6);
  assert.equal(founderMultiplier(100), 6.5);
  assert.equal(founderMultiplier(200), 7);
});

test("claimable Equity is entitled minus earned; available is claimed minus spent", () => {
  assert.equal(claimableEquity(656_533_977, 0), 4);
  assert.equal(claimableEquity(656_533_977, 4), 0);
  assert.equal(claimableEquity(120_000_000, 0), 2);
  assert.equal(claimableEquity(80_000_000, 1), 1);
  assert.equal(availableEquity(4, 0), 4);
  assert.equal(availableEquity(4, 4), 0);
  assert.equal(availableEquity(4, 9), 0);
});

test("next-Equity estimate for the seeded save is 593,466,023 / 3,660s, about 45h 2m (criterion 16)", () => {
  const estimate = nextEquityEstimate(656_533_977, 3660);
  assert.equal(estimate.entitled, 4);
  assert.equal(estimate.nextThresholdLoc, 1_250_000_000);
  assert.equal(estimate.remainingLoc, 593_466_023);
  // 593,466,023 / 3,660 = 162,149.19s = 45h 2m. The estimate never
  // subtracts the LOC bank: it is remaining lifetime LOC over rate.
  assert.ok(Math.abs(estimate.seconds - 593_466_023 / 3660) < 1e-9);
  assert.equal(formatEstimateDuration(estimate.seconds), "45h 2m");
});

test("next-Equity estimate with no production is null, not a number", () => {
  const estimate = nextEquityEstimate(5_000_000, 0);
  assert.equal(estimate.remainingLoc, 5_000_000);
  assert.equal(estimate.seconds, null);
});

test("estimate durations format as seconds, minutes, and hours", () => {
  assert.equal(formatEstimateDuration(45), "45s");
  assert.equal(formatEstimateDuration(273), "4m 33s");
  assert.equal(formatEstimateDuration(2280), "38m");
  assert.equal(formatEstimateDuration(3600), "1h");
  assert.equal(formatEstimateDuration(4372), "1h 12m");
});

test("Founder multiplier applies once to click and employee production, and spending Equity leaves it unchanged (criterion 4)", () => {
  const counts = {
    intern: 10,
    junior: 0,
    senior: 0,
    projectManager: 0,
    commitSpecialist: 0,
    releaseManager: 0,
  };
  const zeroLevels = OPEN_SOURCE_IDS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
  // 10 interns at 1.40x (P=4) produce 14 LOC/s, not 10.
  assert.equal(locPerSecond(counts, zeroLevels, founderMultiplier(4)), 14);
  assert.equal(locPerSecond(counts, zeroLevels), 10);
  // A click with OverReact L1 (1 + 1) at 1.40x: floor(1 x 2 x 1.4) = 2.
  const overReact1 = { ...zeroLevels, overReactFramework: 1 };
  assert.equal(
    locPerClick(overReact1, counts, 1, founderMultiplier(4)),
    2
  );
  // Spending all four Equity (Slice 2 store) leaves the multiplier
  // at 1.40x: it is based on Lifetime Equity EARNED, even if spent.
  assert.equal(founderMultiplier(4), 1.4);
  assert.equal(availableEquity(4, 4), 0);
});

// --- Pure sale construction ---

test("applyPrestigeSale returns null when there is nothing to claim", () => {
  const state = initialSaveState();
  assert.equal(applyPrestigeSale(state, randomUUID()), null);
  const rich = { ...initialSaveState(), totalLinesOfCode: 9_999_999 };
  assert.equal(applyPrestigeSale(rich, randomUUID()), null);
});

test("applyPrestigeSale resets the company and keeps the lifetime books", () => {
  const saleId = randomUUID();
  const pre = initialSaveState();
  pre.linesOfCode = 9_792_056;
  pre.totalLinesOfCode = 656_533_977;
  pre.money = 38800;
  pre.employees = {
    intern: 36,
    junior: 19,
    senior: 15,
    projectManager: 5,
    commitSpecialist: 4,
    releaseManager: 2,
  };
  pre.freelanceProjectsCompleted = {
    toDoListApp: 500,
    hobbyWebsite: 100,
    paradigmShiftingBlockchainProject: 25,
    aiPoweredDashboard: 0,
    nftMarketplace: 0,
    metaverseRealEstate: 0,
    quantumToDoList: 0,
  };
  pre.releaseManagerAssignments = {
    toDoListApp: 2,
    hobbyWebsite: 0,
    paradigmShiftingBlockchainProject: 0,
    aiPoweredDashboard: 0,
    nftMarketplace: 0,
    metaverseRealEstate: 0,
    quantumToDoList: 0,
  };
  pre.autoShipsCompleted = {
    toDoListApp: 40,
    hobbyWebsite: 0,
    paradigmShiftingBlockchainProject: 0,
    aiPoweredDashboard: 0,
    nftMarketplace: 0,
    metaverseRealEstate: 0,
    quantumToDoList: 0,
  };
  pre.openSourceProjects = {
    overReactFramework: 5,
    blocker: 3,
    constellation: 4,
    starBroker: 2,
    coffeeScript: 3,
    juniorAchievement: 1,
    seniorMoment: 0,
    scrumMaster: 0,
    commitmentIssues: 0,
    shipHappens: 0,
    // A bridged company (issue #192): the sale resets the bridge too.
    bridgeRound: 1,
  };
  pre.activeStarEffects = [
    {
      effect: "frenzy",
      multiplier: 3,
      expiresAtMs: T0 + 30_000,
      employeeType: null,
    },
  ];
  pre.nextStarAtMs = T0 + 60_000;
  pre.lastStarBuyAtMs = T0 - 120_000;
  pre.farm = {
    owned: true,
    stalls: Array.from({ length: 9 }, (_, i) => ({
      llama: i < 2 ? "classic" : null,
      lighting: "warm",
    })),
    unlockedTypes: ["classic", "drama"],
  };
  pre.unlockedCosmetics = ["intern-icon-bronze"];
  pre.equippedCosmetics = { employeeIcon_intern: "intern-icon-bronze" };
  pre.emails = [
    {
      id: randomUUID(),
      triggerKey: "employee-unlocked:junior",
      sender: "HR Dept",
      subject: "Hi",
      body: "Hello",
      createdAtMs: T0,
      read: false,
    },
  ];

  const post = applyPrestigeSale(pre, saleId);
  assert.notEqual(post, null);
  // The reward: 4 Equity from 16,533,977 lifetime LOC.
  assert.equal(post.lifetimeEquityEarned, 4);
  assert.equal(post.equitySpent, 0);
  assert.equal(post.saleCount, 1);
  assert.equal(post.lastSaleId, saleId);
  // Lifetime progress survives; Company LOC restarts from it.
  assert.equal(post.totalLinesOfCode, 656_533_977);
  assert.equal(post.lifetimeLocAtLastSale, 656_533_977);
  assert.equal(companyLocEarned(post), 0);
  // Company state resets to new-company defaults.
  assert.equal(post.linesOfCode, 0);
  assert.equal(post.money, 0);
  assert.deepEqual(post.employees, {
    intern: 0,
    junior: 0,
    senior: 0,
    projectManager: 0,
    commitSpecialist: 0,
    releaseManager: 0,
  });
  assert.deepEqual(post.freelanceProjectsCompleted, {
    toDoListApp: 0,
    hobbyWebsite: 0,
    paradigmShiftingBlockchainProject: 0,
    aiPoweredDashboard: 0,
    nftMarketplace: 0,
    metaverseRealEstate: 0,
    quantumToDoList: 0,
  });
  assert.deepEqual(post.releaseManagerAssignments, {
    toDoListApp: 0,
    hobbyWebsite: 0,
    paradigmShiftingBlockchainProject: 0,
    aiPoweredDashboard: 0,
    nftMarketplace: 0,
    metaverseRealEstate: 0,
    quantumToDoList: 0,
  });
  assert.deepEqual(post.autoShipsCompleted, {
    toDoListApp: 0,
    hobbyWebsite: 0,
    paradigmShiftingBlockchainProject: 0,
    aiPoweredDashboard: 0,
    nftMarketplace: 0,
    metaverseRealEstate: 0,
    quantumToDoList: 0,
  });
  assert.deepEqual(post.openSourceProjects, {
    overReactFramework: 0,
    blocker: 0,
    constellation: 0,
    starBroker: 0,
    moonshot: 0,
    launchPad: 0,
    coffeeScript: 0,
    juniorAchievement: 0,
    seniorMoment: 0,
    scrumMaster: 0,
    commitmentIssues: 0,
    shipHappens: 0,
    bridgeRound: 0,
  });
  assert.deepEqual(post.activeStarEffects, []);
  // The farm resets: no llamas, no barn, no types (Brandon, Nov 15).
  assert.deepEqual(post.farm, emptyFarmState());
  // Unlock latches re-derive from the post-sale state: LOC-gated ones
  // re-fire at once from lifetime LOC, count-gated ones wait.
  assert.equal(post.unlockedEmployees.intern, true);
  assert.equal(post.unlockedEmployees.junior, true);
  assert.equal(post.unlockedEmployees.senior, false);
  assert.equal(post.unlockedEmployees.projectManager, false);
  assert.equal(post.unlockedOpenSourceProjects.overReactFramework, true);
  assert.equal(post.unlockedOpenSourceProjects.constellation, true);
  assert.equal(post.unlockedOpenSourceProjects.starBroker, true);
  assert.equal(post.unlockedFreelanceProjects.toDoListApp, true);
  assert.equal(post.unlockedFreelanceProjects.hobbyWebsite, false);
  // The remaining star-spawn interval and the buy cooldown persist
  // (selling must not reroll an immediate star).
  assert.equal(post.nextStarAtMs, T0 + 60_000);
  assert.equal(post.lastStarBuyAtMs, T0 - 120_000);
  // Achievements, cosmetics, and the inbox persist.
  assert.deepEqual(post.unlockedCosmetics, ["intern-icon-bronze"]);
  assert.deepEqual(post.equippedCosmetics, {
    employeeIcon_intern: "intern-icon-bronze",
  });
  assert.equal(post.emails.length, 1);
});

// --- The sale endpoint ---

test("criterion 15: seeded save with 656,533,977 lifetime LOC claims 4 Equity, 4 spendable, 1.40x Founder", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 9_792_056,
      totalLinesOfCode: 656_533_977,
      money: 38800,
      employees: { intern: 36, junior: 19, senior: 15 },
    });
    // Before sale: four claimable, zero claimed, zero spendable.
    assert.equal(claimableEquity(pre.totalLinesOfCode, 0), 4);
    assert.equal(availableEquity(0, 0), 0);

    const res = await sell(srv.base, playerId, pre);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.sale.gainedEquity, 4);
    assert.equal(body.sale.lifetimeEquityEarned, 4);
    assert.equal(body.sale.founderMultiplierBefore, 1);
    assert.equal(body.sale.founderMultiplierAfter, 1.4);
    assert.equal(body.sale.saleCount, 1);
    assert.equal(body.state.lifetimeEquityEarned, 4);
    assert.equal(body.state.equitySpent, 0);
    assert.equal(availableEquity(4, 0), 4);
    assert.equal(body.state.totalLinesOfCode, 656_533_977);
    assert.equal(body.state.linesOfCode, 0);
    assert.equal(body.state.money, 0);
    assert.equal(body.state.saleCount, 1);
  } finally {
    await srv.stop();
  }
});

test("criterion 2: sale at 10M awards one Equity; a later sale at 80M cumulative awards one more", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 10_000_000,
      money: 100000,
      employees: { intern: 10 },
    });
    const first = await sell(srv.base, playerId, pre);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.sale.gainedEquity, 1);
    assert.equal(firstBody.state.lifetimeEquityEarned, 1);

    // Earn to 80M cumulative in the new company (a normal save from
    // the post-sale baseline, past the rate limit).
    srv.advance(2000);
    const grown = {
      ...firstBody.state,
      linesOfCode: 70_000_000,
      totalLinesOfCode: 80_000_000,
    };
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: grown,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200);

    // The second sale claims exactly one more, not two more.
    const second = await sell(srv.base, playerId, grown);
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.sale.gainedEquity, 1);
    assert.equal(secondBody.state.lifetimeEquityEarned, 2);
    assert.equal(secondBody.state.totalLinesOfCode, 80_000_000);
    assert.equal(secondBody.sale.founderMultiplierAfter, 1.2);
  } finally {
    await srv.stop();
  }
});

test("criterion 3: selling at 120M awards two Equity and preserves 120M cumulative progress", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 120_000_000,
      totalLinesOfCode: 120_000_000,
    });
    const res = await sell(srv.base, playerId, pre);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sale.gainedEquity, 2);
    assert.equal(body.state.lifetimeEquityEarned, 2);
    assert.equal(body.state.totalLinesOfCode, 120_000_000);
    assert.equal(body.state.lifetimeLocAtLastSale, 120_000_000);
  } finally {
    await srv.stop();
  }
});

test("criterion 1: spending 200,000 LOC on Quantum To-Do List does not lower lifetime progress", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 500_000,
      totalLinesOfCode: 12_000_000,
      money: 100000,
    });
    const entitledBefore = entitledEquity(pre.totalLinesOfCode);
    srv.advance(2000);
    // Ship the Quantum: 200,000 LOC leaves the bank, lifetime stays.
    const spent = { ...pre, linesOfCode: 300_000, money: 4300000 };
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: spent,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200);
    assert.equal(entitledEquity(spent.totalLinesOfCode), entitledBefore);
    assert.equal(entitledEquity(spent.totalLinesOfCode), 1);
    // And the sale still claims that one Equity.
    const res = await sell(srv.base, playerId, spent);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).sale.gainedEquity, 1);
  } finally {
    await srv.stop();
  }
});

test("a sale with no new Equity is a 409, and a second sale with a new id and no new LOC is a 409", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 100,
      totalLinesOfCode: 100,
    });
    const res = await sell(srv.base, playerId, pre);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.rule, "SALE");

    // Sell once for real, then try again with a fresh sale id and no
    // new production: still nothing to claim.
    const rich = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 10_000_000,
    });
    const first = await sell(srv.base, playerId, rich);
    assert.equal(first.status, 200);
    const postState = (await first.json()).state;
    const second = await sell(srv.base, playerId, postState);
    assert.equal(second.status, 409);
    assert.equal((await second.json()).rule, "SALE");
  } finally {
    await srv.stop();
  }
});

test("criterion 5: simultaneous and retried sale actions grant the reward once", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 10_000_000,
    });
    const saleId = randomUUID();
    // Two simultaneous attempts with the same sale id. In production
    // Postgres the row lock (SELECT ... FOR UPDATE) serializes them:
    // the second waits, then sees lastSaleId and answers
    // already-applied. pg-mem does NOT enforce the lock, so both
    // transactions read the same snapshot and both answer ok — but
    // both compute the claim from the SAME pre-sale state, so the
    // stored outcome is still exactly one claim either way. What this
    // part asserts is the invariant that matters in both engines:
    // both attempts succeed and the stored state grants the reward
    // exactly once. The already-applied branch itself is covered by
    // the sequential retry below, which exercises it deterministically.
    const [first, second] = await Promise.all([
      sell(srv.base, playerId, pre, saleId),
      sell(srv.base, playerId, pre, saleId),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    // Exactly one claim: one Equity, one sale.
    const stored = await loadState(srv.base, playerId);
    assert.equal(stored.lifetimeEquityEarned, 1);
    assert.equal(stored.saleCount, 1);
    assert.equal(stored.lastSaleId, saleId);

    // A later sequential retry with the same sale id is a no-op too.
    const retry = await sell(srv.base, playerId, pre, saleId);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).alreadyApplied, true);
    const storedAgain = await loadState(srv.base, playerId);
    assert.equal(storedAgain.lifetimeEquityEarned, 1);
    assert.equal(storedAgain.saleCount, 1);
  } finally {
    await srv.stop();
  }
});

test("criterion 5 (unsaved progress): the sale settles from the sent lifetime LOC, not the stored one", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    // Stored: 9,000,000 lifetime LOC (no Equity yet).
    await setState(srv, playerId, {
      linesOfCode: 900_000,
      totalLinesOfCode: 9_000_000,
    });
    // Sent: 11,000,000, 2,000,000 LOC earned since the last save.
    const sent = initialSaveState();
    sent.linesOfCode = 1_100_000;
    sent.totalLinesOfCode = 11_000_000;
    const res = await sell(srv.base, playerId, sent);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sale.gainedEquity, 1);
    assert.equal(body.state.totalLinesOfCode, 11_000_000);
  } finally {
    await srv.stop();
  }
});

test("criterion 8 (sale + offline): sale then reload settles with no lost or duplicated production", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 4_000_000,
      totalLinesOfCode: 80_000_000,
      money: 500000,
      employees: { intern: 10, junior: 5 },
    });
    const res = await sell(srv.base, playerId, pre);
    assert.equal(res.status, 200);
    const sold = await res.json();

    // A reload (after any offline gap — there is no offline earning,
    // so absence credits nothing) returns exactly the post-sale
    // state: lifetime LOC and claimed Equity intact, company at 0.
    const loaded = await loadState(srv.base, playerId);
    assert.deepEqual(loaded, sold.state);
    assert.equal(loaded.totalLinesOfCode, 80_000_000);
    assert.equal(loaded.lifetimeEquityEarned, 2);
    assert.equal(loaded.linesOfCode, 0);

    // A later normal save validates against the post-sale baseline
    // and grows from it: production after the sale is credited once.
    srv.advance(2000);
    const grown = { ...loaded, linesOfCode: 500, totalLinesOfCode: 80_000_500 };
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: grown,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200);
    const reloaded = await loadState(srv.base, playerId);
    assert.equal(reloaded.totalLinesOfCode, 80_000_500);
    assert.equal(reloaded.lifetimeEquityEarned, 2);
  } finally {
    await srv.stop();
  }
});

test("criterion 13: run automation is actually cleared on sale", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 10_000_000,
      money: 500000,
      employees: { intern: 30, junior: 10, releaseManager: 2 },
      releaseManagerAssignments: {
        toDoListApp: 2,
        hobbyWebsite: 0,
        paradigmShiftingBlockchainProject: 0,
        aiPoweredDashboard: 0,
        nftMarketplace: 0,
        metaverseRealEstate: 0,
        quantumToDoList: 0,
      },
      autoShipsCompleted: {
        toDoListApp: 40,
        hobbyWebsite: 0,
        paradigmShiftingBlockchainProject: 0,
        aiPoweredDashboard: 0,
        nftMarketplace: 0,
        metaverseRealEstate: 0,
        quantumToDoList: 0,
      },
      // Ship Happens caps at 1 while Bootstrapped (issue #192).
      openSourceProjects: { shipHappens: 1, overReactFramework: 1 },
    });
    const res = await sell(srv.base, playerId, pre);
    assert.equal(res.status, 200);
    const post = (await res.json()).state;
    // No managers, no assignments, no auto-ship history, no doubling
    // levels left to restore them: a later save cannot silently
    // bring the automation back, because the post-sale baseline is 0.
    assert.equal(post.employees.releaseManager, 0);
    assert.deepEqual(post.releaseManagerAssignments, {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
      aiPoweredDashboard: 0,
      nftMarketplace: 0,
      metaverseRealEstate: 0,
      quantumToDoList: 0,
    });
    assert.deepEqual(post.autoShipsCompleted, {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
      aiPoweredDashboard: 0,
      nftMarketplace: 0,
      metaverseRealEstate: 0,
      quantumToDoList: 0,
    });
    assert.equal(post.openSourceProjects.shipHappens, 0);
  } finally {
    await srv.stop();
  }
});

test("migration: a save from before prestige shipped backfills to 0 and still validates", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    // A pre-prestige stored state: the five prestige fields deleted.
    const old = initialSaveState();
    old.linesOfCode = 500_000;
    old.totalLinesOfCode = 15_000_000;
    delete old.lifetimeEquityEarned;
    delete old.equitySpent;
    delete old.saleCount;
    delete old.lifetimeLocAtLastSale;
    delete old.lastSaleId;
    await setRawState(srv, playerId, old);

    // A normal save from a new client (fields present at 0) validates
    // against it: migration uses the existing lifetime counter as-is.
    srv.advance(2000);
    const current = initialSaveState();
    current.linesOfCode = 500_000;
    current.totalLinesOfCode = 15_000_000;
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: current,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200);

    // And the migrated save can sell on its lifetime LOC: 1 Equity.
    const res = await sell(srv.base, playerId, current);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).sale.gainedEquity, 1);
  } finally {
    await srv.stop();
  }
});

test("the farm resets on sale: llamas, barn, and discovered types do not survive", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 10_000_000,
      money: 2000000,
      farm: {
        owned: true,
        stalls: Array.from({ length: 9 }, (_, i) => ({
          llama: i === 0 ? "classic" : i === 1 ? "drama" : null,
          lighting: "warm",
        })),
        unlockedTypes: ["classic", "drama"],
      },
    });
    const res = await sell(srv.base, playerId, pre);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).state.farm, emptyFarmState());
  } finally {
    await srv.stop();
  }
});

test("normal saves cannot move the Equity books: decreases and sale-only changes are rejected", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 10_000_000,
    });
    const sold = await sell(srv.base, playerId, pre);
    assert.equal(sold.status, 200);
    const soldState = (await sold.json()).state;
    srv.advance(2000);

    // Lowering Lifetime Equity earned is a MONOTONIC rejection.
    const lowered = { ...soldState, lifetimeEquityEarned: 0 };
    const r1 = await post(srv.base, "/api/save", {
      playerId,
      state: lowered,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(r1.status, 409);
    assert.equal((await r1.json()).rule, "MONOTONIC");

    // Spending more Equity than earned is a PRESTIGE rejection.
    const overspent = { ...soldState, equitySpent: 99 };
    const r2 = await post(srv.base, "/api/save", {
      playerId,
      state: overspent,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(r2.status, 409);
    assert.equal((await r2.json()).rule, "PRESTIGE");

    // Changing the sale id outside a sale is a PRESTIGE rejection.
    const reId = { ...soldState, lastSaleId: randomUUID() };
    const r3 = await post(srv.base, "/api/save", {
      playerId,
      state: reId,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(r3.status, 409);
    assert.equal((await r3.json()).rule, "PRESTIGE");
  } finally {
    await srv.stop();
  }
});

test("a sale cannot touch another player's save", async () => {
  const srv = await startTestServer();
  try {
    const playerA = await mintPlayer(srv.base);
    const playerB = await mintPlayer(srv.base);
    const preA = await setState(srv, playerA, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 10_000_000,
    });
    await setState(srv, playerB, {
      linesOfCode: 2_000_000,
      totalLinesOfCode: 20_000_000,
    });
    const res = await sell(srv.base, playerA, preA);
    assert.equal(res.status, 200);
    const loadedB = await loadState(srv.base, playerB);
    assert.equal(loadedB.linesOfCode, 2_000_000);
    assert.equal(loadedB.totalLinesOfCode, 20_000_000);
    assert.equal(loadedB.lifetimeEquityEarned, 0);
  } finally {
    await srv.stop();
  }
});

test("malformed sale bodies are 400; unknown players are 404", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 10_000_000,
    });
    const badId = await post(srv.base, "/api/save/sell", {
      playerId,
      saleId: "not-a-uuid",
      state: pre,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(badId.status, 400);
    const noState = await post(srv.base, "/api/save/sell", {
      playerId,
      saleId: randomUUID(),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(noState.status, 400);
    const ghost = await post(
      srv.base,
      "/api/save/sell",
      sellBody(randomUUID(), pre)
    );
    assert.equal(ghost.status, 404);
  } finally {
    await srv.stop();
  }
});
