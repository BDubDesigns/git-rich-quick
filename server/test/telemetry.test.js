/**
 * Tests for progress telemetry (issue #152): server-side snapshots of
 * passive LOC/s and click LOC/s at 10 clicks/s (both without star
 * buffs) plus progress, sampled at most hourly per player (plus one per
 * sale), stored in git_save_metrics, read via
 * GET /api/admin/player/:playerId/metrics.
 *
 * Runs against a real store on pg-mem (the same SQL as production)
 * with an injected clock, so the hourly sampling is deterministic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  METRICS_SAMPLING,
  deriveMetricsSnapshot,
  parseTimeParam,
  routineSnapshotReason,
} from "../src/metrics.js";
import {
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  buffedLocPerSecond,
  initialSaveState,
  initialFarmState,
  locPerClick,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const ADMIN_TOKEN = "test-admin-token";

function zeroActions() {
  const counts = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
  return {
    clicks: 0,
    employeesBought: counts(EMPLOYEE_TYPES),
    projectsCompleted: counts(FREELANCE_PROJECT_KEYS),
    autoShips: counts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: counts(OPEN_SOURCE_IDS),
  };
}

async function startTestServer() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = createStore(pool);
  await store.ensureSchema();
  let nowMs = T0;
  const server = createServer(store, { clock: () => nowMs, adminToken: ADMIN_TOKEN });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    pool,
    store,
    advance(ms) {
      nowMs += ms;
    },
    now: () => nowMs,
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

async function getMetrics(base, playerId, query = "", token = ADMIN_TOKEN) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return fetch(`${base}/api/admin/player/${playerId}/metrics${query}`, { headers });
}

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

/** A save-shaped state with some progress. */
function progressState(overrides = {}) {
  const s = initialSaveState();
  s.linesOfCode = 400_000;
  s.totalLinesOfCode = 1_000_000;
  s.employees = { ...s.employees, intern: 20, junior: 5, commitSpecialist: 9 };
  s.unlockedEmployees = { ...s.unlockedEmployees, junior: true, commitSpecialist: true };
  s.openSourceProjects = { ...s.openSourceProjects, overReactFramework: 9, blocker: 2 };
  return Object.assign(s, overrides);
}

/** Store a state directly (test setup, not the save path). */
async function setState(srv, playerId, state) {
  await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [
    JSON.stringify(state),
    playerId,
  ]);
}

async function save(srv, playerId, state) {
  return post(srv.base, "/api/save", { playerId, state, actionsSinceLastSave: zeroActions() });
}

// --- Derivation ---

test("derive: passive is buffedLocPerSecond, click is 10 x the healthy locPerClick", () => {
  const state = progressState({ lifetimeEquityEarned: 2 });
  const snap = deriveMetricsSnapshot(state);
  assert.equal(snap.passiveLocPerSec, buffedLocPerSecond(state));
  // Founder at 2 Equity is 1.2x: floor((1 + 0.2 x 9) x 128 x 1.2) = 430.
  assert.equal(snap.progress.locPerClick, 430);
  assert.equal(
    snap.progress.locPerClick,
    locPerClick(state.openSourceProjects, state.employees, 1, 1.2, {})
  );
  assert.equal(snap.clickLocPerSecAt10cps, 4300);
  assert.equal(METRICS_SAMPLING.clicksPerSecond, 10);
});

test("derive: star buffs and SUBTRACTERALL phases never move the rates", () => {
  const base = deriveMetricsSnapshot(progressState());
  const buffed = deriveMetricsSnapshot(
    progressState({
      activeStarEffects: [
        { effect: "frenzy", multiplier: 7, expiresAtMs: T0 + HOUR, employeeType: null },
        { effect: "aiAccelerator", multiplier: 10, expiresAtMs: T0 + HOUR, employeeType: null },
      ],
      subtracterall: { phase: "burst", phaseRemainingSeconds: 100, uses: 1, activeUse: 1 },
    })
  );
  assert.equal(buffed.passiveLocPerSec, base.passiveLocPerSec);
  assert.equal(buffed.clickLocPerSecAt10cps, base.clickLocPerSecAt10cps);
});

