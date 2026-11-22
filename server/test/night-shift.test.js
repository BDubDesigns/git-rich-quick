/**
 * Tests for Night Shift (issue #149): offline production, built from
 * the approved proposal (comment 6970751928) and Brandon's decision
 * (comment 6982217342).
 *
 * - The numbers: rates 10 to 50%, caps 4 to 24h, prices 20 to 90
 *   minutes of B, the gates, and the proposal's "feel" table.
 * - Settlement: server clock only, on load, away >= 5 minutes,
 *   idempotent, P from the stored state (prestige and achievements
 *   apply; stars and SUBTRACTERALL do not), LOC only (no Release
 *   Manager shipping), nothing during the post-sale intermission.
 * - The sale resets the level to 0; the Night Shift Contract store
 *   rank (2 Equity) starts every new company at level 1.
 * - Save shape: a fresh default of 0, shape and MONOTONIC checks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { validateSave } from "../src/validate.js";
import {
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  NIGHT_SHIFT_CONFIG,
  OPEN_SOURCE_IDS,
  PRESTIGE_STORE_CONFIG,
  applyPrestigeSale,
  buffedLocPerSecond,
  buildNightShiftEmail,
  completePrestigeIntermission,
  initialSaveState,
  nightShiftCredit,
  nightShiftGateProgress,
  nightShiftHoursOfProduction,
  nightShiftLevelOf,
  nightShiftNextPurchase,
  nightShiftPriceCents,
  nightShiftStartLevel,
  normalizeSaveState,
  settleNightShift,
  storeRankCost,
} from "../../shared/game-balance.js";
import {
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";
import { withClientBuild } from "./helpers/client-build.js";

const T0 = 1_700_000_000_000;
const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

/** A company with exactly 100 LOC/s of healthy passive (100 interns). */
function company(overrides = {}) {
  const s = initialSaveState();
  s.employees = { ...s.employees, intern: 100, junior: 10 };
  s.unlockedEmployees = { ...s.unlockedEmployees, junior: true };
  s.linesOfCode = 50_000;
  s.totalLinesOfCode = 2_000_000;
  // 100 interns + 10 juniors = 150 LOC/s; drop the juniors' LOC by
  // keeping the doubling and bonuses at 0. Callers that need exactly
  // 100 set junior: 0.
  return Object.assign(s, overrides);
}

// --- The numbers ---

test("config: rates 10 to 50%, caps 4 to 24h, prices 2.5 to 11.25 minutes of S (a quarter of #244, Brandon Nov 21), the proposed gates", () => {
  assert.equal(NIGHT_SHIFT_CONFIG.maxLevel, 5);
  assert.equal(NIGHT_SHIFT_CONFIG.minAwaySeconds, 300);
  assert.deepEqual(
    NIGHT_SHIFT_CONFIG.levels.map((l) => [l.rate, l.capHours, l.priceSeconds / 60]),
    [
      [0.1, 4, 2.5],
      [0.2, 8, 3.75],
      [0.3, 12, 5],
      [0.4, 16, 7.5],
      [0.5, 24, 11.25],
    ]
  );
  assert.deepEqual(
    NIGHT_SHIFT_CONFIG.levels.map((l) => ({ ...l.gate })),
    [
      { minLocPerSecond: 100, employeeType: "junior", employeeCount: 10 },
      { minLocPerSecond: 1_000, employeeType: "senior", employeeCount: 5 },
      { minLocPerSecond: 10_000, employeeType: "projectManager", employeeCount: 10 },
      { minLocPerSecond: 100_000, employeeType: "releaseManager", employeeCount: 10 },
      { minLocPerSecond: 1_000_000, employeeType: "senior", employeeCount: 25 },
    ]
  );
  // The whole track is 30 minutes of S (a quarter of #244's 120).
  assert.equal(NIGHT_SHIFT_CONFIG.levels.reduce((a, l) => a + l.priceSeconds, 0), 30 * 60);
});

