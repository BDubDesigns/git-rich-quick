/**
 * Tests for the leaderboard (issue #29): accounts only, ranked by
 * lifetime LOC by default, with sort options for current LOC and cash.
 * Runs against a real store backed by in-memory Postgres (pg-mem).
 * Users are inserted directly (the leaderboard only reads the user
 * table); scores are set by updating the save row, which is what the
 * test is about — the query, not the save path.
 */

import test from "node:test";
import assert from "node:assert/strict";
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

/**
 * Create an account (inserted directly) with a linked save whose
 * scores are set to the given values. Returns the playerId.
 */
async function makeAccount(srv, { name, email, lifetimeLoc, currentLoc, money }) {
  const userId = `user-${email}`;
  await srv.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)`,
    [userId, name, email]
  );
  const minted = await post(srv.base, "/api/player", {});
  assert.equal(minted.status, 201);
  const playerId = (await minted.json()).playerId;
  const link = await srv.store.linkPlayerToUser(playerId, userId);
  assert.equal(link.status, "ok");
  const state = initialSaveState();
  state.linesOfCode = currentLoc;
  state.totalLinesOfCode = lifetimeLoc;
  state.money = money;
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return playerId;
}

test("leaderboard ranks accounts by lifetime LOC by default, guests excluded", async () => {
  const srv = await startTestServer();
  try {
    await makeAccount(srv, {
      name: "Alice",
      email: "alice@example.com",
      lifetimeLoc: 5000,
      currentLoc: 100,
      money: 1000,
    });
    await makeAccount(srv, {
      name: "Bob",
      email: "bob@example.com",
      lifetimeLoc: 9000,
      currentLoc: 50,
      money: 900000,
    });
    // A guest (no account link) with a bigger lifetime LOC — must
    // never appear on the board.
    const guest = await post(srv.base, "/api/player", {});
    const guestId = (await guest.json()).playerId;
    const guestState = initialSaveState();
    guestState.linesOfCode = 999999;
    guestState.totalLinesOfCode = 999999;
    await srv.pool.query(
      `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
      [JSON.stringify(guestState), guestId]
    );
    // An account with zero lifetime LOC — not on the board either.
    await makeAccount(srv, {
      name: "Zero",
      email: "zero@example.com",
      lifetimeLoc: 0,
      currentLoc: 0,
      money: 0,
    });

    const res = await fetch(`${srv.base}/api/leaderboard`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.sort, "lifetime");
    assert.equal(data.entries.length, 2);
    assert.equal(data.entries[0].displayName, "Bob");
    assert.equal(data.entries[0].lifetimeLoc, 9000);
    assert.equal(data.entries[0].rank, 1);
    assert.equal(data.entries[1].displayName, "Alice");
    assert.equal(data.entries[1].rank, 2);
    // No save data and no emails leak through the board.
    for (const entry of data.entries) {
      assert.deepEqual(Object.keys(entry).sort(), [
        "currentLoc",
        "displayName",
        "lifetimeLoc",
        "money",
        "rank",
      ]);
    }
  } finally {
    await srv.stop();
  }
});

test("leaderboard sorts by current LOC and cash, and names fall back to the email prefix", async () => {
  const srv = await startTestServer();
  try {
    // Alice: most lifetime LOC, least cash. Bob: least lifetime, most cash.
    await makeAccount(srv, {
      name: "Alice",
      email: "alice@example.com",
      lifetimeLoc: 5000,
      currentLoc: 100,
      money: 1000,
    });
    await makeAccount(srv, {
      name: "",
      email: "bob@example.com",
      lifetimeLoc: 3000,
      currentLoc: 900,
      money: 900000,
    });
    // No name on the account: the display name is the email prefix.
    const current = await fetch(`${srv.base}/api/leaderboard?sort=current`);
    assert.equal(current.status, 200);
    const currentData = await current.json();
    assert.equal(currentData.sort, "current");
    assert.equal(currentData.entries[0].displayName, "bob");
    assert.equal(currentData.entries[0].currentLoc, 900);

    const cash = await fetch(`${srv.base}/api/leaderboard?sort=cash`);
    assert.equal(cash.status, 200);
    const cashData = await cash.json();
    assert.equal(cashData.sort, "cash");
    assert.equal(cashData.entries[0].displayName, "bob");
    assert.equal(cashData.entries[0].money, 900000);
    assert.equal(cashData.entries[1].displayName, "Alice");

    // An unknown sort falls back to lifetime.
    const unknown = await fetch(`${srv.base}/api/leaderboard?sort=bogus`);
    assert.equal(unknown.status, 200);
    assert.equal((await unknown.json()).sort, "lifetime");
  } finally {
    await srv.stop();
  }
});

test("leaderboard is empty when no account has a lifetime LOC above zero", async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.base}/api/leaderboard`);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).entries, []);
  } finally {
    await srv.stop();
  }
});