test("derive: the progress fields the issue lists", () => {
  const farm = initialFarmState();
  farm.stalls[0] = { ...farm.stalls[0], llama: "classic" };
  farm.stalls[1] = { ...farm.stalls[1], llama: "classic" };
  const state = progressState({
    saleCount: 2,
    lifetimeEquityEarned: 3,
    lifetimeLocAtLastSale: 600_000,
    farm,
  });
  state.openSourceProjects.commitmentIssues = 4;
  state.achievements.tiers.legacyCode = 2;
  const { progress } = deriveMetricsSnapshot(state);
  assert.equal(progress.lifetimeLinesOfCode, 1_000_000);
  assert.equal(progress.companyLinesOfCode, 400_000);
  assert.equal(progress.linesOfCode, 400_000);
  assert.equal(progress.employees.intern, 20);
  assert.equal(progress.employees.commitSpecialist, 9);
  assert.equal(progress.doublingRanks.commitmentIssues, 4);
  assert.equal(progress.doublingRanks.coffeeScript, 0);
  assert.equal(progress.openSourceLevels.overReactFramework, 9);
  assert.equal(progress.maxOpenSourceLevels.commitmentIssues, 20);
  assert.equal(progress.saleCount, 2);
  assert.equal(progress.lifetimeEquityEarned, 3);
  assert.equal(progress.achievementTiers.legacyCode, 2);
  assert.ok(progress.achievementTiersEarned >= 2);
  assert.equal(progress.farm.owned, true);
  assert.equal(progress.farm.llamas.classic, 2);
  assert.equal(progress.farm.llamaTotal, 2);
});

test("derive: no PII and no NaN, even from a broken state", () => {
  const snap = deriveMetricsSnapshot({
    employees: { intern: Number.NaN, junior: "x" },
    linesOfCode: Number.NaN,
    email: "someone@example.test",
    userId: "u1",
  });
  const text = JSON.stringify(snap);
  assert.ok(!text.includes("example.test"));
  assert.ok(!/email|userId|user_id|name"/i.test(Object.keys(snap.progress).join(",")));
  assert.ok(!text.includes("null"), text);
  for (const value of [snap.passiveLocPerSec, snap.clickLocPerSecAt10cps, snap.progress.linesOfCode]) {
    assert.ok(Number.isFinite(value));
  }
  assert.deepEqual(Object.keys(deriveMetricsSnapshot(undefined)), [
    "passiveLocPerSec",
    "clickLocPerSecAt10cps",
    "progress",
  ]);
});

test("sampling rule: first, then at most hourly", () => {
  assert.equal(routineSnapshotReason(null, T0), "first");
  assert.equal(routineSnapshotReason(T0, T0 + HOUR - 1), null);
  assert.equal(routineSnapshotReason(T0, T0 + HOUR), "hourly");
  assert.equal(METRICS_SAMPLING.minIntervalMs, HOUR);
  assert.equal(parseTimeParam(null), null);
  assert.equal(parseTimeParam("1700000000000"), 1_700_000_000_000);
  assert.equal(parseTimeParam("2023-11-14T22:13:20.000Z"), 1_700_000_000_000);
  assert.ok(Number.isNaN(parseTimeParam("yesterday")));
});

// --- Server: sampling on save and sale ---

test("saves sample at most hourly; the save itself never carries the metrics", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, progressState());

    srv.advance(5000);
    const first = await save(srv, playerId, progressState());
    assert.equal(first.status, 200);
    const stored = (await first.json()).state;
    for (const key of Object.keys(stored)) {
      assert.doesNotMatch(key, /metric|passiveLocPerSec|clickLocPerSec/i);
    }

    // 30 minutes later: no new snapshot.
    srv.advance(30 * 60 * 1000);
    assert.equal((await save(srv, playerId, progressState({ linesOfCode: 500_000, totalLinesOfCode: 1_100_000 }))).status, 200);
    let rows = await srv.store.listMetricsSnapshots(playerId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, "first");
    assert.equal(rows[0].capturedAtMs, T0 + 5000);

    // Just past the hour since the first: an hourly snapshot.
    srv.advance(31 * 60 * 1000);
    const later = progressState({ linesOfCode: 600_000, totalLinesOfCode: 1_200_000 });
    later.employees.intern = 30;
    assert.equal((await save(srv, playerId, later)).status, 200);
    rows = await srv.store.listMetricsSnapshots(playerId);
    assert.deepEqual(rows.map((r) => r.reason), ["first", "hourly"]);
    assert.equal(rows[1].progress.employees.intern, 30);
    assert.ok(rows[1].passiveLocPerSec > rows[0].passiveLocPerSec);
  } finally {
    await srv.stop();
  }
});

test("a rejected save records nothing", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    // Within the 1s rate limit of the mint: 429, no snapshot.
    const res = await save(srv, playerId, progressState());
    assert.notEqual(res.status, 200);
    assert.equal((await srv.store.listMetricsSnapshots(playerId)).length, 0);
  } finally {
    await srv.stop();
  }
});

