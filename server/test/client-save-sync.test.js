/**
 * End-to-end tests for the Slice 2 client save sync engine
 * (`client/src/save/saveSync.js`) against a real local save server
 * (pg-mem, same SQL as production, injectable clock).
 *
 * This lives in server/test/ because that is where the test server
 * harness (pg-mem) already is, and it runs with the existing
 * `npm test` (`node --test test/*.test.js`). It tests the CLIENT save
 * module, not the server — the server tests are in server.test.js and
 * validate.test.js.
 *
 * A fake game state mimics the client reducer (same shared balance
 * functions), so the saves it sends are ones the real client would send.
 * The engine's heartbeat is not started here; saves are triggered
 * directly and the server clock is advanced instead of waiting.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  initialSaveState,
  locPerClick,
  employeeCost,
} from "../../shared/game-balance.js";
import { SaveSync } from "../../client/src/save/saveSync.js";
import {
  stateToSaveState,
  saveStateToGameFields,
} from "../../client/src/save/serialize.js";

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
    now() {
      return nowMs;
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
    activeTab: "shop",
    selectedPanes: { left: "shop", right: "projects" },
    clickHistory: [],
    currentCPS: 0,
    uiState: {
      sections: {
        shop: { isDescriptionVisible: true },
        projects: { isDescriptionVisible: true },
        openSource: { isDescriptionVisible: true },
      },
    },
  };
}

/** Simulate a WRITE_CODE click the way the reducer does. */
function fakeClick(state) {
  const perClick = locPerClick({
    overReactFramework: state.openSourceProjects.overReactFramework.level,
    blocker: state.openSourceProjects.blocker.level,
  });
  state.linesOfCode += perClick;
  state.totalLinesOfCode += perClick;
}

/** Simulate COMPLETE_PROJECT for the To Do List App (50 LOC -> 3000c). */
function fakeCompleteTodoApp(state) {
  state.linesOfCode -= 50;
  state.money += 3000;
  state.freelanceProjectsCompleted.toDoListApp += 1;
}

/** Simulate BUY_EMPLOYEE for an intern, at the shared cost. */
function fakeHireIntern(state) {
  const cost = employeeCost("intern", state.employees.intern.count);
  state.money -= cost;
  state.employees.intern.count += 1;
}

async function loadServerState(base, playerId) {
  const res = await fetch(`${base}/api/load?playerId=${playerId}`);
  assert.equal(res.status, 200);
  return (await res.json()).state;
}

