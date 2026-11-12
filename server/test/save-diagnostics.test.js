/**
 * Tests for the client save-diagnostics log (`SaveSync` attempt log +
 * `getSaveDiagnostics`, `client/src/save/saveSync.js`) against a real
 * local save server (pg-mem, same harness as client-save-sync.test.js).
 *
 * The log is what Settings copies out (Copy diagnostics): every save
 * attempt, newest last, persisted in localStorage so a stuck save can
 * be inspected after a reload.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { initialSaveState } from "../../shared/game-balance.js";
import { SaveSync } from "../../client/src/save/saveSync.js";
import { saveStateToGameFields } from "../../client/src/save/serialize.js";

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
    advance(ms) {
      nowMs += ms;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

/** A fake client reducer state, shaped like GameContext's initialState. */
function makeClientState() {
  return {
    ...saveStateToGameFields(initialSaveState()),
    clickHistory: [],
    currentCPS: 0,
  };
}

/**
 * A controllable stand-in for setTimeout/clearTimeout: timers only
 * fire when the test runs them, so a rate-limited save's retry cannot
 * fire mid-test and record a second attempt.
 */
function manualTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
  };
}

function makeEngine(srv, storage, clientStateRef) {
  let saveStatus = "loading";
  let playerId = null;
  const engine = new SaveSync({
    apiBaseUrl: srv.base,
    getState: () => clientStateRef.state,
    restore: (saveState) => {
      clientStateRef.state = {
        ...clientStateRef.state,
        ...saveStateToGameFields(saveState),
        clickHistory: [],
        currentCPS: 0,
      };
    },
    onStatus: (status) => {
      saveStatus = status;
    },
    onPlayerId: (id) => {
      playerId = id;
    },
    storage,
    setTimeoutFn: manualTimers().setTimeout,
    clearTimeoutFn: manualTimers().clearTimeout,
  });
  return {
    engine,
    get saveStatus() {
      return saveStatus;
    },
    get playerId() {
      return playerId;
    },
  };
}

test("records a saved attempt, then a rate-limited attempt with the retry delay", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  const ref = { state: makeClientState() };
  const ctx = makeEngine(srv, storage, ref);
  const eng = ctx.engine;
  try {
    await eng.init();
    const id = ctx.playerId;
    assert.ok(id, "player id is set");

    // Past the rate-limit window (measured from minting): accepted.
    srv.advance(11_000);
    await eng.requestSave("manual");
    assert.equal(ctx.saveStatus, "saved");

    // Immediately again: inside the 10s window, rate-limited.
    await eng.requestSave("manual");
    assert.equal(ctx.saveStatus, "retrying");

    const diag = eng.getSaveDiagnostics();
    assert.equal(diag.playerId, id);
    assert.equal(diag.saveStatus, "retrying");
    assert.equal(typeof diag.lastSavedAt, "number");
    assert.equal(diag.attempts.length, 2);

    const [saved, limited] = diag.attempts;
    assert.equal(saved.trigger, "manual");
    assert.equal(saved.outcome, "saved");
    assert.equal(saved.status, 200);
    assert.equal(saved.detail, null);
    assert.match(saved.at, /^\d{4}-\d{2}-\d{2}T/);

    assert.equal(limited.trigger, "manual");
    assert.equal(limited.outcome, "rate-limited");
    assert.equal(limited.status, 429);
    assert.match(limited.detail, /^retry in \d+s$/);

    // The log is persisted: a fresh engine on the same storage loads it.
    const reloaded = new SaveSync({
      apiBaseUrl: srv.base,
      getState: () => ref.state,
      restore: () => {},
      storage,
    });
    assert.equal(reloaded.getSaveDiagnostics().attempts.length, 2);
    assert.equal(
      reloaded.getSaveDiagnostics().attempts[1].outcome,
      "rate-limited"
    );
  } finally {
    eng.stop();
    await srv.stop();
  }
});

