/**
 * Tests for StarBroker — buying a golden star on demand.
 *
 * A bought star is a separate star from the natural one: the player
 * sacrifices 30x their passive LOC/s, the server deducts it from the
 * stored state and records a pending bought star, and the outcome is
 * rolled when the bought star is clicked (claim-bought) — never at buy
 * time. The natural star timer (next_star_at_ms) is never touched, so
 * a bought star stacks with a natural one. The cooldown halves per
 * level (8m, 4m, 2m, 1m, 30s); the cost stays flat at 30x at every
 * level. Runs against a real store backed by in-memory Postgres
 * (pg-mem), with an injected clock. Player states are set by updating
 * the save row directly — these tests are about the buy/claim
 * endpoints, not the save path — except the end-to-end tests, which
 * save through the real /api/save endpoint.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  STARBROKER_CONFIG,
  STAR_CONFIG,
  initialSaveState,
  locPerSecond,
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
    now: () => nowMs,
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
  // A player who owns Constellation levels necessarily met the
  // TOTAL_LOC >= 500 unlock (L1 costs 1000 LOC), and a player who owns
  // StarBroker levels necessarily met the TOTAL_LOC >= 5000 unlock
  // (L1 costs 10000 LOC) — so the fixture carries a realistic
  // lifetime-LOC base, otherwise the level rule rejects the state on save.
  if (
    (state.openSourceProjects?.constellation ?? 0) > 0 &&
    state.totalLinesOfCode < 1000
  ) {
    state.totalLinesOfCode = 1000;
  }
  if (
    (state.openSourceProjects?.starBroker ?? 0) > 0 &&
    state.totalLinesOfCode < 5000
  ) {
    state.totalLinesOfCode = 5000;
  }
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return state;
}

async function loadState(srv, playerId) {
  const res = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
  assert.equal(res.status, 200);
  return (await res.json()).state;
}

function zeroActions() {
  return {
    clicks: 0,
    employeesBought: { intern: 0, junior: 0, senior: 0 },
    projectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    openSourceLevelsBought: {
      overReactFramework: 0,
      blocker: 0,
      constellation: 0,
      starBroker: 0,
    },
    starClaims: [],
  };
}

/**
 * A player who can buy stars: Constellation L1, StarBroker L1, 10
 * interns (10 passive LOC/s, so a buy costs 30 x 10 = 300 LOC), and
 * 10,000 LOC on hand / lifetime (above the 5000 StarBroker unlock).
 */
async function starBrokerPlayer(srv, overrides = {}) {
  const playerId = await mintPlayer(srv.base);
  const stored = await setState(srv, playerId, {
    openSourceProjects: { constellation: 1, starBroker: 1 },
    unlockedOpenSourceProjects: { constellation: true, starBroker: true },
    employees: { intern: 10 },
    linesOfCode: 10000,
    totalLinesOfCode: 10000,
    ...overrides,
  });
  return { playerId, stored };
}

test("buy succeeds, deducts 30x passive LOC/s, and does not reset the natural star timer", async () => {
  const srv = await startTestServer();
  try {
    const { playerId } = await starBrokerPlayer(srv);
    // Roll the natural star time first, so the buy can be checked
    // against it.
    const before = await (
      await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
    ).json();
    assert.ok(before.nextStarAtMs > T0);
    // The next-star response carries the buy status.
    assert.equal(before.starBrokerLevel, 1);
    assert.equal(before.buyCooldownSecondsRemaining, 0);
    assert.equal(before.buyCost, 300);

    const bought = await post(srv.base, "/api/star/buy", { playerId });
    assert.equal(bought.status, 200);
    const data = await bought.json();
    // 10 interns = 10 passive LOC/s, so the cost is 30 x 10 = 300.
    assert.equal(data.cost, 300);
    assert.equal(data.linesOfCode, 10000 - 300);
    assert.equal(data.starBrokerLevel, 1);
    assert.equal(data.buyCooldownSeconds, 480);
    assert.equal(data.nextBuyAtMs, T0 + 480_000);
    assert.equal(data.boughtStarAtMs, T0);

    // The stored state's LOC is deducted.
    const stored = await loadState(srv, playerId);
    assert.equal(stored.linesOfCode, 9700);

    // The natural star timer is untouched: the same next star time.
    const after = await (
      await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
    ).json();
    assert.equal(after.nextStarAtMs, before.nextStarAtMs);
    assert.equal(after.buyCooldownSecondsRemaining, 480);
  } finally {
    await srv.stop();
  }
});

