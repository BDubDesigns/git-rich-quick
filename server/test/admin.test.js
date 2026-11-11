/**
 * End-to-end tests for the admin seed endpoint (issue #46), against a real
 * store backed by an in-memory Postgres (pg-mem) running the exact same
 * SQL as production. The clock is injected so multi-window flows run
 * deterministically without waiting.
 *
 * The endpoint's whole point is the guardrail: only the ONE test player
 * (linked to the jellybean account, jaybles@qcfailed.com) can ever be
 * seeded. These tests pin that down — a guest, another account's player,
 * and an unknown playerId are all refused, and a missing/wrong token is
 * refused before any of that is even checked.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { TEST_ACCOUNT_EMAIL } from "../src/admin.js";
import { initialSaveState } from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const ADMIN_TOKEN = "test-admin-token";
const OTHER_EMAIL = "someone-else@example.com";

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

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

/** A state that is valid to seed: the initial state with progress added. */
function seededState() {
  const state = initialSaveState();
  state.linesOfCode = 2000;
  state.totalLinesOfCode = 2000;
  state.money = 50000;
  state.employees = { intern: 2, junior: 0, senior: 0, projectManager: 0, commitSpecialist: 0, releaseManager: 0 };
  state.openSourceProjects = {
    overReactFramework: 1,
    blocker: 0,
    constellation: 2,
    starBroker: 0,
  };
  // Constellation level 2 with 2000 lifetime LOC: the unlock condition
  // (TOTAL_LOC >= 500) is met, so the latch is true — a fixture that
  // owns levels must be self-consistent, or the seed normalizer
  // (validateSeedState) derives the latch and the stored state differs
  // from the input.
  state.unlockedOpenSourceProjects = {
    ...state.unlockedOpenSourceProjects,
    constellation: true,
  };
  return state;
}

/**
 * Mint a player and link it to an account with the given email, the way
 * POST /api/account/link does in production (the auth tables are Better
 * Auth's; the tests insert the user row directly because better-auth
 * needs a real Postgres for its own introspection).
 */
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

test("admin seed succeeds for the test-linked player and load returns the seeded state", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await makeLinkedPlayer(
      srv,
      "test-user-jaybles",
      TEST_ACCOUNT_EMAIL
    );
    const state = seededState();
    const res = await post(
      srv.base,
      "/api/admin/seed-test-player",
      { playerId, state },
      authHeader()
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.playerId, playerId);
    assert.deepEqual(body.state, state);

    const loaded = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
    assert.equal(loaded.status, 200);
    assert.deepEqual((await loaded.json()).state, state);
  } finally {
    await srv.stop();
  }
});

test("admin seed can re-set the same test player freely", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await makeLinkedPlayer(
      srv,
      "test-user-jaybles",
      TEST_ACCOUNT_EMAIL
    );
    const first = seededState();
    const second = seededState();
    second.money = 123456;
    second.linesOfCode = 999;
    second.totalLinesOfCode = 999;

    for (const state of [first, second]) {
      const res = await post(
        srv.base,
        "/api/admin/seed-test-player",
        { playerId, state },
        authHeader()
      );
      assert.equal(res.status, 200);
    }
    const loaded = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
    assert.deepEqual((await loaded.json()).state, second);
  } finally {
    await srv.stop();
  }
});

test("admin seed is rejected for an unlinked guest player", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const res = await post(
      srv.base,
      "/api/admin/seed-test-player",
      { playerId, state: seededState() },
      authHeader()
    );
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "not-test-player");
    // The guest's state is untouched.
    const loaded = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
    assert.deepEqual((await loaded.json()).state, initialSaveState());
  } finally {
    await srv.stop();
  }
});

test("admin seed is rejected for a player linked to another account", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await makeLinkedPlayer(
      srv,
      "test-user-other",
      OTHER_EMAIL
    );
    const res = await post(
      srv.base,
      "/api/admin/seed-test-player",
      { playerId, state: seededState() },
      authHeader()
    );
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "not-test-player");
    const loaded = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
    assert.deepEqual((await loaded.json()).state, initialSaveState());
  } finally {
    await srv.stop();
  }
});

test("admin seed of an unknown playerId is 404", async () => {
  const srv = await startTestServer();
  try {
    const res = await post(
      srv.base,
      "/api/admin/seed-test-player",
      {
        playerId: "00000000-0000-0000-0000-000000000000",
        state: seededState(),
      },
      authHeader()
    );
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "unknown-player");
  } finally {
    await srv.stop();
  }
});

