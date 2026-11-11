/**
 * End-to-end tests for the save service HTTP layer, against a real store
 * backed by an in-memory Postgres (pg-mem) running the exact same SQL as
 * production. The clock is injected so multi-window flows run
 * deterministically without waiting.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { initialSaveState } from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;

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

async function post(base, path, body, extraHeaders = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("player mint, save/load round trip, tampered save rejected with last good state", async () => {
  const srv = await startTestServer();
  try {
    // Mint a player.
    const minted = await post(srv.base, "/api/player", {});
    assert.equal(minted.status, 201);
    const player = await minted.json();
    assert.match(
      player.playerId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    assert.deepEqual(player.state, initialSaveState());
    assert.equal(player.savedAt, new Date(T0).toISOString());

    // Load returns the initial state.
    const loaded = await fetch(
      `${srv.base}/api/load?playerId=${player.playerId}`
    );
    assert.equal(loaded.status, 200);
    assert.deepEqual((await loaded.json()).state, initialSaveState());

    // A save 60s later is rate-limited if it comes too soon; advance the clock.
    srv.advance(60_000);
    const savedState = {
      ...initialSaveState(),
      linesOfCode: 0,
      totalLinesOfCode: 50,
      money: 3000,
      freelanceProjectsCompleted: {
        toDoListApp: 1,
        hobbyWebsite: 0,
        paradigmShiftingBlockchainProject: 0,
      },
    };
    const saved = await post(srv.base, "/api/save", {
      playerId: player.playerId,
      state: savedState,
      actionsSinceLastSave: {
        clicks: 50,
        employeesBought: { intern: 0, junior: 0, senior: 0 },
        projectsCompleted: {
          toDoListApp: 1,
          hobbyWebsite: 0,
          paradigmShiftingBlockchainProject: 0,
        },
        openSourceLevelsBought: {
          overReactFramework: 0,
          blocker: 0,
          constellation: 0,
        },
        starClaims: [],
      },
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.ok, true);
    assert.deepEqual(savedBody.state, savedState);

    // A second save in the same instant is rate-limited, not a 409.
    const tooSoon = await post(srv.base, "/api/save", {
      playerId: player.playerId,
      state: savedState,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(tooSoon.status, 429);
    assert.equal((await tooSoon.json()).rule, "RATE_LIMIT");

    // Load reflects the accepted save.
    srv.advance(60_000);
    const reloaded = await fetch(
      `${srv.base}/api/load?playerId=${player.playerId}`
    );
    assert.equal(reloaded.status, 200);
    assert.deepEqual((await reloaded.json()).state, savedState);

    // A tampered save (one cent extra) is rejected with the last good state.
    const tampered = await post(srv.base, "/api/save", {
      playerId: player.playerId,
      state: { ...savedState, money: 3001 },
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(tampered.status, 409);
    const tamperedBody = await tampered.json();
    assert.equal(tamperedBody.rule, "MONEY");
    assert.deepEqual(tamperedBody.lastGoodState.state, savedState);

    // The stored state is untouched by the rejected save.
    const afterTamper = await fetch(
      `${srv.base}/api/load?playerId=${player.playerId}`
    );
    assert.equal(afterTamper.status, 200);
    assert.deepEqual((await afterTamper.json()).state, savedState);
  } finally {
    await srv.stop();
  }
});

test("unknown players, malformed requests, health, and CORS", async () => {
  const srv = await startTestServer();
  try {
    const unknownId = "123e4567-e89b-42d3-a456-426614174000";
    const loadUnknown = await fetch(
      `${srv.base}/api/load?playerId=${unknownId}`
    );
    assert.equal(loadUnknown.status, 404);
    assert.equal((await loadUnknown.json()).error, "unknown-player");

    const saveUnknown = await post(srv.base, "/api/save", {
      playerId: unknownId,
      state: initialSaveState(),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saveUnknown.status, 404);

    const loadNoId = await fetch(`${srv.base}/api/load`);
    assert.equal(loadNoId.status, 400);

    const loadBadId = await fetch(`${srv.base}/api/load?playerId=nope`);
    assert.equal(loadBadId.status, 400);

    const badJson = await post(srv.base, "/api/save", "{not json");
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).error, "invalid-json");

    const health = await fetch(`${srv.base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const missing = await fetch(`${srv.base}/nope`);
    assert.equal(missing.status, 404);

    const preflight = await fetch(`${srv.base}/api/save`, {
      method: "OPTIONS",
      headers: {
        origin: "https://gitrichquick.vercel.app",
        "access-control-request-method": "POST",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://gitrichquick.vercel.app"
    );
  } finally {
    await srv.stop();
  }
});

test("CORS allows any *.vercel.app origin (preview deployments)", async () => {
  const srv = await startTestServer();
  try {
    const previewOrigin =
      "https://git-rich-quick-client-git-slice-2-bdubdesigns-projects.vercel.app";
    const preview = await fetch(`${srv.base}/healthz`, {
      headers: { origin: previewOrigin },
    });
    assert.equal(preview.status, 200);
    assert.equal(
      preview.headers.get("access-control-allow-origin"),
      previewOrigin
    );

    const evil = await fetch(`${srv.base}/healthz`, {
      headers: { origin: "https://evil.example.com" },
    });
    assert.equal(evil.status, 200);
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
  } finally {
    await srv.stop();
  }
});
