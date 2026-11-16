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
 *   subtracterall phase/liability/tolerance never reset), the
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
 *   self-consistent: phase + remaining + liability from the same
 *   tick).
 *
 * Acceptance criteria from the v2 prestige design, section 9:
 * 8. Burst ending, crash ending, star expiry, sale, and offline
 *    intervals settle in timestamp order without lost or duplicated
 *    production.
 * 9. Sale/reload during either drug phase preserves its state; a
 *    new company cannot dose over an existing withdrawal.
 * 10. Offline output matches an equivalent online employee-only
 *     interval under the same offline rules; absence beyond the
 *     credit cap does not forgive liability.
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
  subtracterallCanDose,
  subtracterallTakeDose,
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

// --- Criterion 8: timestamp-order settlement ---

test("criterion 8: one advance spans burst, withdrawal, and ready in timestamp order with exact totals", () => {
  // Tier 1 at a constant 100 LOC/s: 60s of burst (18,000 credited,
  // 18,000 liability) + 240s of withdrawal (6,000 credited, the
  // withheld 18,000 clears the liability exactly at the minimum)
  // = 24,000 credited over the 300s cycle, phase Ready, net -6,000
  // vs the 30,000 healthy output (criterion 6, re-run here as one
  // continuous interval instead of two calls).
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  const cycle = advanceSubtracterall(dosed, 100, 300);
  assert.equal(cycle.credited, 24_000);
  assert.equal(cycle.state.phase, "ready");
  assert.equal(cycle.state.liability, 0);
  assert.equal(cycle.state.phaseRemainingSeconds, 0);
  assert.equal(cycle.state.tolerance, 1);
  assert.equal(cycle.state.recoverySeconds, 0);

  // The same cycle plus 700s of Ready time: the extra 700s credit
  // at 1x (70,000) and accrue 700s of tolerance recovery, so the
  // burst end, the withdrawal end, and the recovery accrual all
  // settle in order inside a single call.
  const long = advanceSubtracterall(dosed, 100, 1000);
  assert.equal(long.credited, 94_000);
  assert.equal(long.state.phase, "ready");
  assert.equal(long.state.liability, 0);
  assert.equal(long.state.tolerance, 1);
  assert.equal(long.state.recoverySeconds, 700);
});

test("criterion 8: a star expiring mid-withdrawal settles in timestamp order (burst at 5x, withdrawal at 1x)", () => {
  // Criterion 7's numbers, carried to full settlement: the burst
  // runs at 500 LOC/s (5x Overclock on a 100 base) for 60s, so the
  // liability is 90,000 and 90,000 LOC are credited. The star then
  // expires, and the withdrawal repays at 100 LOC/s.
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  const burst = advanceSubtracterall(dosed, 500, 60);
  assert.equal(burst.credited, 90_000);
  assert.equal(burst.state.liability, 90_000);
  assert.equal(burst.state.phase, "withdrawal");
  assert.equal(burst.state.phaseRemainingSeconds, 240);

  // The 240s minimum repays 18,000 (liability 72,000 left), then
  // the debt clears after 72,000 / 75 = 960s more, and the last
  // 300s of the 1,500s interval credit at 1x in Ready.
  const settled = advanceSubtracterall(burst.state, 100, 1500);
  assert.equal(settled.credited, 6_000 + 24_000 + 30_000);
  assert.equal(settled.state.phase, "ready");
  assert.equal(settled.state.liability, 0);
  assert.equal(settled.state.tolerance, 1);
  assert.equal(settled.state.recoverySeconds, 300);

  // And the exact debt-clear point: 1,200s (240 minimum + 960 to
  // clear) ends the withdrawal with no Ready time left over.
  const exact = advanceSubtracterall(burst.state, 100, 1200);
  assert.equal(exact.credited, 6_000 + 24_000);
  assert.equal(exact.state.phase, "ready");
  assert.equal(exact.state.liability, 0);
  assert.equal(exact.state.recoverySeconds, 0);
});

test("criterion 8: a fractional phase boundary splits exactly (burst ends 0.5s into the interval)", () => {
  // 60.5s at 100 LOC/s: 60s of burst (18,000 credited, 18,000
  // liability) + 0.5s of withdrawal (12.5 credited, 37.5 withheld,
  // liability 17,962.5). A whole-interval rounding would have
  // credited the half second at the wrong phase's rate.
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  const split = advanceSubtracterall(dosed, 100, 60.5);
  assert.equal(split.credited, 18_012.5);
  assert.equal(split.state.liability, 17_962.5);
  assert.equal(split.state.phase, "withdrawal");
  assert.equal(split.state.phaseRemainingSeconds, 239.5);
});

// --- Criterion 10: no offline credit, no forgiven liability ---

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
        liability: 9000,
        tolerance: 1,
        activeTier: 0,
        dosesUsed: 1,
        recoverySeconds: 0,
      }),
    });
    // Eight hours of absence: no offline production exists, so the
    // gap must advance nothing: no LOC, no phase time, no liability
    // change. A wall-clock timer would have ended the 25s burst
    // and eaten into the withdrawal while the player was away.
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

test("criterion 10: a reload after an 8-hour gap during withdrawal forgives no liability", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const stored = await setState(srv, playerId, {
      linesOfCode: 500_000,
      totalLinesOfCode: 1_500_000,
      subtracterall: subWith({
        phase: "withdrawal",
        phaseRemainingSeconds: 120,
        liability: 5000,
        tolerance: 2,
        activeTier: 1,
        dosesUsed: 2,
        recoverySeconds: 3000,
      }),
      overtimeReskin: true,
    });
    srv.advance(EIGHT_HOURS_MS);
    const loaded = await loadState(srv.base, playerId);
    assert.deepEqual(loaded.subtracterall, stored.subtracterall);
    assert.equal(loaded.subtracterall.liability, 5000);
    assert.equal(loaded.subtracterall.phaseRemainingSeconds, 120);
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
  // phase, the liability, and both LOC counters byte-identical, and
  // normalizing the result again changes nothing. This pins the
  // invariant a future offline-credit addition would have to break
  // deliberately, not by accident.
  const state = {
    ...initialSaveState(),
    linesOfCode: 500_000,
    totalLinesOfCode: 1_500_000,
    subtracterall: subWith({
      phase: "withdrawal",
      phaseRemainingSeconds: 120,
      liability: 5000,
      tolerance: 2,
      activeTier: 1,
      dosesUsed: 2,
      recoverySeconds: 3000,
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

test("criterion 9 (server): selling during a burst returns the surviving burst in the post-sale state", async () => {
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
        liability: 9000,
        tolerance: 1,
        activeTier: 0,
        dosesUsed: 1,
        recoverySeconds: 0,
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
    assert.deepEqual(body.state.subtracterall, {
      phase: "burst",
      phaseRemainingSeconds: 25,
      liability: 9000,
      tolerance: 1,
      activeTier: 0,
      dosesUsed: 0,
      recoverySeconds: 0,
    });
    // The new company cannot dose over the surviving burst, even
    // with its fresh three-dose supply.
    assert.equal(subtracterallCanDose(body.state.subtracterall, 100), false);
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