test("records a reverted attempt with the server rule on a 409", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  const ref = { state: makeClientState() };
  const { engine } = makeEngine(srv, storage, ref);
  try {
    await engine.init();
    srv.advance(11_000);
    await engine.requestSave("manual");

    // An impossible LOC jump: the server's LOC rule rejects it.
    srv.advance(11_000);
    ref.state.linesOfCode = 1e12;
    ref.state.totalLinesOfCode = 1e12;
    await engine.requestSave("manual");

    const diag = engine.getSaveDiagnostics();
    const last = diag.attempts[diag.attempts.length - 1];
    assert.equal(last.trigger, "manual");
    assert.equal(last.outcome, "reverted");
    assert.equal(last.status, 409);
    assert.match(last.detail, /^LOC: /);
  } finally {
    engine.stop();
    await srv.stop();
  }
});

test("records an offline attempt with the error name on a network failure", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  const ref = { state: makeClientState() };
  const { engine } = makeEngine(srv, storage, ref);
  try {
    await engine.init();
    srv.advance(11_000);
    await engine.requestSave("manual");
    assert.equal(engine.getSaveDiagnostics().attempts.length, 1);

    // The server is gone: the save fetch fails fast (refused).
    await srv.stop();
    await engine.requestSave("manual");

    const diag = engine.getSaveDiagnostics();
    const last = diag.attempts[diag.attempts.length - 1];
    assert.equal(last.trigger, "manual");
    assert.equal(last.outcome, "offline");
    assert.equal(last.status, null);
    assert.equal(typeof last.detail, "string");
    assert.ok(last.detail.length > 0, "detail names the failure");
  } finally {
    engine.stop();
  }
});

test("records a reset attempt and caps the log at 20, dropping the oldest", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  const ref = { state: makeClientState() };
  const { engine } = makeEngine(srv, storage, ref);
  try {
    await engine.init();
    srv.advance(11_000);
    await engine.requestSave("manual");

    const reset = await engine.resetProgress();
    assert.equal(reset.ok, true);
    let diag = engine.getSaveDiagnostics();
    assert.equal(diag.attempts.length, 2);
    assert.equal(diag.attempts[1].trigger, "reset");
    assert.equal(diag.attempts[1].outcome, "reset");
    assert.equal(diag.attempts[1].status, 200);

    // Fill past the cap: only the newest 20 survive, oldest dropped.
    for (let i = 0; i < 25; i += 1) {
      engine._recordSaveAttempt({
        trigger: "manual",
        outcome: "saved",
        status: 200,
        detail: `n${i}`,
      });
    }
    diag = engine.getSaveDiagnostics();
    assert.equal(diag.attempts.length, 20);
    assert.equal(diag.attempts[0].detail, "n5");
    assert.equal(diag.attempts[19].detail, "n24");

    // The cap is persisted, not just in-memory.
    const stored = JSON.parse(storage.getItem("grq:saveAttempts"));
    assert.equal(stored.length, 20);
    assert.equal(stored[0].detail, "n5");
  } finally {
    engine.stop();
    await srv.stop();
  }
});

test("getSaveDiagnostics is a snapshot: mutating it does not touch the log", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  const ref = { state: makeClientState() };
  const { engine } = makeEngine(srv, storage, ref);
  try {
    await engine.init();
    srv.advance(11_000);
    await engine.requestSave("manual");

    const diag = engine.getSaveDiagnostics();
    diag.attempts.push({
      at: "2000-01-01T00:00:00.000Z",
      trigger: "manual",
      outcome: "saved",
      status: 200,
      detail: null,
    });
    diag.attempts[0].outcome = "bogus";
    assert.equal(engine.getSaveDiagnostics().attempts.length, 1);
    assert.equal(engine.getSaveDiagnostics().attempts[0].outcome, "saved");
  } finally {
    engine.stop();
    await srv.stop();
  }
});
