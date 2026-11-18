/**
 * Tests for the star clock (issue #148): star spawn and the StarBroker
 * cooldown anchored to server time through a clock offset taken from
 * the `savedAt` the save server already returns.
 *
 * - client/src/save/serverClock.js: serverNowMs, setOffsetFromSavedAt
 *   (valid / missing / invalid), localStorage persistence, fallback 0.
 * - SaveSync feeds it every server-stamped "now" (mint, accepted save)
 *   and never a load's savedAt (the time the save was stored) or a
 *   failed save's.
 * - GoldenStar's spawn schedule and cooldown, and the BUY_STAR reducer,
 *   read serverNowMs(), not Date.now() (source checks: the components
 *   import React and cannot load in node).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { initialSaveState } from "../../shared/game-balance.js";
import {
  SERVER_CLOCK_OFFSET_KEY,
  _resetServerClockForTests,
  serverClockOffsetMs,
  serverNowMs,
  setOffsetFromSavedAt,
} from "../../client/src/save/serverClock.js";
import { SaveSync } from "../../client/src/save/saveSync.js";
import {
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

// --- The offset helper ---

test("no stored offset: offset 0, serverNowMs is the device clock", () => {
  _resetServerClockForTests(memoryStorage());
  assert.equal(serverClockOffsetMs(), 0);
  const before = Date.now();
  const now = serverNowMs();
  assert.ok(now >= before && now <= Date.now());
  // No storage at all (node, private mode) is the same.
  _resetServerClockForTests(null);
  assert.equal(serverClockOffsetMs(), 0);
});

test("serverNowMs adds a known offset to the device clock", () => {
  _resetServerClockForTests(memoryStorage());
  const device = Date.now();
  // The server says it is 5 minutes BEHIND this device (the player set
  // the clock forward): serverNowMs runs 5 minutes behind Date.now().
  assert.equal(setOffsetFromSavedAt(new Date(device - 300_000).toISOString(), device), true);
  assert.equal(serverClockOffsetMs(), -300_000);
  const now = serverNowMs();
  assert.ok(Math.abs(now - (Date.now() - 300_000)) < 50);
});

test("setOffsetFromSavedAt: valid ISO or ms updates, missing or invalid keeps the old offset", () => {
  _resetServerClockForTests(memoryStorage());
  const device = 1_800_000_000_000;
  assert.equal(setOffsetFromSavedAt("2027-01-15T08:00:02.500Z", Date.parse("2027-01-15T08:00:00.000Z")), true);
  assert.equal(serverClockOffsetMs(), 2500);
  assert.equal(setOffsetFromSavedAt(device + 1000, device), true);
  assert.equal(serverClockOffsetMs(), 1000);
  for (const bad of [undefined, null, "", "not a date", "2027-13-45T99:00:00Z", Number.NaN, Number.POSITIVE_INFINITY, {}]) {
    assert.equal(setOffsetFromSavedAt(bad, device), false, String(bad));
    assert.equal(serverClockOffsetMs(), 1000, String(bad));
  }
});

test("the offset persists to localStorage and is read back on load", () => {
  const storage = memoryStorage();
  _resetServerClockForTests(storage);
  setOffsetFromSavedAt(1_000_000 + 42_000, 1_000_000);
  assert.equal(storage.getItem(SERVER_CLOCK_OFFSET_KEY), "42000");
  assert.equal(SERVER_CLOCK_OFFSET_KEY, "grq:serverClockOffset");
  // A reload: a fresh module state reads the stored value (offline
  // play keeps the last-known offset).
  _resetServerClockForTests(storage);
  assert.equal(serverClockOffsetMs(), 42_000);
  // A garbage stored value falls back to 0, never NaN.
  _resetServerClockForTests(memoryStorage({ [SERVER_CLOCK_OFFSET_KEY]: "abc" }));
  assert.equal(serverClockOffsetMs(), 0);
  assert.ok(Number.isFinite(serverNowMs()));
  // A storage that throws is survivable: the offset applies in memory.
  const throwing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  _resetServerClockForTests(throwing);
  assert.equal(serverClockOffsetMs(), 0);
  assert.equal(setOffsetFromSavedAt(5000, 1000), true);
  assert.equal(serverClockOffsetMs(), 4000);
  _resetServerClockForTests(null);
});

// --- SaveSync feeds the clock ---

const T0 = 1_700_000_000_000;

async function startTestServer() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const store = createStore(new Pool());
  await store.ensureSchema();
  let nowMs = T0;
  const server = createServer(store, { clock: () => nowMs });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    advance(ms) {
      nowMs += ms;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

function engineFor(srv, storage, seen) {
  let clientState = {
    ...saveStateToGameFields(initialSaveState()),
    clickHistory: [],
    currentCPS: 0,
  };
  const engine = new SaveSync({
    apiBaseUrl: srv.base,
    getState: () => clientState,
    restore: (saveState) => {
      clientState = { ...clientState, ...saveStateToGameFields(saveState) };
    },
    storage,
    onServerTime: (savedAt) => seen.push(savedAt),
  });
  return {
    engine,
    click() {
      clientState = {
        ...clientState,
        linesOfCode: clientState.linesOfCode + 1,
        totalLinesOfCode: clientState.totalLinesOfCode + 1,
      };
      engine.recordClick();
    },
    saveState: () => stateToSaveState(clientState),
  };
}

test("SaveSync: a mint and an accepted save set the clock; a load and a failed save do not", async () => {
  const srv = await startTestServer();
  const storage = memoryStorage();
  try {
    // Mint (201): savedAt is the server's now.
    const seen = [];
    const first = engineFor(srv, storage, seen);
    await first.engine.init();
    assert.deepEqual(seen, [new Date(T0).toISOString()]);

    // An accepted save (200): its savedAt is the server's now.
    srv.advance(5000);
    first.click();
    await first.engine.requestSave("heartbeat");
    assert.deepEqual(seen.at(-1), new Date(T0 + 5000).toISOString());
    const afterSave = seen.length;

    // A rate-limited save (429) never sets the clock.
    first.click();
    await first.engine.requestSave("heartbeat");
    assert.equal(seen.length, afterSave);

    // A day later, a reload: the load's savedAt is when the save was
    // STORED (a day ago), so it must not set the clock.
    srv.advance(24 * 60 * 60 * 1000);
    const loadSeen = [];
    const second = engineFor(srv, storage, loadSeen);
    await second.engine.init();
    assert.deepEqual(loadSeen, []);
    // The next accepted save refreshes it with today's server time.
    second.click();
    await second.engine.requestSave("heartbeat");
    assert.deepEqual(loadSeen, [new Date(T0 + 5000 + 24 * 60 * 60 * 1000).toISOString()]);
  } finally {
    await srv.stop();
  }
});

test("SaveSync: a failing clock callback never breaks a save", async () => {
  const srv = await startTestServer();
  try {
    const engine = new SaveSync({
      apiBaseUrl: srv.base,
      getState: () => ({ ...saveStateToGameFields(initialSaveState()), clickHistory: [], currentCPS: 0 }),
      restore: () => {},
      storage: memoryStorage(),
      onServerTime: () => {
        throw new Error("boom");
      },
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await engine.init();
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(engine.playerId);
  } finally {
    await srv.stop();
  }
});

test("SaveSync defaults to the star clock's setOffsetFromSavedAt", () => {
  const src = readFileSync(new URL("../../client/src/save/saveSync.js", import.meta.url), "utf8");
  assert.match(src, /onServerTime = setOffsetFromSavedAt/);
  assert.match(src, /import \{ setOffsetFromSavedAt \} from "\.\/serverClock\.js"/);
});

// --- The star UI reads server time ---

test("GoldenStar: spawn schedule and StarBroker cooldown use serverNowMs(), not Date.now()", () => {
  const src = readFileSync(new URL("../../client/src/components/GoldenStar.jsx", import.meta.url), "utf8");
  assert.match(src, /import \{ serverNowMs \} from "\.\.\/save\/serverClock\.js"/);
  // The roll that sets nextStarAtMs (SET_NEXT_STAR_AT).
  assert.match(src, /rollNextStarAtMs\(constellationLevel, serverNowMs\(\)\)/);
  assert.doesNotMatch(src, /rollNextStarAtMs\([^)]*Date\.now\(\)/);
  // Every comparison against the schedule or the buy time is in server time.
  for (const line of src.split("\n")) {
    if (/nextStarAtMs|lastStarBuyAtMs|countdownStartedAtMs \+|windowEndMs/.test(line)) {
      assert.doesNotMatch(line, /Date\.now\(\)/, line.trim());
    }
  }
  assert.match(src, /\(serverNow - state\.lastStarBuyAtMs\) \/ 1000/);
  assert.match(src, /const boughtAtServerMs = serverNowMs\(\);/);
  assert.match(src, /payload: \{ cost: buyCost, atMs: boughtAtServerMs \}/);
  // The countdown's arm time and its tick read the same clock.
  assert.match(src, /setCountdownStartedAtMs\(now\);/);
  assert.match(src, /const now = serverNowMs\(\);\n\s+const windowEndMs =/);
});

test("BUY_STAR records the buy in server time, not Date.now()", () => {
  const src = readFileSync(new URL("../../client/src/context/GameContext.jsx", import.meta.url), "utf8");
  const start = src.indexOf('case "BUY_STAR"');
  const body = src.slice(start, src.indexOf("case ", start + 10));
  assert.match(body, /lastStarBuyAtMs:/);
  assert.match(body, /serverNowMs\(\)/);
  assert.doesNotMatch(body, /Date\.now\(\)/);
});

test("the star lifetime stays a timer: the 30s despawn is untouched", () => {
  const src = readFileSync(new URL("../../client/src/components/GoldenStar.jsx", import.meta.url), "utf8");
  assert.match(src, /setTimeout\(/);
});
