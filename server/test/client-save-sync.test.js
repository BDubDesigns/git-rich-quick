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

/**
 * A controllable stand-in for setTimeout/clearTimeout (issue #50).
 * Timers only fire when the test runs them — never on their own — so
 * a test that asserts on the retry timer's identity is deterministic
 * and cannot race the wall clock on a loaded runner. The engine
 * (SaveSync) takes these via its setTimeoutFn/clearTimeoutFn options;
 * production passes nothing and gets the real globals.
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
    pendingCount() {
      return pending.size;
    },
    /** Delays (ms) of the currently pending timers, in schedule order. */
    scheduledMs() {
      return [...pending.values()].map((t) => t.ms);
    },
    /** Fire every pending timer once, in schedule order. */
    runAll() {
      const fns = [...pending.values()].map((t) => t.fn);
      pending.clear();
      for (const fn of fns) fn();
    },
  };
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

    // A save within 1s of minting is rate-limited (the limit is measured
    // from the minting time). It must not reset the accumulator.
    // Awaiting the save makes the test deterministic: the server clock
    // only moves when the test advances it.
    await engine.requestSave("test");
    assert.equal(saveStatus, "retrying");
    assert.equal(engine.clicks, 50, "clicks are kept after a 429");

    // Advance the server clock past the rate limit and save again: the
    // accumulated actions (from before the 429) are all included.
    srv.advance(11_000);
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
    srv.advance(11_000);
    fakeHireIntern(clientState);
    engine.noteState(clientState);
    await waitFor(async () => {
      const state = await loadServerState(srv.base, playerId);
      return state.employees.intern === 1 ? state : null;
    });
    // Wait for the client status callback to settle (issue #50): the
    // server state is visible before the engine's fetch resolves and
    // onStatus("saved") runs, so asserting immediately races.
    await waitFor(() => saveStatus === "saved");
    const afterHire = await loadServerState(srv.base, playerId);
    assert.equal(afterHire.employees.intern, 1);
    assert.equal(afterHire.money, 500, "3000c - 2500c intern cost");
    assert.equal(saveStatus, "saved");

    // The retry timer: 0.5s after the last accepted save, a save is
    // rate-limited with retryAfterSeconds = 1. Advance the server clock
    // past the limit, and the scheduled retry (1s real time) fires and
    // the save is accepted.
    srv.advance(500);
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
    // Wait for the client status callback to settle (issue #50): the
    // server state is visible before the engine's fetch resolves and
    // onStatus("saved") runs, so asserting immediately races.
    await waitFor(() => saveStatus === "saved");
    assert.equal(saveStatus, "saved");
    assert.equal(engine.clicks, 0, "clicks reset after the retried save");
  } finally {
    engine.stop();
    await srv.stop();
  }
});

test("saves during a retry wait do not reset the retry timer", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  let clientState = makeClientState();
  let saveStatus = "loading";
  let playerId = null;
  // Issue #50: the retry timer is a manual one, so it can only fire
  // when the test runs it. With the real 1s timer, the three saves
  // below had to finish inside a 1s wall-clock window — on a loaded
  // runner they could stretch past it, the timer fired mid-sequence,
  // and the engine replaced it with a new timer, failing the identity
  // assertion. The fake timer removes the wall clock entirely: the
  // identity assertion is deterministic, and the test fires the retry
  // explicitly when it is ready for it.
  const timers = manualTimers();
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
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });
  try {
    await engine.init();
    srv.advance(11_000);
    await engine.requestSave("test");
    assert.equal(saveStatus, "saved");

    // 0.5s after the last accepted save, a save is rate-limited with
    // retryAfterSeconds = 1, and a retry is scheduled.
    srv.advance(500);
    for (let i = 0; i < 5; i += 1) {
      fakeClick(clientState);
      engine.recordClick();
    }
    await engine.requestSave("test");
    assert.equal(saveStatus, "retrying");
    const firstTimer = engine._retryTimer;
    assert.ok(firstTimer, "a retry timer is scheduled");
    // The engine honored the server's delay (1s), and exactly one
    // retry is pending.
    assert.deepEqual(timers.scheduledMs(), [1000]);
    assert.equal(timers.pendingCount(), 1);

    // Big-action saves during the wait (Ship clicks): each sends a save
    // that 429s, but none may reset the retry timer — otherwise every
    // Ship click pushes the save back another 10s and it never lands.
    // The manual timer cannot fire on its own, so this assertion no
    // longer depends on how fast the three saves run.
    for (let i = 0; i < 3; i += 1) {
      await engine.requestSave("big-action");
      assert.equal(
        engine._retryTimer,
        firstTimer,
        "retry timer not reset by a save during the wait"
      );
      assert.equal(timers.pendingCount(), 1, "no second retry scheduled");
    }

    // Advance past the rate limit, then fire the ORIGINAL retry: the
    // save lands with all the accumulated clicks.
    srv.advance(5_000);
    timers.runAll();
    await waitFor(async () => {
      const state = await loadServerState(srv.base, playerId);
      return state.totalLinesOfCode === 5 ? state : null;
    });
    // Wait for the client status callback to settle (issue #50): the
    // server state is visible before the engine's fetch resolves and
    // onStatus("saved") runs, so asserting immediately races — this
    // is the flake ('saving' !== 'saved') that failed on CI.
    await waitFor(() => saveStatus === "saved");
    assert.equal(saveStatus, "saved");
    assert.equal(engine.clicks, 0, "clicks reset after the retried save");
    assert.equal(timers.pendingCount(), 0, "retry timer cleared on success");
  } finally {
    engine.stop();
    await srv.stop();
  }
});