test("buy is rejected during the cooldown, then succeeds once it passes", async () => {
  const srv = await startTestServer();
  try {
    const { playerId } = await starBrokerPlayer(srv);
    const first = await post(srv.base, "/api/star/buy", { playerId });
    assert.equal(first.status, 200);

    const second = await post(srv.base, "/api/star/buy", { playerId });
    assert.equal(second.status, 409);
    const refused = await second.json();
    assert.equal(refused.error, "star-buy-cooldown");
    assert.equal(refused.nextBuyAtMs, T0 + 480_000);
    assert.equal(refused.cooldownSecondsRemaining, 480);

    // 479s in: still on cooldown (1s left).
    srv.advance(479_000);
    const third = await post(srv.base, "/api/star/buy", { playerId });
    assert.equal(third.status, 409);
    assert.equal((await third.json()).cooldownSecondsRemaining, 1);

    // Past the 8-minute cooldown: the buy succeeds again.
    srv.advance(2000);
    const fourth = await post(srv.base, "/api/star/buy", { playerId });
    assert.equal(fourth.status, 200);
    assert.equal((await fourth.json()).cost, 300);
  } finally {
    await srv.stop();
  }
});

test("buy is rejected without enough LOC", async () => {
  const srv = await startTestServer();
  try {
    const { playerId } = await starBrokerPlayer(srv, { linesOfCode: 100 });
    const res = await post(srv.base, "/api/star/buy", { playerId });
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.error, "not-enough-loc");
    assert.equal(data.cost, 300);
    assert.equal(data.linesOfCode, 100);
  } finally {
    await srv.stop();
  }
});

test("buy is rejected without StarBroker, and without Constellation", async () => {
  const srv = await startTestServer();
  try {
    // No StarBroker (level 0).
    const noBroker = await mintPlayer(srv.base);
    await setState(srv, noBroker, {
      openSourceProjects: { constellation: 1, starBroker: 0 },
      employees: { intern: 10 },
      linesOfCode: 10000,
      totalLinesOfCode: 10000,
    });
    const res1 = await post(srv.base, "/api/star/buy", {
      playerId: noBroker,
    });
    assert.equal(res1.status, 409);
    assert.equal((await res1.json()).error, "no-star-broker");

    // StarBroker but no Constellation levels: there is no star effect
    // pool to roll from.
    const noConstellation = await mintPlayer(srv.base);
    await setState(srv, noConstellation, {
      openSourceProjects: { constellation: 0, starBroker: 1 },
      employees: { intern: 10 },
      linesOfCode: 10000,
      totalLinesOfCode: 10000,
    });
    const res2 = await post(srv.base, "/api/star/buy", {
      playerId: noConstellation,
    });
    assert.equal(res2.status, 409);
    assert.equal((await res2.json()).error, "no-stars");
  } finally {
    await srv.stop();
  }
});

test("the cooldown halves per level and the cost stays flat at 30x", async () => {
  const srv = await startTestServer();
  try {
    // L1: 8-minute cooldown, 300 LOC cost.
    const l1 = await starBrokerPlayer(srv);
    const bought1 = await post(srv.base, "/api/star/buy", {
      playerId: l1.playerId,
    });
    assert.equal(bought1.status, 200);
    const data1 = await bought1.json();
    assert.equal(data1.buyCooldownSeconds, 480);
    assert.equal(data1.cost, 300);

    // L2: 4-minute cooldown, same 300 LOC cost (flat, not cut).
    const l2 = await starBrokerPlayer(srv, {
      openSourceProjects: { constellation: 1, starBroker: 2 },
    });
    const bought2 = await post(srv.base, "/api/star/buy", {
      playerId: l2.playerId,
    });
    assert.equal(bought2.status, 200);
    const data2 = await bought2.json();
    assert.equal(data2.buyCooldownSeconds, 240);
    assert.equal(data2.cost, 300);

    // L5: 30-second cooldown, still the same 300 LOC cost.
    const l5 = await starBrokerPlayer(srv, {
      openSourceProjects: { constellation: 1, starBroker: 5 },
    });
    const bought5 = await post(srv.base, "/api/star/buy", {
      playerId: l5.playerId,
    });
    assert.equal(bought5.status, 200);
    const data5 = await bought5.json();
    assert.equal(data5.buyCooldownSeconds, 30);
    assert.equal(data5.cost, 300);

    // The config itself halves per level.
    assert.deepEqual(STARBROKER_CONFIG.cooldownSeconds, [480, 240, 120, 60, 30]);
    assert.equal(STARBROKER_CONFIG.costLocPerSecondMultiplier, 30);
  } finally {
    await srv.stop();
  }
});

