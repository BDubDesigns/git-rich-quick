/**
 * Stale-client save guard (Brandon, Nov 21).
 *
 * A tab left open on an older client bundle kept saving its own older
 * idea of the game over the server copy every heartbeat, so llama
 * locks (PR #251, a `locked` field the old code does not know) were
 * wiped again and again. Two halves:
 *
 * - Server: a save, sale, store buy or intermission completion without
 *   a non-empty string `clientBuild` is a 409 with rule STALE_CLIENT
 *   and the stored save as lastGoodState. Nothing is written. Bundles
 *   from before this guard never send one, so the already-open old tab
 *   is refused, and its existing 409 path reverts it to the server copy.
 * - Client: the bundle carries a build id (__BUILD_ID__) and the build
 *   writes it to version.json. Before a save (throttled to one fetch
 *   per heartbeat), on start-up and when the tab comes back, the engine
 *   reads version.json; a different id means a newer version is
 *   deployed, so the tab stops saving and the footer asks for a
 *   reload. An unreadable version.json (offline, 404, `vite dev`)
 *   saves normally.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { clientBuildError, validateSave } from "../src/validate.js";
import {
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  initialSaveState,
  normalizeSaveState,
} from "../../shared/game-balance.js";
import {
  NEW_VERSION_STATUS,
  VERSION_CHECK_INTERVAL_MS,
  SaveSync,
} from "../../client/src/save/saveSync.js";
import {
  VERSION_JSON_PATH,
  fetchDeployedBuildId,
} from "../../client/src/save/versionCheck.js";
import {
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";
import { TEST_CLIENT_BUILD, withClientBuild } from "./helpers/client-build.js";

const T0 = 1_700_000_000_000;

const src = (path) =>
  readFileSync(new URL(`../../client/${path}`, import.meta.url), "utf8");

function zeroActions() {
  const counts = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
  return {
    clicks: 0,
    employeesBought: counts(EMPLOYEE_TYPES),
    projectsCompleted: counts(FREELANCE_PROJECT_KEYS),
    autoShips: counts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: counts(OPEN_SOURCE_IDS),
  };
}

/** A save with an owned barn and a locked Mama in stall 0. */
function lockedMamaState() {
  const base = initialSaveState();
  return normalizeSaveState({
    ...base,
    employees: { ...base.employees, intern: 100, senior: 10 },
    farm: {
      owned: true,
      stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
        llama: i === 0 ? "mama" : i === 1 ? "classic" : null,
        lighting: "warm",
        locked: i === 0,
      })),
      unlockedTypes: ["mama", "classic"],
      unseenBirths: 0,
    },
  });
}

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
  return {
    base: `http://127.0.0.1:${port}`,
    pool,
    advance: (ms) => {
      nowMs += ms;
    },
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

/** POST a raw body, exactly as given (no clientBuild added). */
async function postRaw(base, path, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mintWithState(srv, state) {
  const minted = await postRaw(srv.base, "/api/player", {});
  assert.equal(minted.status, 201);
  const { playerId } = await minted.json();
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return playerId;
}

async function storedRow(srv, playerId) {
  const res = await srv.pool.query(
    `SELECT state, saved_at FROM git_saves WHERE player_id = $1`,
    [playerId]
  );
  const row = res.rows[0];
  return {
    state: typeof row.state === "string" ? JSON.parse(row.state) : row.state,
    savedAt: new Date(row.saved_at).toISOString(),
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
  };
}

/**
 * A SaveSync wired to a plain object standing in for the reducer
 * state, with a fixed build id and a scripted version.json.
 */
function makeClient(srv, { clientBuild, deployed, storage, now } = {}) {
  const box = { state: null, statuses: [], fetches: 0, restored: [] };
  const sync = new SaveSync({
    apiBaseUrl: srv.base,
    getState: () => box.state,
    restore: (saveState) => {
      box.restored.push(saveState);
      box.state = saveStateToGameFields(saveState);
    },
    onStatus: (status) => box.statuses.push(status),
    storage: storage ?? memoryStorage(),
    clientBuild,
    fetchDeployedBuild:
      deployed === undefined
        ? null
        : async () => {
            box.fetches += 1;
            if (deployed instanceof Error) throw deployed;
            return typeof deployed === "function" ? deployed() : deployed;
          },
    now,
    onServerTime: () => {},
  });
  box.sync = sync;
  return box;
}

/** Count the save requests a block of code sends (any /api/save*). */
async function countSaveRequests(fn) {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/api/save")) {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    }
    return realFetch(url, init);
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
  return sent;
}

// --- Server: STALE_CLIENT ---

test("clientBuildError: missing, empty, blank, non-string and overlong are errors; a build id passes", () => {
  for (const clientBuild of [undefined, null, "", "   ", 42, true, {}, ["a"], "x".repeat(129)]) {
    assert.equal(typeof clientBuildError({ clientBuild }), "string", String(clientBuild));
  }
  assert.equal(typeof clientBuildError({}), "string");
  assert.equal(clientBuildError({ clientBuild: "4548fdc0e4" }), null);
  assert.equal(clientBuildError({ clientBuild: "2026-11-21T18:00:00.000Z" }), null);
  assert.equal(clientBuildError({ clientBuild: "x".repeat(128) }), null);
});

test("validateSave tolerates clientBuild in the body: request metadata, not save state", () => {
  const prev = { state: initialSaveState(), savedAtMs: T0 };
  const body = {
    playerId: "123e4567-e89b-42d3-a456-426614174000",
    state: initialSaveState(),
    actionsSinceLastSave: zeroActions(),
  };
  assert.equal(validateSave(prev, body, T0 + 60_000).ok, true);
  assert.equal(
    validateSave(prev, { ...body, clientBuild: "abc" }, T0 + 60_000).ok,
    true
  );
});

test("server: /api/save without a valid clientBuild is 409 STALE_CLIENT with the stored save, and the row is unchanged", async () => {
  const srv = await startTestServer();
  try {
    const stored = lockedMamaState();
    const playerId = await mintWithState(srv, stored);
    const before = await storedRow(srv, playerId);
    // What the old tab sends: its idea of the farm, no lock anywhere.
    const oldState = {
      ...stored,
      employees: { ...stored.employees, intern: 101 },
      farm: {
        ...stored.farm,
        stalls: stored.farm.stalls.map(({ llama, lighting }) => ({ llama, lighting })),
      },
    };
    for (const clientBuild of [undefined, "", 7, null]) {
      srv.advance(60_000);
      const body = { playerId, state: oldState, actionsSinceLastSave: zeroActions() };
      if (clientBuild !== undefined) body.clientBuild = clientBuild;
      const res = await postRaw(srv.base, "/api/save", body);
      assert.equal(res.status, 409, `clientBuild ${JSON.stringify(clientBuild)}`);
      const data = await res.json();
      assert.equal(data.rule, "STALE_CLIENT");
      assert.equal(data.error, "save-rejected");
      assert.equal(data.lastGoodState.playerId, playerId);
      assert.equal(data.lastGoodState.state.farm.stalls[0].locked, true);
      assert.equal(data.lastGoodState.state.employees.intern, 100);
      assert.deepEqual(await storedRow(srv, playerId), before);
    }
  } finally {
    await srv.stop();
  }
});

test("server: the sale, store buy and intermission completion refuse a missing clientBuild the same way", async () => {
  const srv = await startTestServer();
  try {
    const stored = lockedMamaState();
    const playerId = await mintWithState(srv, stored);
    const before = await storedRow(srv, playerId);
    const common = { playerId, state: stored, actionsSinceLastSave: zeroActions() };
    const cases = [
      ["/api/save/sell", { ...common, saleId: "123e4567-e89b-42d3-a456-426614174999" }, "sale-rejected"],
      ["/api/save/store/buy", { ...common, storeId: "startingCapital", rank: 1 }, "store-buy-rejected"],
      ["/api/save/intermission/complete", common, "intermission-complete-rejected"],
    ];
    for (const [path, body, error] of cases) {
      const res = await postRaw(srv.base, path, body);
      assert.equal(res.status, 409, path);
      const data = await res.json();
      assert.equal(data.rule, "STALE_CLIENT", path);
      assert.equal(data.error, error);
      assert.equal(data.lastGoodState.state.farm.stalls[0].locked, true);
      assert.deepEqual(await storedRow(srv, playerId), before, path);
    }
    // A malformed body is still a 400 first, and an unknown player a 404.
    const bad = await postRaw(srv.base, "/api/save", { playerId: "nope", state: stored });
    assert.equal(bad.status, 400);
    const unknown = await postRaw(srv.base, "/api/save", {
      playerId: "123e4567-e89b-42d3-a456-426614174abc",
      state: stored,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(unknown.status, 404);
  } finally {
    await srv.stop();
  }
});

test("server: a save with a clientBuild is accepted, and clientBuild is not stored in the save", async () => {
  const srv = await startTestServer();
  try {
    const stored = lockedMamaState();
    const playerId = await mintWithState(srv, stored);
    srv.advance(60_000);
    const next = { ...stored, employees: { ...stored.employees, intern: 101 } };
    const res = await postRaw(srv.base, "/api/save", {
      playerId,
      state: next,
      actionsSinceLastSave: zeroActions(),
      clientBuild: TEST_CLIENT_BUILD,
    });
    assert.equal(res.status, 200, await res.clone().text());
    const row = await storedRow(srv, playerId);
    assert.equal(row.state.employees.intern, 101);
    assert.equal(row.state.farm.stalls[0].locked, true);
    assert.equal("clientBuild" in row.state, false);
  } finally {
    await srv.stop();
  }
});

test("the test helper adds clientBuild to state-writing posts only, and leaves an explicit value alone", () => {
  assert.equal(withClientBuild("/api/save", { a: 1 }).clientBuild, TEST_CLIENT_BUILD);
  assert.equal(withClientBuild("/api/save/sell", {}).clientBuild, TEST_CLIENT_BUILD);
  assert.equal("clientBuild" in withClientBuild("/api/player", {}), false);
  assert.equal("clientBuild" in withClientBuild("/api/save/reset", {}), false);
  assert.equal(withClientBuild("/api/save", { clientBuild: undefined }).clientBuild, undefined);
  assert.equal(withClientBuild("/api/save", "{not json"), "{not json");
});

// --- End to end: the old tab is refused, the newer copy survives ---

test("end to end: an old client's saves are refused, it reverts once per save (no loop), and a reload gets the locked llama back", async () => {
  const srv = await startTestServer();
  try {
    const stored = lockedMamaState();
    const playerId = await mintWithState(srv, stored);
    const storage = memoryStorage();
    storage.setItem("grq:playerId", playerId);

    // The old tab: a bundle that sends no build id (modelled with
    // clientBuild null, which the server treats the same as missing),
    // and whose state has lost the lock.
    const old = makeClient(srv, { clientBuild: null, storage });
    await old.sync.init();
    assert.equal(old.sync.initialized, true);
    old.state = {
      ...old.state,
      employees: { ...old.state.employees, intern: { ...old.state.employees.intern, count: 105 } },
      farm: {
        ...old.state.farm,
        stalls: old.state.farm.stalls.map((s) => ({ ...s, locked: false })),
      },
    };

    // One heartbeat: exactly one save request, refused, reverted.
    srv.advance(60_000);
    const sent = await countSaveRequests(() => old.sync.requestSave("heartbeat"));
    assert.equal(sent.length, 1);
    assert.equal("clientBuild" in sent[0].body, true);
    assert.equal(sent[0].body.clientBuild, null);
    assert.equal(old.statuses.at(-1), "error");
    const reverted = old.restored.at(-1);
    assert.equal(reverted.farm.stalls[0].locked, true);
    assert.equal(old.state.farm.stalls[0].locked, true);
    const diag = old.sync.getSaveDiagnostics().attempts.at(-1);
    assert.equal(diag.outcome, "reverted");
    assert.match(diag.detail, /^STALE_CLIENT/);
    // Nothing is retried on a timer: the next try is the next heartbeat.
    assert.equal(old.sync._retryTimer, null);
    assert.equal(old.sync._pendingSave, false);

    // A second heartbeat: one more request, still refused.
    srv.advance(60_000);
    const again = await countSaveRequests(() => old.sync.requestSave("heartbeat"));
    assert.equal(again.length, 1);

    const row = await storedRow(srv, playerId);
    assert.equal(row.state.farm.stalls[0].locked, true);
    assert.equal(row.state.employees.intern, 100);

    // Reload on a current build: the newer stored state comes back.
    const fresh = makeClient(srv, { clientBuild: "build-b", deployed: "build-b", storage });
    await fresh.sync.init();
    assert.equal(fresh.state.farm.stalls[0].locked, true);
    assert.equal(fresh.state.farm.stalls[0].llama, "mama");
    // And it saves fine, lock intact.
    srv.advance(60_000);
    await fresh.sync.requestSave("heartbeat");
    assert.equal(fresh.statuses.at(-1), "saved");
    const after = await storedRow(srv, playerId);
    assert.equal(after.state.farm.stalls[0].locked, true);
  } finally {
    await srv.stop();
  }
});

// --- Client: the version check ---

test("client: a newer deployed build blocks the save, pins the reload status, and blocks sale/store/intermission", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintWithState(srv, lockedMamaState());
    const storage = memoryStorage();
    storage.setItem("grq:playerId", playerId);
    const c = makeClient(srv, { clientBuild: "build-a", deployed: "build-b", storage });
    await c.sync.init();
    srv.advance(60_000);
    const sent = await countSaveRequests(() => c.sync.requestSave("heartbeat"));
    assert.equal(sent.length, 0);
    assert.equal(c.fetches, 1);
    assert.equal(c.sync.newVersionAvailable, true);
    assert.equal(c.statuses.at(-1), NEW_VERSION_STATUS);
    assert.equal(c.sync.getSaveDiagnostics().saveStatus, NEW_VERSION_STATUS);
    assert.equal(
      c.sync.getSaveDiagnostics().attempts.some((a) => a.outcome === "new-version"),
      true
    );

    // Later saves do nothing, without fetching again.
    assert.equal(await c.sync.requestSave("big-action"), false);
    assert.equal(await c.sync.requestSave("page-hide", { keepalive: true }), false);
    assert.equal(c.fetches, 1);

    // The status is sticky: nothing else replaces the reload prompt.
    c.sync.setStatus("saved");
    c.sync.setStatus("error");
    assert.equal(c.statuses.at(-1), NEW_VERSION_STATUS);

    // The other state writes are blocked too.
    const writes = await countSaveRequests(async () => {
      assert.deepEqual(await c.sync.sellCompany(), { ok: false, error: "new-version" });
      assert.deepEqual(await c.sync.buyStoreRank("startingCapital"), { ok: false, error: "new-version" });
      assert.deepEqual(await c.sync.completeIntermission(), { ok: false, error: "new-version" });
    });
    assert.equal(writes.length, 0);
  } finally {
    await srv.stop();
  }
});

test("client: a matching build saves, and the request carries clientBuild", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintWithState(srv, lockedMamaState());
    const storage = memoryStorage();
    storage.setItem("grq:playerId", playerId);
    const c = makeClient(srv, { clientBuild: "build-a", deployed: "build-a", storage });
    await c.sync.init();
    srv.advance(60_000);
    const sent = await countSaveRequests(() => c.sync.requestSave("heartbeat"));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.clientBuild, "build-a");
    assert.equal(c.statuses.at(-1), "saved");
    assert.equal(c.sync.newVersionAvailable, false);
  } finally {
    await srv.stop();
  }
});