test("the feel table: hours of production for 2h, 8h, and 24h away", () => {
  const table = [1, 2, 3, 4, 5].map((level) =>
    [2, 8, 24].map((h) => Math.round(nightShiftHoursOfProduction(level, h) * 10) / 10)
  );
  assert.deepEqual(table, [
    [0.2, 0.4, 0.4],
    [0.4, 1.6, 1.6],
    [0.6, 2.4, 3.6],
    [0.8, 3.2, 6.4],
    [1.0, 4.0, 12],
  ]);
  assert.equal(nightShiftHoursOfProduction(0, 8), 0);
  assert.equal(nightShiftHoursOfProduction(5, Number.NaN), 0);
});

test("prices are time at current LOC/s: the proposal's cash figures at each gate", () => {
  // priceSeconds x P x 21 cents per LOC (S, issue #244): the figures
  // at the gates from the #200 proposal.
  assert.equal(nightShiftPriceCents(1, 100), 315_000); // $3,150
  assert.equal(nightShiftPriceCents(2, 1_000), 4_725_000); // $47,250
  assert.equal(nightShiftPriceCents(3, 10_000), 63_000_000); // $630,000
  assert.equal(nightShiftPriceCents(4, 100_000), 945_000_000); // $9.45M
  assert.equal(nightShiftPriceCents(5, 1_000_000), 14_175_000_000); // $141.75M
  // #195's save (P = 3,282,751): L1 is $103.4M.
  assert.equal(Math.round(nightShiftPriceCents(1, 3_282_751) / 1e7) / 10, 103.4);
  // The price scales with P, so waiting never makes it cheaper in time.
  assert.equal(nightShiftPriceCents(1, 2_000), 2 * nightShiftPriceCents(1, 1_000));
  // Never free: P floors at 10 for pricing, and NaN reads as 0.
  assert.equal(nightShiftPriceCents(1, 0), nightShiftPriceCents(1, 10));
  assert.equal(nightShiftPriceCents(1, Number.NaN), nightShiftPriceCents(1, 10));
  assert.equal(nightShiftPriceCents(0, 1_000), 0);
  assert.equal(nightShiftPriceCents(6, 1_000), 0);
});

test("gates: live P and a live employee count, missing counts read 0, levels in order", () => {
  const gate = nightShiftGateProgress(1, 150, { junior: 9 });
  assert.equal(gate.locPerSecond.met, true);
  assert.equal(gate.employees.met, false);
  assert.equal(gate.met, false);
  assert.equal(nightShiftGateProgress(1, 150, { junior: 10 }).met, true);
  assert.equal(nightShiftGateProgress(1, 99, { junior: 10 }).met, false);
  assert.equal(nightShiftGateProgress(2, 5_000, {}).employees.current, 0);
  assert.equal(nightShiftGateProgress(2, Number.NaN, { senior: Number.NaN }).met, false);
  // The next purchase is always level + 1; max has none.
  const next = nightShiftNextPurchase({ level: 0, money: 1e12, buffedLocPerSec: 150, employeeCounts: { junior: 10 } });
  assert.equal(next.level, 1);
  assert.equal(next.canBuy, true);
  const poor = nightShiftNextPurchase({ level: 0, money: 0, buffedLocPerSec: 150, employeeCounts: { junior: 10 } });
  assert.equal(poor.affordable, false);
  assert.equal(poor.canBuy, false);
  // Level 2's gate is checked for a level-1 owner, not level 1's.
  assert.equal(nightShiftNextPurchase({ level: 1, money: 1e12, buffedLocPerSec: 150, employeeCounts: { junior: 10 } }).canBuy, false);
  assert.equal(nightShiftNextPurchase({ level: 5, money: 1e12, buffedLocPerSec: 1e9, employeeCounts: {} }), null);
  assert.equal(nightShiftLevelOf(undefined), 0);
  assert.equal(nightShiftLevelOf(Number.NaN), 0);
  assert.equal(nightShiftLevelOf(9), 5);
});