test("completing a project (Ship) does not trigger a save", async () => {
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
    // Past the rate limit, so a save triggered by noteState WOULD land
    // and be visible on the server. Ship is rapid-fire, so it must not
    // trigger one — the heartbeat and keepalive cover it.
    srv.advance(11_000);
    assert.equal(saveStatus, "saved");
    // Earn the 50 LOC the project costs, then ship it.
    for (let i = 0; i < 50; i += 1) {
      fakeClick(clientState);
      engine.recordClick();
    }
    fakeCompleteTodoApp(clientState);
    engine.noteState(clientState);
    // Give any (unwanted) save time to land.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(saveStatus, "saved", "no save was triggered by Ship");
    const state = await loadServerState(srv.base, playerId);
    assert.equal(
      state.freelanceProjectsCompleted.toDoListApp,
      0,
      "project completion was not saved by noteState"
    );
    // A hire still triggers a save via noteState.
    fakeHireIntern(clientState);
    engine.noteState(clientState);
    await waitFor(async () => {
      const s = await loadServerState(srv.base, playerId);
      return s.employees.intern === 1 ? s : null;
    });
    // Wait for the client status callback to settle (issue #50): the
    // server state is visible before the engine's fetch resolves and
    // onStatus("saved") runs, so asserting immediately races.
    await waitFor(() => saveStatus === "saved");
    assert.equal(saveStatus, "saved");
  } finally {
    engine.stop();
    await srv.stop();
  }
});

test("a star claim requests one prompt save via noteState", async () => {
  // A star claim's reward is in the state, but a bought-star claim
  // changes no big-action field — so the star UI asks for a prompt
  // save explicitly (requestClaimSave), and noteState requests it
  // once the state change propagates. Only once per claim (the flag
  // prevents a save attempt on every tick while the claim is pending,
  // e.g. while offline or rate-limited). There is no claim to record
  // anymore — the server never validates one; the reward is just part
  // of the save state.
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
    assert.equal(saveStatus, "saved");
    // Count save requests without actually saving (only the trigger
    // is under test here; the server-side acceptance of a star reward
    // is covered by validate.test.js).
    const requested = [];
    engine.requestSave = (reason) => {
      requested.push(reason);
      return Promise.resolve(false);
    };
    // Request a claim save, then note the state change: one prompt save.
    engine.requestClaimSave();
    engine.noteState(clientState);
    assert.deepEqual(requested, ["star-claim"]);
    // The next ticks' noteState must not request another save.
    engine.noteState(clientState);
    engine.noteState(clientState);
    assert.deepEqual(requested, ["star-claim"]);
    // A second claim requests a second prompt save.
    engine.requestClaimSave();
    engine.noteState(clientState);
    assert.deepEqual(requested, ["star-claim", "star-claim"]);
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
    srv.advance(11_000);
    for (let i = 0; i < 50; i += 1) {
      fakeClick(clientState);
      engine.recordClick();
    }
    fakeCompleteTodoApp(clientState);
    await engine.requestSave("test");
    await waitFor(() => saveStatus === "saved");
    const good = await loadServerState(srv.base, playerId);
    assert.equal(good.money, 3000);

    // Tamper: decrease total LOC below the stored total. The server
    // must 409 (MONOTONIC) and the engine must revert local state to the
    // last good state. (The old tamper — one cent extra — is accepted
    // now; the leaderboard is gone, so money is trusted.)
    srv.advance(11_000);
    clientState.totalLinesOfCode = 49;
    await engine.requestSave("test");
    await waitFor(() => saveStatus === "error");
    assert.equal(
      clientState.totalLinesOfCode,
      50,
      "local state reverted to last good"
    );
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

    // 0.5s after minting, a save is rate-limited with retryAfterSeconds = 1.
    // The engine must report the wait (status "retrying" + the delay) so
    // the footer can count down instead of showing a bare "Saving...".
    srv.advance(500);
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
    // (the controlled server clock, T0 + 500ms + 5s).
    assert.equal(savedAtCalls2[0], srv.now());
    assert.equal(clientState2.totalLinesOfCode, 5);
  } finally {
    engine.stop();
    if (engine2) engine2.stop();
    await srv.stop();
  }
});

test("resetProgress wipes progress server-side and locally, keeping the player id", async () => {
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
    assert.equal(saveStatus, "saved");
    const originalPlayerId = playerId;

    // Play: 100 clicks, then complete a project (50 LOC -> 3000c).
    for (let i = 0; i < 100; i += 1) {
      fakeClick(clientState);
      engine.recordClick();
    }
    fakeCompleteTodoApp(clientState);
    srv.advance(11_000);
    await engine.requestSave("manual");
    assert.equal(saveStatus, "saved");
    assert.equal(clientState.linesOfCode, 50);
    assert.equal(clientState.money, 3000);
    assert.equal(
      (await loadServerState(srv.base, playerId)).linesOfCode,
      50
    );

    // Reset: the server row and the local state both go to 0, the
    // player id stays the same, and the status reads saved.
    const result = await engine.resetProgress();
    assert.deepEqual(result, { ok: true });
    assert.equal(saveStatus, "saved");
    assert.equal(playerId, originalPlayerId);
    assert.equal(storage.getItem("grq:playerId"), originalPlayerId);
    assert.deepEqual(stateToSaveState(clientState), initialSaveState());
    assert.deepEqual(
      await loadServerState(srv.base, playerId),
      initialSaveState()
    );

    // The next save still works: the baseline is the fresh state, so
    // a heartbeat save of the (unchanged) fresh state is accepted.
    srv.advance(11_000);
    await engine.requestSave("manual");
    assert.equal(saveStatus, "saved");
  } finally {
    engine.stop();
    await srv.stop();
  }
});