test("client: an unreadable version.json (throws, or no id) saves normally", async () => {
  for (const deployed of [new Error("Failed to fetch"), null, ""]) {
    const srv = await startTestServer();
    try {
      const playerId = await mintWithState(srv, lockedMamaState());
      const storage = memoryStorage();
      storage.setItem("grq:playerId", playerId);
      const c = makeClient(srv, { clientBuild: "build-a", deployed, storage });
      await c.sync.init();
      srv.advance(60_000);
      const sent = await countSaveRequests(() => c.sync.requestSave("heartbeat"));
      assert.equal(sent.length, 1, String(deployed));
      assert.equal(c.fetches, 1);
      assert.equal(c.statuses.at(-1), "saved");
      assert.equal(c.sync.newVersionAvailable, false);
    } finally {
      await srv.stop();
    }
  }
});

test("client: version.json is fetched at most once per heartbeat, right away on start-up, and never before a keepalive save", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintWithState(srv, lockedMamaState());
    const storage = memoryStorage();
    storage.setItem("grq:playerId", playerId);
    let clock = 0;
    const c = makeClient(srv, {
      clientBuild: "build-a",
      deployed: "build-a",
      storage,
      now: () => clock,
    });
    // start(): init, then a forced check (not awaited by start).
    await c.sync.start();
    await c.sync.checkForNewVersion();
    assert.equal(c.fetches, 1);
    // Saves inside the interval reuse that answer.
    srv.advance(60_000);
    await c.sync.requestSave("big-action");
    srv.advance(60_000);
    await c.sync.requestSave("big-action");
    assert.equal(c.fetches, 1);
    // A keepalive (page-hide) save never waits on a fetch.
    clock += VERSION_CHECK_INTERVAL_MS;
    srv.advance(60_000);
    await c.sync.requestSave("page-hide", { keepalive: true });
    assert.equal(c.fetches, 1);
    // The next heartbeat-paced save fetches again.
    srv.advance(60_000);
    await c.sync.requestSave("heartbeat");
    assert.equal(c.fetches, 2);
    // Coming back to the tab forces a check.
    await c.sync.checkForNewVersion({ force: true });
    assert.equal(c.fetches, 3);
    c.sync.stop();
  } finally {
    await srv.stop();
  }
});