// --- Settlement math ---

test("credit: floor(rate x P x min(away, cap)); nothing under 5 minutes or at level 0", () => {
  const eight = nightShiftCredit(5, 100, 8 * 3600);
  assert.deepEqual(eight, {
    awaySeconds: 28_800,
    countedSeconds: 28_800,
    rate: 0.5,
    creditedLoc: 1_440_000,
    hoursOfProduction: 4,
  });
  // The cap: level 1 counts 4h of a 24h absence.
  const capped = nightShiftCredit(1, 100, 24 * 3600);
  assert.equal(capped.countedSeconds, 4 * 3600);
  assert.equal(capped.creditedLoc, 144_000);
  // 5 minutes is the threshold: 299s is still here, 300s settles.
  assert.equal(nightShiftCredit(5, 100, 299), null);
  assert.equal(nightShiftCredit(5, 100, 300).creditedLoc, 15_000);
  assert.equal(nightShiftCredit(0, 100, 8 * 3600), null);
  assert.equal(nightShiftCredit(5, 0, 8 * 3600), null);
  assert.equal(nightShiftCredit(5, Number.NaN, 8 * 3600), null);
  assert.equal(nightShiftCredit(5, 100, Number.NaN), null);
  assert.equal(nightShiftCredit(5, 100, -100), null);
});

test("settle: P is the stored state's buffed rate, so prestige and achievements apply", () => {
  const base = company({ nightShiftLevel: 3 });
  const plain = settleNightShift(base, 8 * 3600);
  assert.equal(plain.report.creditedLoc, Math.floor(0.3 * buffedLocPerSecond(base) * 8 * 3600));
  // 10 Equity is a 2x Founder multiplier: twice the night shift.
  const founder = { ...base, lifetimeEquityEarned: 10 };
  assert.equal(settleNightShift(founder, 8 * 3600).report.creditedLoc, 2 * plain.report.creditedLoc);
  // An achievement tier raises it too.
  const achieved = { ...base, achievements: { ...base.achievements, tiers: { ...base.achievements.tiers, legacyCode: 1 } } };
  assert.ok(settleNightShift(achieved, 8 * 3600).report.creditedLoc > plain.report.creditedLoc);
});

test("settle: star buffs and SUBTRACTERALL never apply offline, and LOC is the only thing credited", () => {
  const base = company({ nightShiftLevel: 5 });
  const buffed = {
    ...base,
    activeStarEffects: [{ effect: "frenzy", multiplier: 7, expiresAtMs: T0 + 10 * HOUR, employeeType: null }],
    subtracterall: { phase: "burst", phaseRemainingSeconds: 100, uses: 1, activeUse: 1 },
    releaseManagerAssignments: { ...base.releaseManagerAssignments, toDoListApp: 0 },
  };
  const a = settleNightShift(base, 8 * 3600);
  const b = settleNightShift(buffed, 8 * 3600);
  assert.equal(b.report.creditedLoc, a.report.creditedLoc);
  // No Release Manager shipping, no cash, no clicks: only the two LOC totals move.
  const withManagers = company({
    nightShiftLevel: 5,
    employees: { ...base.employees, releaseManager: 10 },
    releaseManagerAssignments: { ...base.releaseManagerAssignments, toDoListApp: 10 },
  });
  const settled = settleNightShift(withManagers, 8 * 3600);
  const changed = Object.keys(settled.state).filter(
    (key) => JSON.stringify(settled.state[key]) !== JSON.stringify(withManagers[key])
  );
  assert.deepEqual(changed.sort(), ["linesOfCode", "totalLinesOfCode"]);
  assert.equal(settled.state.linesOfCode, withManagers.linesOfCode + settled.report.creditedLoc);
  assert.equal(settled.state.totalLinesOfCode, withManagers.totalLinesOfCode + settled.report.creditedLoc);
});

