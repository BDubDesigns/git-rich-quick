/**
 * Tests for the Danger Zone reset (POST /api/save/reset): a player
 * wipes their own progress back to the fresh initial state. Runs
 * against a real store backed by in-memory Postgres (pg-mem), with an
 * injected clock. Player states are set by updating the save row
 * directly — these tests are about the reset endpoint, not the save
 * path — except the backwards-save test, which saves through the real
 * /api/save endpoint to prove the normal path still refuses it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { initialSaveState } from "../../shared/game-balance.js";

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

function zeroActions() {
  return {
    clicks: 0,
    employeesBought: {
      intern: 0,
      junior: 0,
      senior: 0,
      projectManager: 0,
      commitSpecialist: 0,
    },
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

test("reset returns the initial state and a reload shows 0 progress", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, {
      linesOfCode: 5000,
      totalLinesOfCode: 9000,
      money: 123456,
      employees: { intern: 5, junior: 2 },
      freelanceProjectsCompleted: { toDoListApp: 3 },
      openSourceProjects: { overReactFramework: 2 },
      emails: [
        {
          id: "email-1",
          triggerKey: "test",
          sender: "HR Dept",
          subject: "Hi",
          body: "Hello",
          createdAtMs: T0,
          read: false,
        },
      ],
    });

    const res = await post(srv.base, "/api/save/reset", { playerId });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.playerId, playerId);
    assert.deepEqual(body.state, initialSaveState());

    // A reload shows the fresh game, not the old save.
    const load = await fetch(
      `${srv.base}/api/load?playerId=${playerId}`
    );
    assert.equal(load.status, 200);
    const loaded = await load.json();
    assert.deepEqual(loaded.state, initialSaveState());
  } finally {
    await srv.stop();
  }
});

test("a normal backwards save is still rejected, but the reset is accepted", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, {
      linesOfCode: 100,
      totalLinesOfCode: 100,
      money: 3000,
      employees: { intern: 1 },
    });
    // Past the 10s rate limit, so the rejection below is the
    // progression rules, not a 429.
    srv.advance(11_000);

    // The normal save path refuses to go backwards: the MONOTONIC
    // rule rejects any decrease (employees, total LOC, latches...).
    const backwards = await post(srv.base, "/api/save", {
      playerId,
      state: initialSaveState(),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(backwards.status, 409);
    const rejected = await backwards.json();
    assert.equal(rejected.rule, "MONOTONIC");

    // The reset on its own path is accepted immediately after.
    const res = await post(srv.base, "/api/save/reset", { playerId });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.state, initialSaveState());
  } finally {
    await srv.stop();
  }
});

test("reset cannot touch another player's save", async () => {
  const srv = await startTestServer();
  try {
    const playerA = await mintPlayer(srv.base);
    const playerB = await mintPlayer(srv.base);
    await setState(srv, playerA, { linesOfCode: 5000, money: 99999 });
    await setState(srv, playerB, { linesOfCode: 7000, money: 55555 });

    const res = await post(srv.base, "/api/save/reset", {
      playerId: playerA,
    });
    assert.equal(res.status, 200);

    const loadB = await fetch(`${srv.base}/api/load?playerId=${playerB}`);
    assert.equal(loadB.status, 200);
    const loadedB = await loadB.json();
    assert.equal(loadedB.state.linesOfCode, 7000);
    assert.equal(loadedB.state.money, 55555);
  } finally {
    await srv.stop();
  }
});

test("reset keeps the account link and the same playerId", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, { linesOfCode: 5000, money: 99999 });
    // Link the save to an account directly (test setup, not the auth
    // path — the link itself is covered by the auth tests).
    await srv.pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified")
       VALUES ($1, $2, $3, false)`,
      ["user-1", "Tester", "tester@example.com"]
    );
    const link = await srv.store.linkPlayerToUser(playerId, "user-1");
    assert.equal(link.status, "ok");

    const res = await post(srv.base, "/api/save/reset", { playerId });
    assert.equal(res.status, 200);

    const row = await srv.pool.query(
      `SELECT user_id FROM git_saves WHERE player_id = $1`,
      [playerId]
    );
    assert.equal(row.rows[0].user_id, "user-1");
    // And the link still resolves to the same player.
    assert.equal(
      await srv.store.getPlayerIdForUser("user-1"),
      playerId
    );
  } finally {
    await srv.stop();
  }
});

test("reset clears server-side star state and consumes issued outcomes", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, {
      linesOfCode: 5000,
      totalLinesOfCode: 5000,
      openSourceProjects: { constellation: 1, starBroker: 1 },
    });
    // Roll a next star so next_star_at_ms is set, and plant a
    // pending bought star + an unconsumed issued outcome (test setup,
    // not the star path — the star endpoints are covered by their own
    // tests).
    const next = await fetch(
      `${srv.base}/api/star/next?playerId=${playerId}`
    );
    assert.equal(next.status, 200);
    const nextBody = await next.json();
    assert.notEqual(nextBody.nextStarAtMs, null);
    await srv.pool.query(
      `UPDATE git_saves
       SET last_star_buy_at_ms = $1, bought_star_at_ms = $1
       WHERE player_id = $2`,
      [T0, playerId]
    );
    const claimId = randomUUID();
    await srv.pool.query(
      `INSERT INTO star_issues (claim_id, player_id, claim, issued_at)
       VALUES ($1, $2, $3, $4)`,
      [
        claimId,
        playerId,
        JSON.stringify({ effect: "lucky", good: true }),
        new Date(T0).toISOString(),
      ]
    );

    const res = await post(srv.base, "/api/save/reset", { playerId });
    assert.equal(res.status, 200);

    const row = await srv.pool.query(
      `SELECT next_star_at_ms, last_star_buy_at_ms, bought_star_at_ms
       FROM git_saves WHERE player_id = $1`,
      [playerId]
    );
    assert.equal(row.rows[0].next_star_at_ms, null);
    assert.equal(row.rows[0].last_star_buy_at_ms, null);
    assert.equal(row.rows[0].bought_star_at_ms, null);
    const issues = await srv.pool.query(
      `SELECT consumed_at FROM star_issues WHERE claim_id = $1`,
      [claimId]
    );
    assert.notEqual(issues.rows[0].consumed_at, null);

    // The next-star endpoint now reports no stars (fresh state has
    // Constellation level 0), so the client hides the star UI.
    const after = await fetch(
      `${srv.base}/api/star/next?playerId=${playerId}`
    );
    assert.equal(after.status, 200);
    assert.equal((await after.json()).nextStarAtMs, null);
  } finally {
    await srv.stop();
  }
});

test("reset on an unknown player is 404, a malformed id is 400", async () => {
  const srv = await startTestServer();
  try {
    const unknown = await post(srv.base, "/api/save/reset", {
      playerId: randomUUID(),
    });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, "unknown-player");

    const malformed = await post(srv.base, "/api/save/reset", {
      playerId: "not-a-uuid",
    });
    assert.equal(malformed.status, 400);

    const missing = await post(srv.base, "/api/save/reset", {});
    assert.equal(missing.status, 400);
  } finally {
    await srv.stop();
  }
});
