/**
 * Tests for prestige Slice 4 (offline/phase reconciliation + pacing
 * verification): the reconciliation slice that makes Slices 1-3
 * behave correctly across reloads, tabs, sales, and offline gaps.
 * It adds no new feature and changes no mechanic.
 *
 * What this slice verified by audit (no code change needed):
 * - Phase timers advance ONLY in credited simulation seconds. The
 *   only writer of phaseRemainingSeconds is advanceSubtracterall
 *   (shared/game-balance.js); the tick passes exactly 1 credited
 *   second per GAME_TICK; the UI only reads the value for display;
 *   the server only validates it. No load, reload, sale, or save
 *   path advances a phase timer on wall-clock elapsed time.
 * - No offline LOC is credited anywhere. The load path is
 *   RESTORE_SAVE -> saveStateToGameFields (a pure field copy:
 *   linesOfCode/totalLinesOfCode copied verbatim, a present
 *   subtracterall phase never reset), the
 *   server stores and returns the state as-is, and savedAt is used
 *   only for the rate-limit retryAfter and the footer "Saved Xs
 *   ago" display. The early "offline accrual capped 8h" was a
 *   design claim from the original save-system era; the actual
 *   implementation never credits offline LOC (the server became
 *   dumb cloud-save storage when the leaderboard was killed).
 * - The two known granularities, both pre-existing and out of
 *   scope: a star expiring mid-tick applies its rate for the whole
 *   1s tick (the tick computes one healthy rate per dispatch), and
 *   up to 60s of tick drift can be lost if the game closes between
 *   heartbeat saves (the stored phase state is always
 *   self-consistent: phase + remaining + use from the same
 *   tick).
 *
 * Acceptance criteria from the v2 prestige design, section 9:
 * 8. Burst ending, crash ending, star expiry, sale, and offline
 *    intervals settle in timestamp order without lost or duplicated
 *    production.
 * 9. Sale/reload during either drug phase preserves its state; a
 *    new company cannot activate over an existing withdrawal.
 * 10. Offline output matches an equivalent online employee-only
 *     interval under the same offline rules; absence beyond the
 *     credit cap does not shorten a withdrawal. (Issue #150
 *     replaced liability with fixed-duration withdrawals.)
 *
 * Balance evidence from the design, section 10 (Founder curve and
 * full-store arc times, run through the live engine):
 * - Founder multiplier at P=51 and P=85 (the log branch, not
 *   covered by the Slice 1 test which stops at P=50, 100, 200).
 * - Full-store arc times, including a correction: the Slice 4
 *   brief attached 6,944.44h at 100 LOC/s to the FULL store, but
 *   that figure is the 50-Equity arc (2.5B LOC). The full store
 *   (7.225B LOC) at 100 LOC/s is 20,069.44h. The design doc
 *   section 4 agrees (20,069.44h / 836.23 days). Pinned here so
 *   the wrong figure cannot be quoted as the store cost again.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  advanceSubtracterall,
  equityThresholdLoc,
  founderMultiplier,
  initialSaveState,
  normalizeSaveState,
  subtracterallActivate,
  subtracterallCanActivate,
  zeroSubtracterallState,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const EIGHT_HOURS_MS = 8 * 3600 * 1000;

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

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

async function loadState(base, playerId) {
  const res = await fetch(`${base}/api/load?playerId=${playerId}`);
  assert.equal(res.status, 200);
  return (await res.json()).state;
}

/** Set a player's stored state directly (test setup, not the save path). */
async function setState(srv, playerId, overrides) {
  const state = initialSaveState();
  for (const [key, value] of Object.entries(overrides)) {
    state[key] =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? { ...state[key], ...value }
        : value;
  }
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return state;
}

function zeroActions() {
  const counts = (keys) =>
    keys.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {});
  return {
    clicks: 0,
    employeesBought: counts(EMPLOYEE_TYPES),
    projectsCompleted: counts(FREELANCE_PROJECT_KEYS),
    autoShips: counts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: counts(OPEN_SOURCE_IDS),
  };
}

/** A fresh SUBTRACTERALL state with overrides. */
function subWith(overrides) {
  return { ...zeroSubtracterallState(), ...overrides };
}