test("every sale records the pre-sale state, even inside the hour", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = progressState({ money: 2_000_000 });
    await setState(srv, playerId, pre);
    srv.advance(5000);
    assert.equal((await save(srv, playerId, pre)).status, 200);
    srv.advance(5000);
    const res = await post(srv.base, "/api/save/sell", {
      playerId,
      saleId: randomUUID(),
      state: pre,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(res.status, 200);
    const rows = await srv.store.listMetricsSnapshots(playerId);
    assert.deepEqual(rows.map((r) => r.reason), ["first", "sale"]);
    // The pre-sale state: the employees are still there.
    assert.equal(rows[1].progress.employees.intern, 20);
    assert.equal(rows[1].progress.saleCount, 0);
  } finally {
    await srv.stop();
  }
});

test("a broken metrics table never breaks a save", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await srv.pool.query("DROP TABLE git_save_metrics");
    const warn = console.warn;
    console.warn = () => {};
    try {
      srv.advance(5000);
      assert.equal((await save(srv, playerId, progressState())).status, 200);
    } finally {
      console.warn = warn;
    }
  } finally {
    await srv.stop();
  }
});

test("pruning a guest save deletes its snapshots too", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    srv.advance(5000);
    assert.equal((await save(srv, playerId, progressState())).status, 200);
    assert.equal((await srv.store.listMetricsSnapshots(playerId)).length, 1);
    await srv.store.pruneInactiveGuests(srv.now() + 1);
    assert.equal((await srv.store.listMetricsSnapshots(playerId)).length, 0);
  } finally {
    await srv.stop();
  }
});

// --- Admin endpoint ---

test("GET /api/admin/player/:id/metrics returns the time series with from/to and limit", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, progressState());
    const times = [];
    for (let i = 0; i < 4; i += 1) {
      srv.advance(i === 0 ? 5000 : HOUR);
      const s = progressState({ totalLinesOfCode: 1_000_000 + i * 100_000 });
      s.employees.intern = 20 + i;
      assert.equal((await save(srv, playerId, s)).status, 200);
      times.push(srv.now());
    }
    const res = await getMetrics(srv.base, playerId);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.playerId, playerId);
    assert.equal(body.count, 4);
    assert.deepEqual(body.series.map((e) => e.reason), ["first", "hourly", "hourly", "hourly"]);
    assert.deepEqual(body.series.map((e) => Date.parse(e.capturedAt)), times);
    const entry = body.series[0];
    assert.deepEqual(Object.keys(entry), [
      "capturedAt",
      "reason",
      "passiveLocPerSec",
      "clickLocPerSecAt10cps",
      "clickToPassiveRatio",
      "progress",
    ]);
    assert.equal(entry.clickToPassiveRatio, entry.clickLocPerSecAt10cps / entry.passiveLocPerSec);
    assert.equal(body.sampling.minIntervalSeconds, 3600);
    assert.equal(body.sampling.clicksPerSecond, 10);

    // from / to (inclusive), as ms or ISO.
    const ranged = await (await getMetrics(srv.base, playerId, `?from=${times[1]}&to=${new Date(times[2]).toISOString()}`)).json();
    assert.deepEqual(ranged.series.map((e) => e.progress.employees.intern), [21, 22]);
    // limit
    const limited = await (await getMetrics(srv.base, playerId, "?limit=2")).json();
    assert.equal(limited.count, 2);
  } finally {
    await srv.stop();
  }
});

test("the metrics endpoint is admin-only and validates its input", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    assert.equal((await getMetrics(srv.base, playerId, "", null)).status, 401);
    assert.equal((await getMetrics(srv.base, playerId, "", "wrong-token")).status, 401);
    assert.equal((await getMetrics(srv.base, "not-a-uuid")).status, 400);
    assert.equal((await getMetrics(srv.base, playerId, "?from=yesterday")).status, 400);
    assert.equal((await getMetrics(srv.base, randomUUID())).status, 404);
    const empty = await getMetrics(srv.base, playerId);
    assert.equal(empty.status, 200);
    assert.equal((await empty.json()).count, 0);
    // The plain player route still works, and deeper paths 404.
    const plain = await fetch(`${srv.base}/api/admin/player/${playerId}`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(plain.status, 200);
    const deeper = await fetch(`${srv.base}/api/admin/player/${playerId}/metrics/extra`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(deeper.status, 404);
  } finally {
    await srv.stop();
  }
});