test("client: a deploy while the tab is open is caught on the next check", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintWithState(srv, lockedMamaState());
    const storage = memoryStorage();
    storage.setItem("grq:playerId", playerId);
    let deployedId = "build-a";
    let clock = 0;
    const c = makeClient(srv, {
      clientBuild: "build-a",
      deployed: () => deployedId,
      storage,
      now: () => clock,
    });
    await c.sync.init();
    srv.advance(60_000);
    await c.sync.requestSave("heartbeat");
    assert.equal(c.statuses.at(-1), "saved");
    deployedId = "build-b";
    clock += VERSION_CHECK_INTERVAL_MS;
    srv.advance(60_000);
    const sent = await countSaveRequests(() => c.sync.requestSave("heartbeat"));
    assert.equal(sent.length, 0);
    assert.equal(c.statuses.at(-1), NEW_VERSION_STATUS);
  } finally {
    await srv.stop();
  }
});

test("fetchDeployedBuildId: reads buildId with cache no-store; 404, HTML, junk and network errors are null", async () => {
  const calls = [];
  const fake = (response) => async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  const json = (body, ok = true) => ({ ok, json: async () => body });
  assert.equal(await fetchDeployedBuildId(VERSION_JSON_PATH, fake(json({ buildId: "abc" }))), "abc");
  assert.equal(calls[0].url, "/version.json");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(await fetchDeployedBuildId(VERSION_JSON_PATH, fake(json({}, false))), null);
  assert.equal(
    await fetchDeployedBuildId(VERSION_JSON_PATH, fake({ ok: true, json: async () => JSON.parse("<!doctype html>") })),
    null
  );
  assert.equal(await fetchDeployedBuildId(VERSION_JSON_PATH, fake(json({ buildId: 5 }))), null);
  assert.equal(await fetchDeployedBuildId(VERSION_JSON_PATH, fake(json({ buildId: "" }))), null);
  assert.equal(await fetchDeployedBuildId(VERSION_JSON_PATH, fake(new TypeError("Failed to fetch"))), null);
});