async function waitFor(fn, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test("mint, load, heartbeat save, and 429 accumulation + retry", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  let clientState = makeClientState();
  let saveStatus = "loading";
  let playerId = null;
  const engine = new SaveSync({
    apiBaseUrl: srv.base,
    getState: () => clientState,
    restore: (saveState) => {
      clientState = {
        ...clientState,
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
  });
  try {
    // First run: mints a player, stores ONLY the player id locally.
    await engine.init();
    assert.ok(playerId, "player id is set");
    assert.equal(saveStatus, "saved");
    assert.deepEqual(storage.keys(), ["grq:playerId"]);
    assert.equal(storage.getItem("grq:playerId"), playerId);
    assert.deepEqual(stateToSaveState(clientState), initialSaveState());

    // Play: 50 clicks, then complete a project (50 LOC -> 3000c).
    for (let i = 0; i < 50; i += 1) {
      fakeClick(clientState);
      engine.recordClick();
    }
    fakeCompleteTodoApp(clientState);

    // A save within 30s of minting is rate-limited (the limit is measured
    // from the minting time). It must not reset the accumulator.
    // Awaiting the save makes the test deterministic: the server clock
    // only moves when the test advances it.
    await engine.requestSave("test");
    assert.equal(saveStatus, "retrying");
    assert.equal(engine.clicks, 50, "clicks are kept after a 429");

    // Advance the server clock past the rate limit and save again: the
    // accumulated actions (from before the 429) are all included.
    srv.advance(31_000);
    await engine.requestSave("test");
    assert.equal(saveStatus, "saved");
    assert.equal(engine.clicks, 0, "clicks reset after an accepted save");
    const saved = await loadServerState(srv.base, playerId);
    assert.equal(saved.linesOfCode, 0);
    assert.equal(saved.totalLinesOfCode, 50);
    assert.equal(saved.money, 3000);
    assert.equal(saved.freelanceProjectsCompleted.toDoListApp, 1);

    // A big action (hire) triggers a save via noteState. Advance the
    // clock first so the rate limit has passed.
    srv.advance(31_000);
    fakeHireIntern(clientState);
    engine.noteState(clientState);
    await waitFor(async () => {
      const state = await loadServerState(srv.base, playerId);
      return state.employees.intern === 1 ? state : null;
    });
    const afterHire = await loadServerState(srv.base, playerId);
    assert.equal(afterHire.employees.intern, 1);
    assert.equal(afterHire.money, 500, "3000c - 2500c intern cost");
    assert.equal(saveStatus, "saved");

    // The retry timer: 29s after the last accepted save, a save is
    // rate-limited with retryAfterSeconds = 1. Advance the server clock
    // past the limit, and the scheduled retry (1s real time) fires and
    // the save is accepted.
    srv.advance(29_000);
    for (let i = 0; i < 5; i += 1) {
      fakeClick(clientState);
      engine.recordClick();
    }
    await engine.requestSave("test");
    assert.equal(saveStatus, "retrying");
    assert.equal(engine.clicks, 5, "clicks are kept after a 429");
    srv.advance(5_000);
    await waitFor(async () => {
      const state = await loadServerState(srv.base, playerId);
      return state.totalLinesOfCode === 55 ? state : null;
    });
    assert.equal(saveStatus, "saved");
    assert.equal(engine.clicks, 0, "clicks reset after the retried save");
  } finally {
    engine.stop();
    await srv.stop();
  }
});

test("tampered save is rejected with 409 and the client reverts", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  let clientState = makeClientState();
  let saveStatus = "loading";
  let playerId = null;
  const engine = new SaveSync({
    apiBaseUrl: srv.base,
    getState: () => clientState,
    restore: (saveState) => {
      clientState = {
        ...clientState,
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
  });
  try {
    await engine.init();
    srv.advance(31_000);
    for (let i = 0; i < 50; i += 1) {
      fakeClick(clientState);
      engine.recordClick();
    }
    fakeCompleteTodoApp(clientState);
    await engine.requestSave("test");
    await waitFor(() => saveStatus === "saved");
    const good = await loadServerState(srv.base, playerId);
    assert.equal(good.money, 3000);

    // Tamper: one cent extra. The server must 409 and the engine must
    // revert local state to the last good state.
    srv.advance(31_000);
    clientState.money = 3001;
    await engine.requestSave("test");
    await waitFor(() => saveStatus === "error");
    assert.equal(clientState.money, 3000, "local state reverted to last good");
    assert.equal(engine.clicks, 0, "accumulator reset on a 409 revert");
    const afterTamper = await loadServerState(srv.base, playerId);
    assert.deepEqual(afterTamper, good, "server state untouched by the 409");
  } finally {
    engine.stop();
    await srv.stop();
  }
});

test("unknown stored player id mints a fresh player on load", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  storage.setItem(
    "grq:playerId",
    "123e4567-e89b-42d3-a456-426614174000"
  );
  let clientState = makeClientState();
  let playerId = null;
  const engine = new SaveSync({
    apiBaseUrl: srv.base,
    getState: () => clientState,
    restore: (saveState) => {
      clientState = {
        ...clientState,
        ...saveStateToGameFields(saveState),
        clickHistory: [],
        currentCPS: 0,
      };
    },
    onStatus: () => {},
    onPlayerId: (id) => {
      playerId = id;
    },
    storage,
  });
  try {
    await engine.init();
    assert.ok(playerId, "a fresh player id is minted");
    assert.notEqual(playerId, "123e4567-e89b-42d3-a456-426614174000");
    assert.equal(storage.getItem("grq:playerId"), playerId);
    assert.deepEqual(stateToSaveState(clientState), initialSaveState());
    const loaded = await loadServerState(srv.base, playerId);
    assert.deepEqual(loaded, initialSaveState());
  } finally {
    engine.stop();
    await srv.stop();
  }
});

test("serialize round-trips the client state through the save shape", () => {
  const client = makeClientState();
  client.linesOfCode = 1234.5;
  client.totalLinesOfCode = 9876;
  client.money = 45200;
  client.employees.intern.count = 3;
  client.employees.junior.count = 1;
  client.openSourceProjects.overReactFramework.level = 1;
  client.unlockedEmployees.junior = true;
  const flat = stateToSaveState(client);
  assert.equal(flat.employees.intern, 3);
  assert.equal(flat.openSourceProjects.overReactFramework, 1);
  assert.equal(flat.aiAssistants.noPilot, 0);
  const back = saveStateToGameFields(flat);
  assert.equal(back.employees.intern.count, 3);
  assert.equal(back.employees.junior.count, 1);
  assert.equal(back.openSourceProjects.overReactFramework.level, 1);
  assert.equal(back.unlockedEmployees.junior, true);
  assert.equal(back.money, 45200);
});

test("rate-limited save reports the retry delay, and a later load reports the savedAt", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  let clientState = makeClientState();
  let saveStatus = "loading";
  let playerId = null;
  const retryCalls = [];
  const savedAtCalls = [];
  const engine = new SaveSync({
    apiBaseUrl: srv.base,
    getState: () => clientState,
    restore: (saveState) => {
      clientState = {
        ...clientState,
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
    onSavedAt: (ms) => {
      savedAtCalls.push(ms);
    },
    onRetry: (seconds) => {
      retryCalls.push(seconds);
    },
    storage,
  });
  let engine2 = null;
  try {
    await engine.init();
    // A fresh mint has no prior save, so nothing is reported yet.
    assert.deepEqual(savedAtCalls, []);
    assert.deepEqual(retryCalls, []);

    // 29s after minting, a save is rate-limited with retryAfterSeconds = 1.
    // The engine must report the wait (status "retrying" + the delay) so
    // the footer can count down instead of showing a bare "Saving...".
    srv.advance(29_000);
    for (let i = 0; i < 5; i += 1) {
      fakeClick(clientState);
      engine.recordClick();
    }
    await engine.requestSave("test");
    assert.equal(saveStatus, "retrying");
    assert.deepEqual(retryCalls, [1]);

    // Advance the server clock past the limit; the scheduled retry (1s
    // real time) fires, the save is accepted, and the retry wait clears.
    srv.advance(5_000);
    await waitFor(() => saveStatus === "saved");
    assert.deepEqual(retryCalls, [1, null]);
    // An accepted save reports the time it completed (client wall clock).
    assert.equal(savedAtCalls.length, 1);
    assert.ok(Number.isFinite(savedAtCalls[0]) && savedAtCalls[0] > 0);
    const saved = await loadServerState(srv.base, playerId);
    assert.equal(saved.totalLinesOfCode, 5);

    // A fresh engine (new session) loading the same player must report the
    // loaded save's savedAt, so the footer shows the real relative time
    // ("Saved 5m ago") instead of the "Progress saved" fallback.
    let clientState2 = makeClientState();
    let saveStatus2 = "loading";
    const savedAtCalls2 = [];
    engine2 = new SaveSync({
      apiBaseUrl: srv.base,
      getState: () => clientState2,
      restore: (saveState) => {
        clientState2 = {
          ...clientState2,
          ...saveStateToGameFields(saveState),
          clickHistory: [],
          currentCPS: 0,
        };
      },
      onStatus: (status) => {
        saveStatus2 = status;
      },
      onPlayerId: () => {},
      onSavedAt: (ms) => {
        savedAtCalls2.push(ms);
      },
      storage,
    });
    await engine2.init();
    assert.equal(saveStatus2, "saved");
    assert.equal(savedAtCalls2.length, 1);
    // The loaded save's savedAt is the server time of the accepted save
    // (the controlled server clock, T0 + 29s + 5s).
    assert.equal(savedAtCalls2[0], srv.now());
    assert.equal(clientState2.totalLinesOfCode, 5);
  } finally {
    engine.stop();
    if (engine2) engine2.stop();
    await srv.stop();
  }
});