test("settle: nothing during the post-sale intermission (no company is running)", () => {
  const state = company({
    nightShiftLevel: 1,
    prestigeIntermission: { saleId: randomUUID(), frozenHealthyPassiveLocPerSec: 100, frozenBestPayoutPerLocCents: 60 },
  });
  assert.equal(settleNightShift(state, 8 * 3600), null);
  assert.equal(settleNightShift(null, 8 * 3600), null);
});

test("the report mail has no em dash and says how long the shift ran", () => {
  const mail = buildNightShiftEmail({ ...nightShiftCredit(1, 100, 24 * 3600), settledAt: "x" });
  assert.match(mail.subject, /Night Shift report: \+144K LOC/);
  assert.match(mail.body, /While you were away for 24h, the night shift wrote 144K LOC/);
  assert.match(mail.body, /clocked out after 4h/);
  for (const text of [mail.sender, mail.subject, mail.body]) assert.ok(!text.includes("—"));
  assert.ok(!buildNightShiftEmail(nightShiftCredit(5, 100, 3600)).body.includes("clocked out"));
});

// --- Sale reset and the store rank ---

test("a sale resets Night Shift to 0, like every other upgrade", () => {
  const pre = company({ nightShiftLevel: 5, totalLinesOfCode: 80_000_000 });
  const post = applyPrestigeSale(pre, randomUUID());
  assert.equal(post.nightShiftLevel, 0);
  // Without the Night Shift Contract the new company starts at 0.
  assert.equal(completePrestigeIntermission(post).nightShiftLevel, 0);
});

test("the Night Shift Contract: one rank, 2 Equity, starts every new company at level 1", () => {
  assert.deepEqual(PRESTIGE_STORE_CONFIG.nightShiftContract.rankCosts, [2]);
  assert.equal(storeRankCost("nightShiftContract", 1), 2);
  assert.equal(storeRankCost("nightShiftContract", 2), null);
  assert.ok(!PRESTIGE_STORE_CONFIG.nightShiftContract.description.includes("—"));
  assert.equal(nightShiftStartLevel({ nightShiftContract: 1 }), 1);
  assert.equal(nightShiftStartLevel({}), 0);
  assert.equal(nightShiftStartLevel(undefined), 0);
  assert.equal(nightShiftStartLevel({ nightShiftContract: Number.NaN }), 0);

  const pre = company({ nightShiftLevel: 4, totalLinesOfCode: 80_000_000 });
  pre.permanentStoreRanks = { ...pre.permanentStoreRanks, nightShiftContract: 1 };
  const post = applyPrestigeSale(pre, randomUUID());
  // The sale itself resets to 0; the rank applies at company start.
  assert.equal(post.nightShiftLevel, 0);
  const started = completePrestigeIntermission(post);
  assert.equal(started.nightShiftLevel, 1);
  assert.equal(started.prestigeIntermission, null);
  // A retried completion is a no-op (null), never a second grant.
  assert.equal(completePrestigeIntermission(started), null);
});

// --- Save shape ---

test("a fresh save and a pre-Night-Shift save read level 0 (fresh default, no backfill)", () => {
  assert.equal(initialSaveState().nightShiftLevel, 0);
  const old = initialSaveState();
  delete old.nightShiftLevel;
  assert.equal(normalizeSaveState(old).nightShiftLevel, 0);
  // A present-but-wrong value is left for the shape check to reject.
  assert.equal(normalizeSaveState({ ...old, nightShiftLevel: 9 }).nightShiftLevel, 9);
  // The client save mapping round-trips it, guarding junk to 0.
  const client = saveStateToGameFields({ ...initialSaveState(), nightShiftLevel: 3 });
  assert.equal(client.nightShiftLevel, 3);
  assert.equal(stateToSaveState(client).nightShiftLevel, 3);
  assert.equal(saveStateToGameFields(old).nightShiftLevel, 0);
  assert.equal(stateToSaveState({ ...client, nightShiftLevel: Number.NaN }).nightShiftLevel, 0);
});

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