test("a SaveSync built in Node has no version fetch and sends the dev build id", () => {
  const sync = new SaveSync({ getState: () => null, restore: () => {} });
  assert.equal(sync._fetchDeployedBuild, null);
  assert.equal(sync.clientBuild, "dev");
});

// --- Build wiring and the banner (source checks) ---

test("vite config defines __BUILD_ID__ from the commit sha (else the build time) and emits version.json with it", () => {
  const config = src("vite.config.js");
  assert.match(config, /process\.env\.VERCEL_GIT_COMMIT_SHA \|\| process\.env\.GITHUB_SHA/);
  assert.match(config, /const BUILD_ID = commitSha \|\| buildTime;/);
  assert.match(config, /__BUILD_ID__: JSON\.stringify\(BUILD_ID\)/);
  assert.match(config, /versionJsonPlugin\(BUILD_ID\)/);
  assert.match(config, /apply: "build"/);
  assert.match(config, /fileName: "version\.json"/);
  assert.match(config, /source: JSON\.stringify\(\{ buildId \}\)/);
  const version = src("src/version.js");
  assert.match(version, /typeof __BUILD_ID__ !== "undefined" \? __BUILD_ID__ : "dev"/);
});

test("the footer shows the reload prompt with a Reload button, no dismiss, no dashes", () => {
  const footer = src("src/components/Footer.jsx");
  assert.match(footer, /"A new version is out\. Reload to keep playing\."/);
  assert.match(footer, /saveStatus !== NEW_VERSION_STATUS\) return null/);
  assert.match(footer, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
  assert.match(footer, />\s*Reload\s*</);
  assert.match(footer, /<NewVersionBanner \/>/);
  // Save now is greyed out while saving is paused.
  assert.match(footer, /saveStatus === NEW_VERSION_STATUS \|\|\s*onCooldown/);
  // The new player-facing lines carry no em or en dashes.
  const added = footer.slice(
    footer.indexOf("[NEW_VERSION_STATUS]:"),
    footer.indexOf("// \"Saved just now\"")
  );
  assert.doesNotMatch(added, /[\u2013\u2014]/);
  const banner = footer.slice(
    footer.indexOf("function NewVersionBanner"),
    footer.indexOf("// \"Saved just now\"")
  );
  assert.doesNotMatch(banner, /dismiss|Dismiss|onClose/);
  assert.doesNotMatch(src("src/save/versionCheck.js"), /[\u2013\u2014]/);
});
