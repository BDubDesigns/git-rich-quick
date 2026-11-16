/**
 * Tests for the inactive-save prune (issue #25), against a real store
 * backed by an in-memory Postgres (pg-mem) running the exact same SQL
 * as production, plus end-to-end tests of the admin prune endpoint.
 *
 * The guardrail these tests pin down: only GUEST rows
 * (`user_id IS NULL`) whose last save is older than 3 months are ever
 * deleted. A row linked to an account is kept however old it is, and a
 * guest saved exactly at the cutoff is kept (the cutoff is strict).
 * A dry run deletes nothing. The save/load path is untouched: after a
 * live prune, a surviving player's save still loads.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  DAY_MS,
  GUEST_PRUNE_INACTIVITY_MS,
  pruneInactiveGuestSaves,
  startPruneScheduler,
} from "../src/prune.js";
import { initialSaveState } from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const ADMIN_TOKEN = "test-admin-token";
const CUTOFF_MS = T0 - GUEST_PRUNE_INACTIVITY_MS;

async function startStore() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = createStore(pool);
  await store.ensureSchema();
  return {
    pool,
    store,
    async stop() {
      await store.close();
    },
  };
}

/**
 * Insert a save row directly with an explicit last-save time, the way
 * a real row would look after months of inactivity. `userId` links
 * the row to an account (inserting the user row first, for the FK).
 */