/** Float compare for the 0.9^n / 1.2^n phase arithmetic. */
function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} vs ${expected}`);
}

// --- Criterion 8: timestamp-order settlement (issue #150 mechanic) ---

test("criterion 8: one advance spans burst, withdrawal, and ready in timestamp order with exact totals", () => {
  // Use 1 at a constant 100 LOC/s: 180s of burst at 3x (54,000) +
  // 180s of withdrawal at 0.5x (9,000) = 63,000 credited over the
  // 360s cycle, phase Ready, vs the 36,000 healthy output.
  const used = subtracterallActivate(zeroSubtracterallState());
  const cycle = advanceSubtracterall(used, 100, 360);
  near(cycle.credited, 63_000, "cycle");
  assert.equal(cycle.state.phase, "ready");
  assert.equal(cycle.state.phaseRemainingSeconds, 0);
  assert.equal(cycle.state.activeUse, 0);
  assert.equal(cycle.state.uses, 1);

  // The same cycle plus 640s of Ready time at 1x (64,000): the burst
  // end, the withdrawal end, and the Ready tail settle in order
  // inside a single call.
  const long = advanceSubtracterall(used, 100, 1000);
  near(long.credited, 127_000, "long");
  assert.equal(long.state.phase, "ready");
});

test("criterion 8: a star expiring after the burst settles in timestamp order (burst at 5x, withdrawal at 1x)", () => {
  // The burst runs at 500 LOC/s (a 5x Overclock on a 100 base) for
  // 180s: 270,000 credited. The star then expires, and the
  // withdrawal runs at 0.5 x 100 for 180s (9,000), then 300s of
  // Ready at 100 (30,000).
  const used = subtracterallActivate(zeroSubtracterallState());
  const burst = advanceSubtracterall(used, 500, 180);
  near(burst.credited, 270_000, "burst");
  assert.equal(burst.state.phase, "withdrawal");
  near(burst.state.phaseRemainingSeconds, 180, "withdrawal length");
  const settled = advanceSubtracterall(burst.state, 100, 480);
  near(settled.credited, 9_000 + 30_000, "settled");
  assert.equal(settled.state.phase, "ready");
});

test("criterion 8: a fractional phase boundary splits exactly (use 3 burst ends 0.2s into the interval)", () => {
  // Use 3: burst 145.8s at 3x, withdrawal 259.2s at 0.405x. Advancing
  // 146s at 100 LOC/s credits 145.8s at 3x (43,740) plus 0.2s at
  // 0.405x (8.1). A whole-interval rounding would have credited the
  // tail at the wrong phase's rate.
  const used = subtracterallActivate(subWith({ uses: 2 }));
  const split = advanceSubtracterall(used, 100, 146);
  near(split.credited, 43_748.1, "credited");
  assert.equal(split.state.phase, "withdrawal");
  near(split.state.phaseRemainingSeconds, 259.0, "remaining");
});

// --- Criterion 10: no offline credit, no forgiven crash ---

test("criterion 10: a reload after an 8-hour gap returns the mid-burst state unchanged and credits zero offline LOC", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const stored = await setState(srv, playerId, {
      linesOfCode: 500_000,
      totalLinesOfCode: 1_500_000,
      subtracterall: subWith({
        phase: "burst",
        phaseRemainingSeconds: 25,
        uses: 1,
        activeUse: 1,
      }),
    });
    // Eight hours of absence: no offline production exists, so the
    // gap must advance nothing: no LOC and no phase time. A
    // wall-clock timer would have ended the 25s burst and eaten into
    // the withdrawal while the player was away.
    srv.advance(EIGHT_HOURS_MS);
    const loaded = await loadState(srv.base, playerId);
    assert.deepEqual(loaded.subtracterall, stored.subtracterall);
    assert.equal(loaded.linesOfCode, 500_000);
    assert.equal(loaded.totalLinesOfCode, 1_500_000);
    assert.deepEqual(loaded, stored);
  } finally {
    await srv.stop();
  }
});

test("criterion 10: a reload after an 8-hour gap during withdrawal does not shorten it", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const stored = await setState(srv, playerId, {
      linesOfCode: 500_000,
      totalLinesOfCode: 1_500_000,
      subtracterall: subWith({
        phase: "withdrawal",
        phaseRemainingSeconds: 120.5,
        uses: 2,
        activeUse: 2,
      }),
      overtimeReskin: true,
    });
    srv.advance(EIGHT_HOURS_MS);
    const loaded = await loadState(srv.base, playerId);
    assert.deepEqual(loaded.subtracterall, stored.subtracterall);
    assert.equal(loaded.subtracterall.phaseRemainingSeconds, 120.5);
    assert.equal(loaded.linesOfCode, 500_000);
    assert.equal(loaded.totalLinesOfCode, 1_500_000);
    assert.equal(loaded.overtimeReskin, true);
    assert.deepEqual(loaded, stored);
  } finally {
    await srv.stop();
  }
});

test("criterion 10: normalizeSaveState is time-independent: the load path cannot credit offline LOC", () => {
  // The load seam takes no time input at all: it is a pure field
  // backfill. A mid-withdrawal save normalizes to itself, with the
  // phase and both LOC counters byte-identical, and normalizing the
  // result again changes nothing.
  const state = {
    ...initialSaveState(),
    linesOfCode: 500_000,
    totalLinesOfCode: 1_500_000,
    subtracterall: subWith({
      phase: "withdrawal",
      phaseRemainingSeconds: 120,
      uses: 2,
      activeUse: 2,
    }),
  };
  const once = normalizeSaveState(state);
  assert.equal(once.linesOfCode, 500_000);
  assert.equal(once.totalLinesOfCode, 1_500_000);
  assert.deepEqual(once.subtracterall, state.subtracterall);
  const twice = normalizeSaveState(once);
  assert.deepEqual(twice, once);
});

// --- Criterion 9: sale during a burst (server level) ---

test("criterion 9 (server): selling during a burst keeps the burst and resets the use count", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 1_000_000,
      money: 2000000,
      subtracterall: subWith({
        phase: "burst",
        phaseRemainingSeconds: 25,
        uses: 3,
        activeUse: 3,
      }),
    });
    const res = await post(srv.base, "/api/save/sell", {
      playerId,
      saleId: randomUUID(),
      state: pre,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.state.lifetimeEquityEarned, 1);
    // The burst carries on with its own terms (use 3); the new
    // company's count starts again at 0, so its next use is use 1.
    assert.deepEqual(body.state.subtracterall, {
      phase: "burst",
      phaseRemainingSeconds: 25,
      uses: 0,
      activeUse: 3,
    });
    // The new company cannot activate over the surviving burst.
    assert.equal(subtracterallCanActivate(body.state.subtracterall, 100), false);
    // A reload after the sale returns the same surviving burst.
    const loaded = await loadState(srv.base, playerId);
    assert.deepEqual(loaded.subtracterall, body.state.subtracterall);
  } finally {
    await srv.stop();
  }
});

// --- Balance evidence (design section 10) ---

test("balance evidence: Founder multiplier at P=51 and P=85 (log branch)", () => {
  // The Slice 1 test covers P=0, 1, 4, 10, 50, 100, 200. The log
  // branch starts just past 50, and the design quotes 6.3828x at
  // P=85 (section 4: 23,360.93 LOC/s from the same 3,660 workforce).
  // Continuity at the branch point, then the two new points.
  assert.equal(founderMultiplier(50), 6);
  const at51 = founderMultiplier(51);
  assert.ok(Math.abs(at51 - (6 + 0.5 * Math.log2(1 + 1 / 50))) < 1e-12);
  assert.equal(at51.toFixed(4), "6.0143");
  const at85 = founderMultiplier(85);
  assert.ok(Math.abs(at85 - (6 + 0.5 * Math.log2(1 + 35 / 50))) < 1e-12);
  assert.equal(at85.toFixed(4), "6.3828");
});

test("balance evidence: full-store arc times from the engine thresholds", () => {
  // 85 Equity needs 85^2 x 1M = 7.225B lifetime LOC (criterion 17,
  // already covered in prestige.test.js). The times below are
  // arithmetic on that engine threshold at constant rates.
  assert.equal(equityThresholdLoc(85), 7_225_000_000);
  const fullAt3660 = equityThresholdLoc(85) / 3660 / 3600;
  assert.ok(Math.abs(fullAt3660 - 548.35) < 0.01);
  // CORRECTION: the Slice 4 brief attached 6,944.44h at 100 LOC/s
  // to the full store. That figure is the 50-Equity arc (2.5B LOC),
  // not the store. The full store at 100 LOC/s is 20,069.44h, which
  // is what the design doc section 4 says (20,069.44h / 836.23 days).
  const fullAt100 = equityThresholdLoc(85) / 100 / 3600;
  assert.ok(Math.abs(fullAt100 - 20069.44) < 0.01);
  const arc50At100 = equityThresholdLoc(50) / 100 / 3600;
  assert.ok(Math.abs(arc50At100 - 6944.44) < 0.01);
  const arc50At3660 = equityThresholdLoc(50) / 3660 / 3600;
  assert.ok(Math.abs(arc50At3660 - 189.74) < 0.01);
});
