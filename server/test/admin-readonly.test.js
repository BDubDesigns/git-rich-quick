/**
 * End-to-end tests for the read-only admin/debug API (issue #45),
 * against a real store backed by an in-memory Postgres (pg-mem) running
 * the exact same SQL as production. The clock is injected so window
 * flows run deterministically without waiting.
 *
 * The point of these endpoints is the opposite of the seed endpoint's
 * guardrail: they CAN read a real player's save (that is what they are
 * for — debugging a specific player's issue, by explicit playerId).
 * They are still token-protected, audit-logged, and strictly read-only:
 * calling one must never change any player state. There is no bulk or
 * list-all-players endpoint.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { initialSaveState } from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const ADMIN_TOKEN = "test-admin-token";

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

async function startTestServer({ adminToken = ADMIN_TOKEN } = {}) {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = createStore(pool);
  await store.ensureSchema();

  let nowMs = T0;
  const server = createServer(store, {
    clock: () => nowMs,
    adminToken,
  });
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

async function post(base, path, body, extraHeaders = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function get(base, path, extraHeaders = {}) {
  return fetch(`${base}${path}`, { headers: extraHeaders });
}

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

/** Mint a player and link it to an account with the given email. */
async function makeLinkedPlayer(srv, userId, email) {
  const playerId = await mintPlayer(srv.base);
  await srv.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, false, now(), now())`,
    [userId, "Test", email]
  );
  const linked = await srv.store.linkPlayerToUser(playerId, userId);
  assert.equal(linked.status, "ok");
  return playerId;
}

function authHeader(token = ADMIN_TOKEN) {
  return { authorization: `Bearer ${token}` };
}

/** A valid save: 50 clicks at 1 LOC each, 11s after the last save. */
async function saveWithClicks(srv, playerId, clicks) {
  const state = initialSaveState();
  state.linesOfCode = clicks;
  state.totalLinesOfCode = clicks;
  const actions = zeroActions();
  actions.clicks = clicks;
  const res = await post(srv.base, "/api/save", {
    playerId,
    state,
    actionsSinceLastSave: actions,
  });
  assert.equal(res.status, 200);
  return state;
}

test("admin player returns the save state for a guest player", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    // 11s later (past the 10s rate limit): a no-op save is accepted.
    srv.advance(11_000);
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: initialSaveState(),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200);

    // The read-only endpoint returns that state — guests are readable
    // here (the seed endpoint's test-player-only guardrail does NOT
    // apply to the read-only endpoints).
    const res = await get(
      srv.base,
      `/api/admin/player/${playerId}`,
      authHeader()
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.playerId, playerId);
    assert.deepEqual(body.state, initialSaveState());
    assert.equal(body.savedAt, new Date(T0 + 11_000).toISOString());
    assert.equal(body.createdAt, new Date(T0).toISOString());
  } finally {
    await srv.stop();
  }
});

test("admin player returns the current state for a linked account, reflecting progress", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await makeLinkedPlayer(
      srv,
      "test-user-one",
      "one@example.com"
    );
    srv.advance(11_000);
    const state = await saveWithClicks(srv, playerId, 50);

    const res = await get(
      srv.base,
      `/api/admin/player/${playerId}`,
      authHeader()
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.playerId, playerId);
    assert.deepEqual(body.state, state);
    assert.equal(body.state.linesOfCode, 50);
  } finally {
    await srv.stop();
  }
});

test("admin player is read-only: calling it does not change the save", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    srv.advance(11_000);
    await saveWithClicks(srv, playerId, 50);
    const before = await (
      await fetch(`${srv.base}/api/load?playerId=${playerId}`)
    ).json();

    const res = await get(
      srv.base,
      `/api/admin/player/${playerId}`,
      authHeader()
    );
    assert.equal(res.status, 200);

    const after = await (
      await fetch(`${srv.base}/api/load?playerId=${playerId}`)
    ).json();
    assert.deepEqual(after, before);
  } finally {
    await srv.stop();
  }
});

test("admin player is 404 for an unknown player and 400 for a malformed id", async () => {
  const srv = await startTestServer();
  try {
    const unknown = await get(
      srv.base,
      "/api/admin/player/00000000-0000-0000-0000-000000000000",
      authHeader()
    );
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, "unknown-player");

    const malformed = await get(
      srv.base,
      "/api/admin/player/not-a-uuid",
      authHeader()
    );
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, "invalid-player-id");
  } finally {
    await srv.stop();
  }
});

test("admin player without a token, with a wrong token, or unconfigured is refused", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const path = `/api/admin/player/${playerId}`;
    assert.equal((await get(srv.base, path)).status, 401);
    assert.equal(
      (await get(srv.base, path, authHeader("wrong-token"))).status,
      401
    );
    assert.equal(
      (
        await get(srv.base, path, {
          authorization: "Basic abc123",
        })
      ).status,
      401
    );
  } finally {
    await srv.stop();
  }
  // Unconfigured: 501.
  const unconfigured = await startTestServer({ adminToken: null });
  try {
    const res = await get(
      unconfigured.base,
      "/api/admin/player/00000000-0000-0000-0000-000000000000",
      authHeader()
    );
    assert.equal(res.status, 501);
    assert.equal((await res.json()).error, "admin-not-configured");
  } finally {
    await unconfigured.stop();
  }
});

test("admin rejected-saves lists rejections most recent first with rule, detail, playerId, timestamp", async () => {
  const srv = await startTestServer();
  try {
    // Empty at first.
    const empty = await get(
      srv.base,
      "/api/admin/rejected-saves",
      authHeader()
    );
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { rejections: [], count: 0 });

    const playerId = await mintPlayer(srv.base);
    srv.advance(11_000);
    // A tampered save: 100k extra LOC with no actions is rejected (LOC).
    const state = initialSaveState();
    const tampered = {
      ...state,
      linesOfCode: state.linesOfCode + 100_000,
      totalLinesOfCode: state.totalLinesOfCode + 100_000,
    };
    const bad = await post(srv.base, "/api/save", {
      playerId,
      state: tampered,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(bad.status, 409);
    assert.equal((await bad.json()).rule, "LOC");

    // A second rejection, a malformed save (SHAPE).
    srv.advance(11_000);
    const malformed = await post(srv.base, "/api/save", {
      playerId,
      state: { ...state, money: -5 },
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(malformed.status, 400);

    const listed = await get(
      srv.base,
      "/api/admin/rejected-saves",
      authHeader()
    );
    assert.equal(listed.status, 200);
    const body = await listed.json();
    assert.equal(body.count, 2);
    assert.equal(body.rejections.length, 2);
    // Most recent first: the SHAPE rejection came second.
    assert.equal(body.rejections[0].rule, "SHAPE");
    assert.equal(body.rejections[0].playerId, playerId);
    assert.equal(typeof body.rejections[0].detail, "string");
    assert.equal(
      body.rejections[0].rejectedAt,
      new Date(T0 + 22_000).toISOString()
    );
    assert.equal(body.rejections[1].rule, "LOC");
    assert.equal(
      body.rejections[1].rejectedAt,
      new Date(T0 + 11_000).toISOString()
    );

    // ?limit=1 returns only the most recent.
    const limited = await get(
      srv.base,
      "/api/admin/rejected-saves?limit=1",
      authHeader()
    );
    const limitedBody = await limited.json();
    assert.equal(limitedBody.count, 1);
    assert.equal(limitedBody.rejections[0].rule, "SHAPE");
  } finally {
    await srv.stop();
  }
});

test("admin rejected-saves is read-only and requires a token", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    srv.advance(11_000);
    await saveWithClicks(srv, playerId, 50);
    const before = await (
      await fetch(`${srv.base}/api/load?playerId=${playerId}`)
    ).json();

    assert.equal(
      (await get(srv.base, "/api/admin/rejected-saves")).status,
      401
    );
    const res = await get(
      srv.base,
      "/api/admin/rejected-saves",
      authHeader()
    );
    assert.equal(res.status, 200);

    const after = await (
      await fetch(`${srv.base}/api/load?playerId=${playerId}`)
    ).json();
    assert.deepEqual(after, before);
  } finally {
    await srv.stop();
  }
});

test("admin stats counts players, linked accounts, and recent activity", async () => {
  const srv = await startTestServer();
  try {
    const guest = await mintPlayer(srv.base);
    const linked = await makeLinkedPlayer(
      srv,
      "test-user-one",
      "one@example.com"
    );
    // Both minted at T0, so both count as saved in the last hour/day.
    let stats = await (
      await get(srv.base, "/api/admin/stats", authHeader())
    ).json();
    assert.equal(stats.playerCount, 2);
    assert.equal(stats.linkedAccounts, 1);
    assert.equal(stats.savesLastHour, 2);
    assert.equal(stats.savesLastDay, 2);
    assert.equal(stats.rejectionsLastHour, 0);
    assert.equal(stats.rejectionsLastDay, 0);
    assert.equal(stats.rejectionsStored, 0);

    // 11s later: the guest saves, then sends a tampered save (rejected).
    // The second advance is past the 10s rate limit, so the tampered
    // save reaches the LOC rule (409) instead of the rate limit (429).
    srv.advance(11_000);
    await saveWithClicks(srv, guest, 50);
    srv.advance(11_000);
    const tampered = {
      ...initialSaveState(),
      linesOfCode: 100_000,
      totalLinesOfCode: 100_000,
    };
    const bad = await post(srv.base, "/api/save", {
      playerId: guest,
      state: tampered,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(bad.status, 409);
    // The linked player never saves again; its saved_at stays at T0.
    void linked;

    stats = await (
      await get(srv.base, "/api/admin/stats", authHeader())
    ).json();
    assert.equal(stats.playerCount, 2);
    assert.equal(stats.savesLastHour, 2);
    assert.equal(stats.savesLastDay, 2);
    assert.equal(stats.rejectionsLastHour, 1);
    assert.equal(stats.rejectionsLastDay, 1);
    assert.equal(stats.rejectionsStored, 1);

    // 2h later: the saves and the rejection are outside the 1h
    // window but inside the 24h window.
    srv.advance(2 * 60 * 60 * 1000);
    stats = await (
      await get(srv.base, "/api/admin/stats", authHeader())
    ).json();
    assert.equal(stats.savesLastHour, 0);
    assert.equal(stats.savesLastDay, 2);
    assert.equal(stats.rejectionsLastHour, 0);
    assert.equal(stats.rejectionsLastDay, 1);

    // 25h after T0: outside the 24h window too.
    srv.advance(23 * 60 * 60 * 1000);
    stats = await (
      await get(srv.base, "/api/admin/stats", authHeader())
    ).json();
    assert.equal(stats.savesLastHour, 0);
    assert.equal(stats.savesLastDay, 0);
    assert.equal(stats.rejectionsLastHour, 0);
    assert.equal(stats.rejectionsLastDay, 0);
    // The buffer still holds the entry (it is only capped, not aged).
    assert.equal(stats.rejectionsStored, 1);
  } finally {
    await srv.stop();
  }
});

test("admin stats requires a token and is 501 when unconfigured", async () => {
  const srv = await startTestServer();
  try {
    assert.equal((await get(srv.base, "/api/admin/stats")).status, 401);
    assert.equal(
      (
        await get(srv.base, "/api/admin/stats", authHeader("wrong"))
      ).status,
      401
    );
    const res = await get(srv.base, "/api/admin/stats", authHeader());
    assert.equal(res.status, 200);
  } finally {
    await srv.stop();
  }
  const unconfigured = await startTestServer({ adminToken: null });
  try {
    const res = await get(
      unconfigured.base,
      "/api/admin/stats",
      authHeader()
    );
    assert.equal(res.status, 501);
    assert.equal((await res.json()).error, "admin-not-configured");
  } finally {
    await unconfigured.stop();
  }
});

test("admin read-only calls write an audit log line without the token", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const lines = [];
    const origWarn = console.warn;
    console.warn = (...args) => lines.push(args.map(String).join(" "));
    try {
      const player = await get(
        srv.base,
        `/api/admin/player/${playerId}`,
        authHeader()
      );
      assert.equal(player.status, 200);
      const stats = await get(srv.base, "/api/admin/stats", authHeader());
      assert.equal(stats.status, 200);
      const rejected = await get(
        srv.base,
        "/api/admin/rejected-saves",
        authHeader()
      );
      assert.equal(rejected.status, 200);
    } finally {
      console.warn = origWarn;
    }
    for (const action of ["player", "stats", "rejected-saves"]) {
      const audit = lines.filter((line) => line.includes(action));
      assert.equal(audit.length, 1, `expected one audit line for ${action}`);
      assert.match(audit[0], /\[admin\]/);
      assert.ok(!audit[0].includes(ADMIN_TOKEN));
    }
    // The player audit names the player looked up.
    const playerAudit = lines.find((line) => line.includes("player"));
    assert.ok(playerAudit.includes(playerId));
  } finally {
    await srv.stop();
  }
});
