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
  // A player who owns Constellation levels necessarily met the
  // TOTAL_LOC >= 500 unlock (L1 costs 1000 LOC), so the fixture
  // carries a realistic lifetime-LOC base — otherwise the level rule
  // (star fix slice) rejects the state on save.
  if (
    (state.openSourceProjects?.constellation ?? 0) > 0 &&
    state.totalLinesOfCode < 1000
  ) {
    state.totalLinesOfCode = 1000;
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
    employeesBought: { intern: 0, junior: 0, senior: 0, projectManager: 0, commitSpecialist: 0 },
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

test("claiming a star after its 30s window has burned out is rejected", async () => {
  // Star fix slice: a star is only claimable inside its 30s lifetime
  // (plus 5s grace for client-timer skew). Once the window passes,
  // the claim is not due anymore — the client re-fetches and the
  // server rolls a fresh star.
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
    // Past the 30s lifetime plus the 5s grace.
    srv.advance(
      next.nextStarAtMs - T0 + STAR_CONFIG.starLifetimeSeconds * 1000 + 6000
    );
    const claimed = await post(srv.base, "/api/star/claim", { playerId });
    assert.equal(claimed.status, 409);
    const data = await claimed.json();
    assert.equal(data.error, "star-not-due");
  } finally {
    await srv.stop();
  }
});

test("an issued outcome older than 300s is rejected on save, even if it matches", async () => {
  // Star-claim-expiry fix: an issued outcome stays valid 300s after
  // issue (plus 5s grace), decoupled from the star's 30s on-screen
  // lifetime. The claim below matches the issued outcome exactly and
  // is unconsumed, but the save arrives 360s after the claim, so the
  // save is a STAR rejection — a stale outcome cannot be claimed late.
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
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

    // The save arrives 360s after the claim — past the 300s + 5s expiry.
    srv.advance(360_000);
    const saveNowMs = srv.now();
    const elapsedSeconds = (saveNowMs - T0) / 1000;
    const passive = Math.floor(
      locPerSecond(stored.employees, stored.openSourceProjects) *
        elapsedSeconds
    );
    const newState = {
      ...stored,
      linesOfCode: Math.max(0, passive + claim.locDelta),
      totalLinesOfCode:
        stored.totalLinesOfCode + passive + Math.max(0, claim.locDelta),
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
    assert.equal(saved.status, 409);
    assert.equal((await saved.json()).rule, "STAR");
  } finally {
    await srv.stop();
  }
});

test("end-to-end: a server-issued claim saves, and replaying it is rejected", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
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
      totalLinesOfCode:
        stored.totalLinesOfCode + passive + Math.max(0, claim.locDelta),
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

    // The load reflects the save: the stored lifetime LOC is the
    // previous lifetime plus the passive LOC plus the claimed star gain.
    const loaded = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
    assert.equal(loaded.status, 200);
    const loadedState = (await loaded.json()).state;
    assert.equal(
      loadedState.totalLinesOfCode,
      stored.totalLinesOfCode + passive + Math.max(0, claim.locDelta)
    );

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