test("admin seed without a token, with a wrong token, or with a malformed header is 401", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await makeLinkedPlayer(
      srv,
      "test-user-jaybles",
      TEST_ACCOUNT_EMAIL
    );
    const body = { playerId, state: seededState() };
    assert.equal(
      (await post(srv.base, "/api/admin/seed-test-player", body)).status,
      401
    );
    assert.equal(
      (
        await post(
          srv.base,
          "/api/admin/seed-test-player",
          body,
          authHeader("wrong-token")
        )
      ).status,
      401
    );
    assert.equal(
      (
        await post(srv.base, "/api/admin/seed-test-player", body, {
          authorization: "Basic abc123",
        })
      ).status,
      401
    );
    // A token that is a prefix of the real one must not pass the
    // constant-time check either.
    assert.equal(
      (
        await post(
          srv.base,
          "/api/admin/seed-test-player",
          body,
          authHeader("test-admin")
        )
      ).status,
      401
    );
  } finally {
    await srv.stop();
  }
});

test("admin seed is 501 when ADMIN_TOKEN is not configured", async () => {
  // null (not undefined) so the helper default does not kick in.
  const srv = await startTestServer({ adminToken: null });
  try {
    const res = await post(
      srv.base,
      "/api/admin/seed-test-player",
      {
        playerId: "00000000-0000-0000-0000-000000000000",
        state: seededState(),
      },
      authHeader()
    );
    assert.equal(res.status, 501);
    assert.equal((await res.json()).error, "admin-not-configured");
  } finally {
    await srv.stop();
  }
});

test("admin seed with a malformed state is 400 and does not touch the save", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await makeLinkedPlayer(
      srv,
      "test-user-jaybles",
      TEST_ACCOUNT_EMAIL
    );
    const badStates = [
      { ...seededState(), money: -5 },
      { ...seededState(), extraKey: 1 },
      {
        ...seededState(),
        openSourceProjects: {
          overReactFramework: 0,
          blocker: 0,
          constellation: 99,
        },
      },
    ];
    for (const state of badStates) {
      const res = await post(
        srv.base,
        "/api/admin/seed-test-player",
        { playerId, state },
        authHeader()
      );
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "invalid-seed");
    }
    // Malformed bodies are 400 too.
    assert.equal(
      (
        await post(
          srv.base,
          "/api/admin/seed-test-player",
          { playerId: "not-a-uuid", state: seededState() },
          authHeader()
        )
      ).status,
      400
    );
    const loaded = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
    assert.deepEqual((await loaded.json()).state, initialSaveState());
  } finally {
    await srv.stop();
  }
});

test("admin seed writes an audit log line without the token", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await makeLinkedPlayer(
      srv,
      "test-user-jaybles",
      TEST_ACCOUNT_EMAIL
    );
    const lines = [];
    const origWarn = console.warn;
    console.warn = (...args) => lines.push(args.map(String).join(" "));
    try {
      const res = await post(
        srv.base,
        "/api/admin/seed-test-player",
        { playerId, state: seededState() },
        authHeader()
      );
      assert.equal(res.status, 200);
    } finally {
      console.warn = origWarn;
    }
    const audit = lines.filter((line) =>
      line.includes("seed-test-player")
    );
    assert.equal(audit.length, 1);
    assert.match(audit[0], /\[admin\]/);
    assert.ok(audit[0].includes(playerId));
    assert.ok(!audit[0].includes(ADMIN_TOKEN));
  } finally {
    await srv.stop();
  }
});

test("a simulated save after seeding is accepted, and a tampered one is rejected", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await makeLinkedPlayer(
      srv,
      "test-user-jaybles",
      TEST_ACCOUNT_EMAIL
    );
    const state = seededState();
    const seeded = await post(
      srv.base,
      "/api/admin/seed-test-player",
      { playerId, state },
      authHeader()
    );
    assert.equal(seeded.status, 200);

    // 11s later (past the 10s rate limit): a no-op save from the
    // seeded state is accepted.
    srv.advance(11_000);
    const ok = await post(srv.base, "/api/save", {
      playerId,
      state,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(ok.status, 200);

    // 11s later again: the same state with 100k extra LOC is rejected.
    srv.advance(11_000);
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
  } finally {
    await srv.stop();
  }
});