test("shape and MONOTONIC: an integer 0..5 that never drops within a company", () => {
  const playerId = randomUUID();
  const prev = { state: company({ nightShiftLevel: 2 }), savedAtMs: T0 };
  const send = (level) =>
    validateSave(prev, { playerId, state: company({ nightShiftLevel: level }), actionsSinceLastSave: zeroActions() }, T0 + 5000);
  assert.equal(send(3).ok, true);
  assert.equal(send(2).ok, true);
  const dropped = send(1);
  assert.equal(dropped.ok, false);
  assert.equal(dropped.rule, "MONOTONIC");
  for (const bad of [6, -1, 1.5, "2", null]) {
    assert.equal(send(bad).ok, false, String(bad));
  }
});

// --- Server: settle on load ---

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
    body: JSON.stringify(withClientBuild(path, body)),
  });
}

async function mint(srv) {
  const res = await post(srv.base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

/** Store a state and stamp saved_at at the server's now. */
async function store(srv, playerId, state) {
  await srv.pool.query(
    `UPDATE git_saves SET state = $1, saved_at = $2 WHERE player_id = $3`,
    [JSON.stringify(state), new Date(srv.now()).toISOString(), playerId]
  );
}

async function load(srv, playerId) {
  const res = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
  assert.equal(res.status, 200);
  return res.json();
}

const LEVEL5 = () => {
  const s = company({ nightShiftLevel: 5 });
  s.employees = { ...s.employees, junior: 0 }; // exactly 100 LOC/s
  return s;
};

test("load after 8h settles once, by the server clock, and a second load finds nothing", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mint(srv);
    const state = LEVEL5();
    assert.equal(buffedLocPerSecond(state), 100);
    await store(srv, playerId, state);
    srv.advance(8 * HOUR);

    const first = await load(srv, playerId);
    assert.equal(first.nightShift.creditedLoc, 1_440_000);
    assert.equal(first.nightShift.awaySeconds, 28_800);
    assert.equal(first.nightShift.hoursOfProduction, 4);
    assert.equal(first.nightShift.settledAt, new Date(srv.now()).toISOString());
    assert.equal(first.state.linesOfCode, 50_000 + 1_440_000);
    assert.equal(first.state.totalLinesOfCode, 2_000_000 + 1_440_000);
    assert.equal(first.savedAt, new Date(srv.now()).toISOString());

    // Idempotent: the same absence never pays twice.
    const again = await load(srv, playerId);
    assert.equal(again.nightShift, null);
    assert.equal(again.state.linesOfCode, first.state.linesOfCode);
    srv.advance(2 * MIN);
    assert.equal((await load(srv, playerId)).nightShift, null);
  } finally {
    await srv.stop();
  }
});

test("under 5 minutes away, or at level 0, nothing settles and saved_at does not move", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mint(srv);
    await store(srv, playerId, LEVEL5());
    const storedAt = new Date(srv.now()).toISOString();
    srv.advance(4 * MIN);
    const short = await load(srv, playerId);
    assert.equal(short.nightShift, null);
    assert.equal(short.savedAt, storedAt);
    assert.equal(short.state.linesOfCode, 50_000);

    const zeroId = await mint(srv);
    await store(srv, zeroId, company());
    srv.advance(8 * HOUR);
    const zero = await load(srv, zeroId);
    assert.equal(zero.nightShift, null);
    assert.equal(zero.state.linesOfCode, 50_000);
    // A pre-Night-Shift save (no field at all) loads and settles nothing.
    const oldId = await mint(srv);
    const old = company();
    delete old.nightShiftLevel;
    await store(srv, oldId, old);
    srv.advance(8 * HOUR);
    assert.equal((await load(srv, oldId)).nightShift, null);
  } finally {
    await srv.stop();
  }
});