async function insertSave(pool, playerId, savedAtMs, userId = null) {
  if (userId) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, false, now(), now())`,
      [userId, "Test", `${userId}@example.com`]
    );
  }
  await pool.query(
    `INSERT INTO git_saves (player_id, schema_version, state, saved_at, created_at, user_id)
     VALUES ($1, 1, $2, $3, $3, $4)`,
    [
      playerId,
      JSON.stringify(initialSaveState()),
      new Date(savedAtMs).toISOString(),
      userId,
    ]
  );
}

async function rowExists(pool, playerId) {
  const res = await pool.query(
    `SELECT player_id FROM git_saves WHERE player_id = $1`,
    [playerId]
  );
  return res.rowCount > 0;
}

// --- store.pruneInactiveGuests -------------------------------------------

test("prune deletes only old guest rows: recent guests, old linked rows, and the exact-cutoff guest are kept", async () => {
  const srv = await startStore();
  try {
    const oldGuest = randomUUID();
    const recentGuest = randomUUID();
    const boundaryGuest = randomUUID();
    const oldLinked = randomUUID();
    await insertSave(srv.pool, oldGuest, T0 - 91 * DAY_MS);
    await insertSave(srv.pool, recentGuest, T0 - 1 * DAY_MS);
    await insertSave(srv.pool, boundaryGuest, CUTOFF_MS);
    await insertSave(srv.pool, oldLinked, T0 - 200 * DAY_MS, "user-old");

    const result = await srv.store.pruneInactiveGuests(CUTOFF_MS, {
      dryRun: false,
    });
    assert.equal(result.deleted, 1);
    assert.deepEqual(result.playerIds, [oldGuest]);

    assert.equal(await rowExists(srv.pool, oldGuest), false);
    assert.equal(await rowExists(srv.pool, recentGuest), true);
    assert.equal(await rowExists(srv.pool, boundaryGuest), true);
    assert.equal(await rowExists(srv.pool, oldLinked), true);
  } finally {
    await srv.stop();
  }
});

test("prune dry run deletes nothing and reports what would be deleted", async () => {
  const srv = await startStore();
  try {
    const oldGuestA = randomUUID();
    const oldGuestB = randomUUID();
    const recentGuest = randomUUID();
    await insertSave(srv.pool, oldGuestA, T0 - 100 * DAY_MS);
    await insertSave(srv.pool, oldGuestB, T0 - 95 * DAY_MS);
    await insertSave(srv.pool, recentGuest, T0 - 1 * DAY_MS);

    const result = await srv.store.pruneInactiveGuests(CUTOFF_MS, {
      dryRun: true,
    });
    assert.equal(result.deleted, 0);
    assert.equal(result.wouldDelete, 2);
    assert.deepEqual([...result.playerIds].sort(), [oldGuestA, oldGuestB].sort());

    assert.equal(await rowExists(srv.pool, oldGuestA), true);
    assert.equal(await rowExists(srv.pool, oldGuestB), true);
    assert.equal(await rowExists(srv.pool, recentGuest), true);
  } finally {
    await srv.stop();
  }
});

test("prune on an empty table deletes nothing", async () => {
  const srv = await startStore();
  try {
    const result = await srv.store.pruneInactiveGuests(CUTOFF_MS, {
      dryRun: false,
    });
    assert.equal(result.deleted, 0);
    assert.deepEqual(result.playerIds, []);
  } finally {
    await srv.stop();
  }
});

// --- pruneInactiveGuestSaves (one run) ------------------------------------

test("one prune run cuts off 90 days back and passes dryRun through", async () => {
  const calls = [];
  const fakeStore = {
    async pruneInactiveGuests(cutoffMs, opts) {
      calls.push({ cutoffMs, opts });
      return { deleted: 3, wouldDelete: 0, playerIds: ["a", "b", "c"] };
    },
  };
  const result = await pruneInactiveGuestSaves(fakeStore, {
    nowMs: T0,
    dryRun: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cutoffMs, T0 - 90 * DAY_MS);
  assert.deepEqual(calls[0].opts, { dryRun: false });
  assert.equal(result.cutoffMs, T0 - 90 * DAY_MS);
  assert.equal(result.deleted, 3);
});

// --- startPruneScheduler ---------------------------------------------------

/** Controllable stand-ins for setTimeout/setInterval (same pattern as the client SaveSync tests). */
function manualTimers() {
  const timeouts = [];
  const intervals = [];
  return {
    timeouts,
    intervals,
    setTimeout(fn, ms) {
      const timer = { fn, ms, cleared: false };
      timeouts.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
    setInterval(fn, ms) {
      const timer = { fn, ms, cleared: false };
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) {
      timer.cleared = true;
    },
    async fireTimeout(index = 0) {
      const timer = timeouts[index];
      if (timer.cleared) return;
      await timer.fn();
    },
    async fireInterval(index = 0) {
      const timer = intervals[index];
      if (timer.cleared) return;
      await timer.fn();
    },
  };
}

test("scheduler runs first after the initial delay, then on the interval, and stop() cancels it", async () => {
  const timers = manualTimers();
  let runs = 0;
  const fakeStore = {
    async pruneInactiveGuests() {
      runs += 1;
      return { deleted: 0, wouldDelete: 0, playerIds: [] };
    },
  };
  const scheduler = startPruneScheduler(fakeStore, {
    clock: () => T0,
    setTimeoutFn: timers.setTimeout,
    setIntervalFn: timers.setInterval,
    clearTimeoutFn: timers.clearTimeout,
    clearIntervalFn: timers.clearInterval,
    intervalMs: DAY_MS,
    initialDelayMs: 60 * 60 * 1000,
  });
  try {
    assert.equal(runs, 0, "no run before the first delay elapses");
    assert.equal(timers.timeouts.length, 1);
    assert.equal(timers.timeouts[0].ms, 60 * 60 * 1000);
    assert.equal(timers.intervals.length, 0);

    await timers.fireTimeout();
    assert.equal(runs, 1, "first run after the initial delay");
    assert.equal(timers.intervals.length, 1);
    assert.equal(timers.intervals[0].ms, DAY_MS);

    await timers.fireInterval();
    assert.equal(runs, 2, "second run on the interval");
  } finally {
    scheduler.stop();
  }
  assert.equal(timers.timeouts[0].cleared, true);
  assert.equal(timers.intervals[0].cleared, true);
  await timers.fireInterval();
  assert.equal(runs, 2, "no run after stop()");
});

test("scheduler reports a failed run and keeps the schedule going", async () => {
  const timers = manualTimers();
  const errors = [];
  let runs = 0;
  const fakeStore = {
    async pruneInactiveGuests() {
      runs += 1;
      throw new Error("boom");
    },
  };
  const scheduler = startPruneScheduler(fakeStore, {
    clock: () => T0,
    setTimeoutFn: timers.setTimeout,
    setIntervalFn: timers.setInterval,
    clearTimeoutFn: timers.clearTimeout,
    clearIntervalFn: timers.clearInterval,
    onError: (err) => errors.push(err.message),
  });
  try {
    await timers.fireTimeout();
    assert.equal(runs, 1);
    assert.deepEqual(errors, ["boom"]);
    assert.equal(timers.intervals.length, 1, "interval still scheduled after a failure");
    await timers.fireInterval();
    assert.equal(runs, 2);
    assert.deepEqual(errors, ["boom", "boom"]);
  } finally {
    scheduler.stop();
  }
});

// --- POST /api/admin/prune-inactive-saves ---------------------------------

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

function authHeader(token = ADMIN_TOKEN) {
  return { authorization: `Bearer ${token}` };
}

test("admin prune defaults to a dry run: nothing deleted, would-be count reported", async () => {
  const srv = await startTestServer();
  try {
    const oldGuest = randomUUID();
    await insertSave(srv.pool, oldGuest, T0 - 91 * DAY_MS);

    const res = await post(
      srv.base,
      "/api/admin/prune-inactive-saves",
      {},
      authHeader()
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.dryRun, true);
    assert.equal(body.wouldDelete, 1);
    assert.deepEqual(body.playerIds, [oldGuest]);
    assert.equal(body.deleted, undefined);

    assert.equal(await rowExists(srv.pool, oldGuest), true);
  } finally {
    await srv.stop();
  }
});

test("admin prune with dryRun false deletes old guests, keeps linked rows, and surviving saves still load", async () => {
  const srv = await startTestServer();
  try {
    const oldGuest = randomUUID();
    const recentGuest = randomUUID();
    const oldLinked = randomUUID();
    await insertSave(srv.pool, oldGuest, T0 - 91 * DAY_MS);
    await insertSave(srv.pool, recentGuest, T0 - 1 * DAY_MS);
    await insertSave(srv.pool, oldLinked, T0 - 200 * DAY_MS, "user-old");

    const res = await post(
      srv.base,
      "/api/admin/prune-inactive-saves",
      { dryRun: false },
      authHeader()
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.dryRun, false);
    assert.equal(body.deleted, 1);
    assert.deepEqual(body.playerIds, [oldGuest]);

    assert.equal(await rowExists(srv.pool, oldGuest), false);
    assert.equal(await rowExists(srv.pool, recentGuest), true);
    assert.equal(await rowExists(srv.pool, oldLinked), true);

    // The save/load path is untouched: the surviving guest still loads.
    const load = await fetch(
      `${srv.base}/api/load?playerId=${recentGuest}`
    );
    assert.equal(load.status, 200);
    const gone = await fetch(`${srv.base}/api/load?playerId=${oldGuest}`);
    assert.equal(gone.status, 404);
  } finally {
    await srv.stop();
  }
});

test("admin prune refuses a missing or wrong token, and 501s when ADMIN_TOKEN is unset", async () => {
  const srv = await startTestServer();
  try {
    const noToken = await post(
      srv.base,
      "/api/admin/prune-inactive-saves",
      { dryRun: false }
    );
    assert.equal(noToken.status, 401);
    const wrongToken = await post(
      srv.base,
      "/api/admin/prune-inactive-saves",
      { dryRun: false },
      authHeader("wrong-token")
    );
    assert.equal(wrongToken.status, 401);
  } finally {
    await srv.stop();
  }

  const unconfigured = await startTestServer({ adminToken: null });
  try {
    const res = await post(
      unconfigured.base,
      "/api/admin/prune-inactive-saves",
      { dryRun: false },
      authHeader()
    );
    assert.equal(res.status, 501);
  } finally {
    await unconfigured.stop();
  }
});

test("admin prune rejects a non-boolean dryRun and invalid JSON", async () => {
  const srv = await startTestServer();
  try {
    const badType = await post(
      srv.base,
      "/api/admin/prune-inactive-saves",
      { dryRun: "yes" },
      authHeader()
    );
    assert.equal(badType.status, 400);
    const badJson = await post(
      srv.base,
      "/api/admin/prune-inactive-saves",
      "{not json",
      authHeader()
    );
    assert.equal(badJson.status, 400);
  } finally {
    await srv.stop();
  }
});