test("claim-bought succeeds and the claim saves; a second claim is rejected", async () => {
  const srv = await startTestServer();
  try {
    const { playerId, stored } = await starBrokerPlayer(srv);
    const bought = await post(srv.base, "/api/star/buy", { playerId });
    assert.equal(bought.status, 200);

    const claimed = await post(srv.base, "/api/star/claim-bought", {
      playerId,
    });
    assert.equal(claimed.status, 200);
    const claim = (await claimed.json()).claim;
    assert.ok(claim.claimId);

    // A second claim for the same bought star is rejected: the
    // pending star was cleared on claim.
    const again = await post(srv.base, "/api/star/claim-bought", {
      playerId,
    });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error, "no-bought-star");

    // The claim saves through the real save endpoint: the state is
    // the stored state (already deducted by the buy) plus the passive
    // earned in the 11s window and the claim's deltas.
    srv.advance(11_000);
    const saveNowMs = srv.now();
    const elapsedSeconds = (saveNowMs - T0) / 1000;
    const passive = Math.floor(
      locPerSecond(stored.employees, stored.openSourceProjects) *
        elapsedSeconds
    );
    const newState = {
      ...(await loadState(srv, playerId)),
      linesOfCode: Math.max(
        0,
        9700 + passive + claim.locDelta
      ),
      totalLinesOfCode:
        10000 + passive + Math.max(0, claim.locDelta),
      money: Math.max(0, claim.moneyDelta),
      activeStarEffects:
        claim.multiplier !== null
          ? [
              {
                effect: claim.effect,
                multiplier: claim.multiplier,
                expiresAtMs: T0 + claim.durationSeconds * 1000,
                employeeType: claim.employeeType,
              },
            ]
          : [],
    };
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: newState,
      actionsSinceLastSave: { ...zeroActions(), starClaims: [claim] },
    });
    assert.equal(saved.status, 200);
  } finally {
    await srv.stop();
  }
});

test("claim-bought with no pending bought star, and after its 30s lifetime, is rejected", async () => {
  const srv = await startTestServer();
  try {
    const { playerId } = await starBrokerPlayer(srv);

    // Never bought: nothing pending.
    const none = await post(srv.base, "/api/star/claim-bought", {
      playerId,
    });
    assert.equal(none.status, 409);
    assert.equal((await none.json()).error, "no-bought-star");

    // Bought, then 36s pass (past the 30s lifetime + 5s grace):
    // the bought star burned out.
    const bought = await post(srv.base, "/api/star/buy", { playerId });
    assert.equal(bought.status, 200);
    srv.advance(36_000);
    const expired = await post(srv.base, "/api/star/claim-bought", {
      playerId,
    });
    assert.equal(expired.status, 409);
    assert.equal((await expired.json()).error, "star-not-due");
  } finally {
    await srv.stop();
  }
});

test("end-to-end: a bought star and a natural star stack — both claims save", async () => {
  const srv = await startTestServer();
  try {
    const { playerId, stored } = await starBrokerPlayer(srv);

    // Make the natural star due FIRST, then buy: a bought star only
    // lives 30s, so buying before waiting 90-180s for the natural one
    // would let it burn out. In real play the player buys when the
    // natural star is about to land (or already on screen), so both
    // are live inside the same 30s window.
    const next = await (
      await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
    ).json();
    assert.ok(next.nextStarAtMs > T0);
    srv.advance(next.nextStarAtMs - T0);

    // Buy a star (pending bought star), then claim the natural star
    // and the bought star — both succeed, each with its own issued
    // outcome. The buy did not move the natural timer.
    const bought = await post(srv.base, "/api/star/buy", { playerId });
    assert.equal(bought.status, 200);
    const natural = await post(srv.base, "/api/star/claim", { playerId });
    assert.equal(natural.status, 200);
    const naturalClaim = (await natural.json()).claim;
    const boughtClaimRes = await post(srv.base, "/api/star/claim-bought", {
      playerId,
    });
    assert.equal(boughtClaimRes.status, 200);
    const boughtClaim = (await boughtClaimRes.json()).claim;
    assert.notEqual(boughtClaim.claimId, naturalClaim.claimId);

    // Both claims save together in one save.
    srv.advance(11_000);
    const saveNowMs = srv.now();
    const elapsedSeconds = (saveNowMs - T0) / 1000;
    const passive = Math.floor(
      locPerSecond(stored.employees, stored.openSourceProjects) *
        elapsedSeconds
    );
    const claims = [naturalClaim, boughtClaim];
    const locDelta = claims.reduce((sum, c) => sum + c.locDelta, 0);
    const moneyDelta = claims.reduce((sum, c) => sum + c.moneyDelta, 0);
    const buffs = claims
      .filter((c) => c.multiplier !== null)
      .map((c) => ({
        effect: c.effect,
        multiplier: c.multiplier,
        expiresAtMs: saveNowMs - 11_000 + c.durationSeconds * 1000,
        employeeType: c.employeeType,
      }));
    const newState = {
      ...(await loadState(srv, playerId)),
      linesOfCode: Math.max(0, 9700 + passive + locDelta),
      totalLinesOfCode:
        10000 + passive + Math.max(0, locDelta),
      money: Math.max(0, moneyDelta),
      activeStarEffects: buffs,
    };
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: newState,
      actionsSinceLastSave: { ...zeroActions(), starClaims: claims },
    });
    assert.equal(saved.status, 200);
  } finally {
    await srv.stop();
  }
});

