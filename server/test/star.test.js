/**
 * Tests for the server-rolled golden star (issue #29): the next-star
 * schedule and the outcome are both decided by the server. Runs
 * against a real store backed by in-memory Postgres (pg-mem), with an
 * injected clock. Player states are set by updating the save row
 * directly — these tests are about the star endpoints, not the save
 * path — except the end-to-end test, which saves through the real
 * /api/save endpoint.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  STAR_CONFIG,
  initialSaveState,
  locPerSecond,
  starBuffDurationSeconds,
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
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return state;
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
    },
    starClaims: [],
  };
}

test("GET /api/star/next rolls a time in the level interval and reports the countdown unlock", async () => {
  const srv = await startTestServer();
  try {
    // L1: the countdown is locked (unlock is L2).
    const l1 = await mintPlayer(srv.base);
    await setState(srv, l1, {
      openSourceProjects: { constellation: 1 },
      employees: { intern: 1 },
    });
    const next1 = await fetch(`${srv.base}/api/star/next?playerId=${l1}`);
    assert.equal(next1.status, 200);
    const data1 = await next1.json();
    assert.equal(data1.constellationLevel, 1);
    assert.equal(data1.countdownUnlocked, false);
    assert.ok(data1.nextStarAtMs > T0);
    assert.ok(data1.nextStarAtMs <= T0 + 180_000);
    assert.ok(data1.nextStarAtMs >= T0 + 90_000);
    assert.equal(
      data1.secondsUntilStar,
      Math.ceil((data1.nextStarAtMs - T0) / 1000)
    );

    // L2: the countdown is unlocked.
    const l2 = await mintPlayer(srv.base);
    await setState(srv, l2, {
      openSourceProjects: { constellation: 2 },
      employees: { intern: 1 },
    });
    const next2 = await fetch(`${srv.base}/api/star/next?playerId=${l2}`);
    const data2 = await next2.json();
    assert.equal(data2.countdownUnlocked, true);

    // Level 0: no stars, no time.
    const l0 = await mintPlayer(srv.base);
    const next0 = await fetch(`${srv.base}/api/star/next?playerId=${l0}`);
    const data0 = await next0.json();
    assert.equal(data0.nextStarAtMs, null);
    assert.equal(data0.secondsUntilStar, null);
    assert.equal(data0.countdownUnlocked, false);

    // Unknown player and malformed id.
    const unknown = await fetch(
      `${srv.base}/api/star/next?playerId=123e4567-e89b-42d3-a456-426614174000`
    );
    assert.equal(unknown.status, 404);
    const bad = await fetch(`${srv.base}/api/star/next?playerId=nope`);
    assert.equal(bad.status, 400);
  } finally {
    await srv.stop();
  }
});

test("GET /api/star/next rolls a fresh time after the star window passes unclaimed", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, {
      openSourceProjects: { constellation: 1 },
      employees: { intern: 1 },
    });
    const first = await (
      await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
    ).json();
    const firstTime = first.nextStarAtMs;
    // A second fetch before the window passes returns the same time.
    const same = await (
      await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
    ).json();
    assert.equal(same.nextStarAtMs, firstTime);
    // Past the star's 30s lifetime, the next fetch rolls a fresh time.
    srv.advance(firstTime - T0 + STAR_CONFIG.starLifetimeSeconds * 1000);
    const fresh = await (
      await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
    ).json();
    assert.ok(fresh.nextStarAtMs > srv.now());
    assert.notEqual(fresh.nextStarAtMs, firstTime);
  } finally {
    await srv.stop();
  }
});

test("POST /api/star/claim rejects when no star is due or there are no stars", async () => {
  const srv = await startTestServer();
  try {
    // Level 0: no stars at all.
    const l0 = await mintPlayer(srv.base);
    const noStars = await post(srv.base, "/api/star/claim", {
      playerId: l0,
    });
    assert.equal(noStars.status, 409);
    assert.equal((await noStars.json()).error, "no-stars");

    // L1, star not due yet (just rolled, 90-180s out).
    const l1 = await mintPlayer(srv.base);
    await setState(srv, l1, {
      openSourceProjects: { constellation: 1 },
      employees: { intern: 1 },
    });
    await fetch(`${srv.base}/api/star/next?playerId=${l1}`);
    const early = await post(srv.base, "/api/star/claim", {
      playerId: l1,
    });
    assert.equal(early.status, 409);
    const earlyData = await early.json();
    assert.equal(earlyData.error, "star-not-due");
    assert.ok(earlyData.nextStarAtMs > T0);

    // Unknown player.
    const unknown = await post(srv.base, "/api/star/claim", {
      playerId: "123e4567-e89b-42d3-a456-426614174000",
    });
    assert.equal(unknown.status, 404);
  } finally {
    await srv.stop();
  }
});

test("claiming a due star returns a server-rolled outcome and rolls the next time; a second claim is not due", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, {
      openSourceProjects: { constellation: 1 },
      employees: { intern: 1 },
    });
    const next = await (
      await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
    ).json();
    srv.advance(next.nextStarAtMs - T0);

    const claimed = await post(srv.base, "/api/star/claim", { playerId });
    assert.equal(claimed.status, 200);
    const data = await claimed.json();
    // The outcome is a Lucky roll at L1 (the only unlocked effect).
    assert.equal(data.claim.effect, "lucky");
    assert.equal(typeof data.claim.good, "boolean");
    assert.match(
      data.claim.claimId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    // The next star is rolled forward (a fresh 90-180s wait).
    assert.ok(data.nextStarAtMs > srv.now());
    assert.ok(data.secondsUntilStar >= 90);
    assert.ok(data.secondsUntilStar <= 180);

    // A second claim right away is not due — one claim per star.
    const again = await post(srv.base, "/api/star/claim", { playerId });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error, "star-not-due");
  } finally {
    await srv.stop();
  }
});

test("end-to-end: a server-issued claim saves, and replaying it is rejected", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    // Link the player to an account so the leaderboard can see it.
    await srv.pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)`,
      ["user-e2e", "E2E", "e2e@example.com"]
    );
    const link = await srv.store.linkPlayerToUser(playerId, "user-e2e");
    assert.equal(link.status, "ok");
    const stored = await setState(srv, playerId, {
      openSourceProjects: { constellation: 1 },
      employees: { intern: 1 },
      linesOfCode: 0,
      totalLinesOfCode: 0,
      money: 0,
    });
    const next = await (
      await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
    ).json();
    srv.advance(next.nextStarAtMs - T0);
    const nowMs = srv.now();

    const claimed = await post(srv.base, "/api/star/claim", { playerId });
    assert.equal(claimed.status, 200);
    const claim = (await claimed.json()).claim;

    // Build the save the way the client would: passive LOC for the
    // window (floored, so it never exceeds the server's continuous
    // credit) plus the claim's deltas, and the buff if it is timed.
    const elapsedSeconds = (nowMs - T0) / 1000;
    const passive = Math.floor(
      locPerSecond(stored.employees, stored.openSourceProjects) *
        elapsedSeconds
    );
    const newState = {
      ...stored,
      linesOfCode: Math.max(0, passive + claim.locDelta),
      totalLinesOfCode: passive + Math.max(0, claim.locDelta),
      money: Math.max(0, stored.money + claim.moneyDelta),
      activeStarEffects:
        claim.multiplier !== null
          ? [
              {
                effect: claim.effect,
                multiplier: claim.multiplier,
                expiresAtMs: nowMs + claim.durationSeconds * 1000,
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
    assert.equal(saved.status, 200, await saved.text());

    // The leaderboard reflects the save: the account's lifetime LOC
    // is the passive LOC plus the claimed star gain.
    const board = await fetch(`${srv.base}/api/leaderboard`);
    assert.equal(board.status, 200);
    const boardData = await board.json();
    assert.equal(boardData.entries.length, 1);
    assert.equal(boardData.entries[0].displayName, "E2E");
    assert.equal(boardData.entries[0].lifetimeLoc, passive + Math.max(0, claim.locDelta));

    // Replay the SAME claim in a later save: the issued outcome was
    // consumed, so it is rejected as a STAR violation.
    srv.advance(15_000);
    const replayState = {
      ...newState,
      linesOfCode: newState.linesOfCode + 15,
      totalLinesOfCode: newState.totalLinesOfCode + 15,
    };
    const replayed = await post(srv.base, "/api/save", {
      playerId,
      state: replayState,
      actionsSinceLastSave: { ...zeroActions(), starClaims: [claim] },
    });
    assert.equal(replayed.status, 409);
    const replayedData = await replayed.json();
    assert.equal(replayedData.rule, "STAR");
  } finally {
    await srv.stop();
  }
});

test("a forged star claim (never issued) is rejected on save", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const stored = await setState(srv, playerId, {
      openSourceProjects: { constellation: 1 },
      employees: { intern: 1 },
      linesOfCode: 1000,
      totalLinesOfCode: 1000,
      money: 0,
    });
    srv.advance(60_000);
    // A max-reward Lucky claim the server never issued.
    const forged = {
      claimId: "123e4567-e89b-42d3-a456-426614174000",
      effect: "lucky",
      good: true,
      locDelta: 50,
      moneyDelta: 0,
      multiplier: null,
      durationSeconds: null,
      employeeType: null,
    };
    const newState = {
      ...stored,
      linesOfCode: 1000 + 60 + 50,
      totalLinesOfCode: 1000 + 60 + 50,
    };
    const res = await post(srv.base, "/api/save", {
      playerId,
      state: newState,
      actionsSinceLastSave: { ...zeroActions(), starClaims: [forged] },
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).rule, "STAR");
  } finally {
    await srv.stop();
  }
});

test("starBuffDurationSeconds: total duration from effect + good/bad", () => {
  // The stored buff only carries expiresAtMs, so the effect duration
  // bar derives the total from the config. Good is a multiplier above
  // 1x, bad below 1x.
  assert.equal(starBuffDurationSeconds("frenzy", true), 60);
  assert.equal(starBuffDurationSeconds("frenzy", false), 30);
  assert.equal(starBuffDurationSeconds("click", true), 20);
  assert.equal(starBuffDurationSeconds("click", false), 10);
  assert.equal(starBuffDurationSeconds("employee", true), 60);
  assert.equal(starBuffDurationSeconds("employee", false), 30);
  assert.equal(starBuffDurationSeconds("lucky", true), null);
  assert.equal(starBuffDurationSeconds("nope", true), null);
});