test("no double-dipping: an open tab's heartbeat keeps away under 5 minutes, and a stale tab cannot undo the credit", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mint(srv);
    let state = LEVEL5();
    await store(srv, playerId, state);
    // A live session saves every 60s for an hour: a load at any point
    // finds under 5 minutes away.
    for (let i = 0; i < 60; i += 1) {
      srv.advance(MIN);
      state = { ...state, linesOfCode: state.linesOfCode + 6000, totalLinesOfCode: state.totalLinesOfCode + 6000 };
      const res = await post(srv.base, "/api/save", { playerId, state, actionsSinceLastSave: zeroActions() });
      assert.equal(res.status, 200);
    }
    srv.advance(30 * 1000);
    assert.equal((await load(srv, playerId)).nightShift, null);

    // Now the player leaves for 8 hours, then comes back.
    srv.advance(8 * HOUR);
    const settled = await load(srv, playerId);
    assert.ok(settled.nightShift.creditedLoc > 0);
    // A stale tab still holding the pre-absence state cannot overwrite
    // the settled totals (lifetime LOC never decreases).
    srv.advance(2000);
    const stale = await post(srv.base, "/api/save", { playerId, state, actionsSinceLastSave: zeroActions() });
    assert.equal(stale.status, 409);
    // The fresh client, saving from the settled state, is accepted.
    const fresh = await post(srv.base, "/api/save", { playerId, state: settled.state, actionsSinceLastSave: zeroActions() });
    assert.equal(fresh.status, 200);
  } finally {
    await srv.stop();
  }
});

test("server: sell, buy the Night Shift Contract, start the next company at level 1", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mint(srv);
    // Enough lifetime LOC for 4 Equity (640M on the cube-root curve), so 2 are spendable.
    const pre = company({ nightShiftLevel: 3, totalLinesOfCode: 640_000_000 });
    await store(srv, playerId, pre);
    srv.advance(2000);
    let res = await post(srv.base, "/api/save/sell", {
      playerId,
      saleId: randomUUID(),
      state: pre,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.state.nightShiftLevel, 0);
    assert.ok(body.state.lifetimeEquityEarned >= 2);

    res = await post(srv.base, "/api/save/store/buy", {
      playerId,
      storeId: "nightShiftContract",
      rank: 1,
      state: body.state,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.state.permanentStoreRanks.nightShiftContract, 1);
    assert.equal(body.state.equitySpent, 2);
    assert.equal(body.state.nightShiftLevel, 0);

    res = await post(srv.base, "/api/save/intermission/complete", {
      playerId,
      state: body.state,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.state.prestigeIntermission, null);
    assert.equal(body.state.nightShiftLevel, 1);
  } finally {
    await srv.stop();
  }
});

// --- Client wiring (source checks: the components import React) ---

test("the Hire tab renders the Night Shift card inside a Panel, with no em dash", () => {
  const src = (path) => readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
  const card = src("components/NightShiftCard.jsx");
  const shop = src("components/Shop.jsx");
  assert.match(shop, /<NightShiftCard \/>/);
  assert.match(card, /<Panel/);
  assert.match(card, /BUY_NIGHT_SHIFT_LEVEL/);
  assert.match(card, /nightShiftNextPurchase/);
  assert.ok(!card.includes("—"));
  const context = src("context/GameContext.jsx");
  assert.match(context, /case "BUY_NIGHT_SHIFT_LEVEL"/);
  assert.match(context, /case "NIGHT_SHIFT_REPORT"/);
  const sync = src("save/saveSync.js");
  assert.equal((sync.match(/this\._reportNightShift\(data\.nightShift\)/g) ?? []).length, 2);
});

test("SaveSync: a load that settled hands the report to the game once, after restoring the settled state", async () => {
  const { SaveSync } = await import("../../client/src/save/saveSync.js");
  const srv = await startTestServer();
  const memory = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };
  };
  try {
    const playerId = await mint(srv);
    await store(srv, playerId, LEVEL5());
    srv.advance(8 * HOUR);
    const storage = memory();
    storage.setItem("grq:playerId", playerId);
    const events = [];
    let restored = null;
    const engine = new SaveSync({
      apiBaseUrl: srv.base,
      getState: () => ({ ...saveStateToGameFields(initialSaveState()), clickHistory: [], currentCPS: 0 }),
      restore: (saveState) => {
        restored = saveState;
        events.push("restore");
      },
      storage,
      onServerTime: () => {},
      onNightShift: (report) => events.push(["report", report.creditedLoc]),
    });
    await engine.init();
    assert.deepEqual(events, ["restore", ["report", 1_440_000]]);
    assert.ok(restored.emails.some((e) => e.triggerKey.startsWith("night-shift:")));
    assert.equal(restored.linesOfCode, 50_000 + 1_440_000);

    // A second client loading right after gets no report.
    const later = [];
    const engine2 = new SaveSync({
      apiBaseUrl: srv.base,
      getState: () => ({ ...saveStateToGameFields(initialSaveState()), clickHistory: [], currentCPS: 0 }),
      restore: () => {},
      storage,
      onServerTime: () => {},
      onNightShift: (report) => later.push(report),
    });
    await engine2.init();
    assert.deepEqual(later, []);
  } finally {
    await srv.stop();
  }
});