test("StarBroker unlock: a level without TOTAL_LOC >= 5000 is rejected; a save without the key normalizes", async () => {
  const srv = await startTestServer();
  try {
    // A player at 1000 lifetime LOC (above Constellation's 500, below
    // StarBroker's 5000) cannot claim StarBroker level 1.
    const poor = await mintPlayer(srv.base);
    const poorStored = await setState(srv, poor, {
      openSourceProjects: { constellation: 1, starBroker: 0 },
      unlockedOpenSourceProjects: { constellation: true, starBroker: false },
      employees: { intern: 10 },
      linesOfCode: 20000,
      totalLinesOfCode: 1000,
    });
    srv.advance(11_000);
    const rejected = await post(srv.base, "/api/save", {
      playerId: poor,
      state: {
        ...poorStored,
        linesOfCode: 20000 - 10000 + 110,
        totalLinesOfCode: 1000 + 110,
        openSourceProjects: { ...poorStored.openSourceProjects, starBroker: 1 },
        unlockedOpenSourceProjects: {
          ...poorStored.unlockedOpenSourceProjects,
          starBroker: true,
        },
      },
      actionsSinceLastSave: {
        ...zeroActions(),
        openSourceLevelsBought: {
          ...zeroActions().openSourceLevelsBought,
          starBroker: 1,
        },
      },
    });
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).rule, "UNLOCK");

    // A player at 5000 lifetime LOC can claim it. (The fixture is
    // self-consistent: 20,000 LOC on hand implies 20,000 lifetime
    // LOC — a player with 20,000 current LOC necessarily has at
    // least that much lifetime LOC.)
    const rich = await mintPlayer(srv.base);
    const richStored = await setState(srv, rich, {
      openSourceProjects: { constellation: 1, starBroker: 0 },
      unlockedOpenSourceProjects: { constellation: true, starBroker: false },
      employees: { intern: 10 },
      linesOfCode: 20000,
      totalLinesOfCode: 20000,
    });
    srv.advance(11_000);
    const accepted = await post(srv.base, "/api/save", {
      playerId: rich,
      state: {
        ...richStored,
        linesOfCode: 20000 - 10000 + 110,
        totalLinesOfCode: 20000 + 110,
        openSourceProjects: { ...richStored.openSourceProjects, starBroker: 1 },
        unlockedOpenSourceProjects: {
          ...richStored.unlockedOpenSourceProjects,
          starBroker: true,
        },
      },
      actionsSinceLastSave: {
        ...zeroActions(),
        openSourceLevelsBought: {
          ...zeroActions().openSourceLevelsBought,
          starBroker: 1,
        },
      },
    });
    assert.equal(accepted.status, 200);

    // A save from before StarBroker shipped (no starBroker key in
    // the open-source maps) normalizes and validates instead of
    // failing the shape check.
    const old = await mintPlayer(srv.base);
    const oldState = initialSaveState();
    delete oldState.openSourceProjects.starBroker;
    delete oldState.unlockedOpenSourceProjects.starBroker;
    await srv.pool.query(
      `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
      [JSON.stringify(oldState), old]
    );
    srv.advance(11_000);
    const oldSaved = await post(srv.base, "/api/save", {
      playerId: old,
      state: { ...oldState, linesOfCode: 0, totalLinesOfCode: 0 },
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(oldSaved.status, 200);
  } finally {
    await srv.stop();
  }
});