test("settle files the report mail in the same state: once per settlement, inbox cap kept", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const base = LEVEL5();
  const settled = settleNightShift(base, 8 * 3600, { nowMs: T0, emailId: id });
  const mails = settled.state.emails.filter((e) => e.triggerKey.startsWith("night-shift:"));
  assert.equal(mails.length, 1);
  assert.deepEqual(Object.keys(mails[0]).sort(), ["body", "createdAtMs", "id", "read", "sender", "subject", "triggerKey"]);
  assert.equal(mails[0].id, id);
  assert.equal(mails[0].triggerKey, `night-shift:${T0}`);
  assert.equal(mails[0].read, false);
  assert.equal(settled.report.triggerKey, `night-shift:${T0}`);
  // The same settlement key never files twice.
  const again = settleNightShift(settled.state, 8 * 3600, { nowMs: T0, emailId: id });
  assert.equal(again.state.emails.filter((e) => e.triggerKey === `night-shift:${T0}`).length, 1);
  // A full inbox drops its oldest mail to stay at the cap.
  const full = { ...base, emails: Array.from({ length: 25 }, (_, i) => ({ id: randomUUID(), triggerKey: `old:${i}`, sender: "a", subject: "b", body: "c", createdAtMs: i, read: true })) };
  const capped = settleNightShift(full, 8 * 3600, { nowMs: T0, emailId: id }).state.emails;
  assert.equal(capped.length, 25);
  assert.equal(capped[0].triggerKey, "old:1");
  assert.equal(capped.at(-1).triggerKey, `night-shift:${T0}`);
});

test("server: the report mail is stored with the credit, validates on the next save, and a reload keeps it", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mint(srv);
    await store(srv, playerId, LEVEL5());
    srv.advance(8 * HOUR);
    const first = await load(srv, playerId);
    const mail = first.state.emails.find((e) => e.triggerKey === first.nightShift.triggerKey);
    assert.ok(mail, "mail stored in the settled state");
    assert.equal(mail.id, first.nightShift.emailId);
    assert.match(mail.subject, /Night Shift report: \+1\.44M LOC/);
    // A reload (StrictMode, a second tab, a 409 revert) still has it, once.
    const second = await load(srv, playerId);
    assert.equal(second.state.emails.filter((e) => e.triggerKey.startsWith("night-shift:")).length, 1);
    // The settled state, mail included, passes the save shape check.
    srv.advance(2000);
    const res = await post(srv.base, "/api/save", { playerId, state: second.state, actionsSinceLastSave: zeroActions() });
    assert.equal(res.status, 200);
  } finally {
    await srv.stop();
  }
});
