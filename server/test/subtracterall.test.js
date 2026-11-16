/**
 * Tests for prestige Slice 3 (SUBTRACTERALL): the optional burst that
 * borrows productivity from later, per the v2 prestige design section
 * 5 as refined by Brandon's Nov 15, 2026 decisions (SUBTRACTERALL is
 * the default name; Overtime is a reskin setting with a "wellness
 * clinic" framing; the farm resets on sale; all upgrades reset on
 * sale; the Founder bonus is on lifetime Equity earned even if
 * spent).
 *
 * Pure-function tests import from shared/game-balance.js; sale and
 * shape tests run against a real store backed by in-memory Postgres
 * (pg-mem), with an injected clock — the same harness as
 * prestige.test.js. Phase timers advance in CREDITED simulation
 * seconds (one advance call = the credited seconds passed), never
 * wall-clock: there is no offline production yet, so uncredited
 * absence advances nothing.
 *
 * Acceptance criteria from the v2 prestige design, section 9:
 * 6. First dose at constant 100 LOC/s gives exactly +12,000 burst
 *    output, -18,000 crash output (net -6,000, a 20% loss over the
 *    5-minute cycle).
 * 7. The 5x Overclock example leaves 90,000 liability and needs 20
 *    minutes at 100 LOC/s after the star expires.
 * 9. Sale/reload during either drug phase preserves its state; a new
 *    company cannot dose over an existing withdrawal.
 * 11. Star and dose multipliers never multiply fixed Airdrops;
 *     Airdrops never repay liability.
 * 12. Tolerance drops by exactly one after six eligible healthy
 *     hours, retains partial progress on sale, and resets partial
 *     recovery on another dose.
 * 14. Third company dose exhausts supply; unused supply does not
 *     accumulate into the next company.
 * 21. At 3,660 LOC/s the unchanged first dose creates 658,800
 *     liability and loses 219,600 LOC over its full constant-rate
 *     cycle.
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
  PRESTIGE_STORE_CONFIG,
  PRESTIGE_STORE_IDS,
  SUBTRACTERALL_CONFIG,
  SUBTRACTERALL_FRAMING,
  advanceSubtracterall,
  applyPrestigeSale,
  initialSaveState,
  subtracterallApplyClick,
  subtracterallCanDose,
  subtracterallFraming,
  subtracterallTakeDose,
  subtracterallUnlocked,
  subtracterallWithdrawalEstimateSeconds,
  zeroSubtracterallState,
} from "../../shared/game-balance.js";

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

/** Store a raw state object as-is (no initial-state merge): for a
 * save that predates Slice 3, with the SUBTRACTERALL fields deleted. */
async function setRawState(srv, playerId, state) {
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

/** A sale request for a pre-sale state, with a fresh sale id. */
function sellBody(playerId, state, saleId = randomUUID()) {
  return {
    playerId,
    saleId,
    state,
    actionsSinceLastSave: zeroActions(),
  };
}

async function sell(base, playerId, state, saleId) {
  return post(base, "/api/save/sell", sellBody(playerId, state, saleId));
}

/** A fresh SUBTRACTERALL state with overrides (a dosed state, a
 * withdrawal state, a high-tolerance state). */
function subWith(overrides) {
  return { ...zeroSubtracterallState(), ...overrides };
}

/** Take a tier-0 dose and run the full 60s burst at `rate`, returning
 * the withdrawal state. */
function burstAt(rate) {
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  assert.notEqual(dosed, null);
  const result = advanceSubtracterall(dosed, rate, 60);
  assert.equal(result.state.phase, "withdrawal");
  return result;
}

// --- Config and unlock ---

test("SUBTRACTERALL config: unlock 100k lifetime LOC, 3 doses, 6h recovery, tiers 60/240, 40/540, 25/960", () => {
  assert.equal(SUBTRACTERALL_CONFIG.unlockLifetimeLoc, 100_000);
  assert.equal(SUBTRACTERALL_CONFIG.maxDosesPerCompany, 3);
  assert.equal(SUBTRACTERALL_CONFIG.recoverySecondsPerTolerance, 21_600);
  assert.equal(SUBTRACTERALL_CONFIG.burstMultiplier, 3);
  assert.equal(SUBTRACTERALL_CONFIG.withdrawalMultiplier, 0.25);
  assert.equal(SUBTRACTERALL_CONFIG.liabilityPerHealthyBurst, 3);
  assert.equal(SUBTRACTERALL_CONFIG.withheldPerHealthyWithdrawal, 0.75);
  assert.deepEqual(SUBTRACTERALL_CONFIG.tiers, [
    { burstSeconds: 60, minWithdrawalSeconds: 240 },
    { burstSeconds: 40, minWithdrawalSeconds: 540 },
    { burstSeconds: 25, minWithdrawalSeconds: 960 },
  ]);
  // The minimum withdrawal curve is 60 x (tier + 1)^2 seconds,
  // where the tier is 1-indexed (first dose = tier 1).
  assert.equal(60 * 2 * 2, 240);
  assert.equal(60 * 3 * 3, 540);
  assert.equal(60 * 4 * 4, 960);
});

test("SUBTRACTERALL unlocks permanently at 100,000 lifetime LOC", () => {
  assert.equal(subtracterallUnlocked(0), false);
  assert.equal(subtracterallUnlocked(99_999), false);
  assert.equal(subtracterallUnlocked(100_000), true);
  assert.equal(subtracterallUnlocked(16_533_977), true);
});

// --- Dose gating ---

test("a dose requires Ready phase, remaining supply, and positive healthy production", () => {
  const fresh = zeroSubtracterallState();
  assert.equal(subtracterallCanDose(fresh, 100), true);
  assert.equal(subtracterallCanDose(fresh, 0), false);
  assert.equal(subtracterallCanDose(fresh, -5), false);
  assert.equal(
    subtracterallCanDose(subWith({ phase: "burst" }), 100),
    false
  );
  assert.equal(
    subtracterallCanDose(subWith({ phase: "withdrawal" }), 100),
    false
  );
  assert.equal(
    subtracterallCanDose(subWith({ dosesUsed: 3 }), 100),
    false
  );
  assert.equal(
    subtracterallCanDose(subWith({ dosesUsed: 2 }), 100),
    true
  );
});

test("taking a dose uses the current tolerance tier, then raises tolerance and resets recovery", () => {
  // Tier 0: 60s burst, tolerance 0 -> 1, one dose used.
  const first = subtracterallTakeDose(zeroSubtracterallState());
  assert.equal(first.phase, "burst");
  assert.equal(first.phaseRemainingSeconds, 60);
  assert.equal(first.activeTier, 0);
  assert.equal(first.tolerance, 1);
  assert.equal(first.dosesUsed, 1);
  assert.equal(first.liability, 0);
  assert.equal(first.recoverySeconds, 0);

  // Tier 1: 40s burst, tolerance 1 -> 2.
  const second = subtracterallTakeDose(
    subWith({ tolerance: 1, dosesUsed: 1, recoverySeconds: 10_800 })
  );
  assert.equal(second.phaseRemainingSeconds, 40);
  assert.equal(second.activeTier, 1);
  assert.equal(second.tolerance, 2);
  assert.equal(second.dosesUsed, 2);
  // Partial recovery progress resets to zero on another dose.
  assert.equal(second.recoverySeconds, 0);

  // Tier 2: 25s burst, tolerance caps at 2.
  const third = subtracterallTakeDose(
    subWith({ tolerance: 2, dosesUsed: 2 })
  );
  assert.equal(third.phaseRemainingSeconds, 25);
  assert.equal(third.activeTier, 2);
  assert.equal(third.tolerance, 2);
  assert.equal(third.dosesUsed, 3);
});

test("taking a dose returns null when the phase is not Ready or the supply is exhausted", () => {
  assert.equal(
    subtracterallTakeDose(subWith({ phase: "burst" })),
    null
  );
  assert.equal(
    subtracterallTakeDose(subWith({ phase: "withdrawal" })),
    null
  );
  assert.equal(
    subtracterallTakeDose(subWith({ dosesUsed: 3 })),
    null
  );
});

// --- Worked examples (criteria 6, 21, 7) ---

test("criterion 6: at constant 100 LOC/s, dose tier 1 gives +12,000 burst and -18,000 crash (net -6,000)", () => {
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  // Burst: 60s at 100 LOC/s healthy. Credited 3x = 18,000; healthy
  // 6,000, so the burst extra is +12,000. Liability is 3x healthy.
  const burst = advanceSubtracterall(dosed, 100, 60);
  assert.equal(burst.credited, 18_000);
  assert.equal(burst.state.liability, 18_000);
  assert.equal(burst.state.phase, "withdrawal");
  assert.equal(burst.state.phaseRemainingSeconds, 240);
  // Withdrawal: 240s at 100 LOC/s healthy. Credited 0.25x = 6,000;
  // healthy 24,000, so the crash is -18,000 and the liability
  // clears exactly as the minimum duration ends.
  const crash = advanceSubtracterall(burst.state, 100, 240);
  assert.equal(crash.credited, 6_000);
  assert.equal(crash.state.liability, 0);
  assert.equal(crash.state.phase, "ready");
  assert.equal(crash.state.phaseRemainingSeconds, 0);
  // Net over the 5-minute cycle: +12,000 - 18,000 = -6,000, a 20%
  // loss on the 30,000 healthy LOC the cycle would have produced.
  assert.equal(burst.credited + crash.credited, 24_000);
  assert.equal(burst.credited + crash.credited - 100 * 300, -6_000);
});

test("criterion 21: at 3,660 LOC/s, dose tier 1 gives +439,200 burst and 658,800 liability (net -219,600)", () => {
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  const burst = advanceSubtracterall(dosed, 3660, 60);
  assert.equal(burst.credited, 658_800);
  assert.equal(burst.state.liability, 658_800);
  // Burst extra: credited 658,800 minus healthy 219,600 = +439,200.
  assert.equal(burst.credited - 3660 * 60, 439_200);
  const crash = advanceSubtracterall(burst.state, 3660, 240);
  assert.equal(crash.credited, 219_600);
  assert.equal(crash.state.liability, 0);
  assert.equal(crash.state.phase, "ready");
  assert.equal(burst.credited + crash.credited - 3660 * 300, -219_600);
});

test("criterion 7: with 5x Overclock through the first burst at 100 LOC/s, liability is 90,000 and repayment takes 20 minutes after the star expires", () => {
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  // Burst at 500 LOC/s (100 x 5x Overclock): extra 60,000 LOC,
  // liability 90,000.
  const burst = advanceSubtracterall(dosed, 500, 60);
  assert.equal(burst.credited, 90_000);
  assert.equal(burst.state.liability, 90_000);
  assert.equal(burst.credited - 500 * 60, 60_000);
  // The star expires: back to 100 LOC/s. The 240s minimum
  // withdrawal repays 18,000 of the 90,000, leaving 72,000.
  const minWithdrawal = advanceSubtracterall(burst.state, 100, 240);
  assert.equal(minWithdrawal.credited, 6_000);
  assert.equal(minWithdrawal.state.liability, 72_000);
  assert.equal(minWithdrawal.state.phase, "withdrawal");
  assert.equal(minWithdrawal.state.phaseRemainingSeconds, 0);
  // The remaining 72,000 clears at 75 LOC/s withheld (0.75 x 100),
  // which takes 960s. 240 + 960 = 1200s = 20 minutes after the
  // star expires, and the phase ends at the exact debt-clear point.
  const repaid = advanceSubtracterall(minWithdrawal.state, 100, 960);
  assert.equal(repaid.credited, 24_000);
  assert.equal(repaid.state.liability, 0);
  assert.equal(repaid.state.phase, "ready");
});

// --- Phase boundaries and the both-conditions rule ---

test("withdrawal ends only when BOTH the minimum duration elapsed AND liability is zero: liability clears first", () => {
  const { state } = burstAt(10);
  // Liability 1,800 after a 10 LOC/s burst. At 100 LOC/s withdrawal
  // it clears after 24s, but the 240s minimum has not elapsed.
  const cleared = advanceSubtracterall(state, 100, 24);
  assert.equal(cleared.state.liability, 0);
  assert.equal(cleared.state.phase, "withdrawal");
  assert.equal(cleared.state.phaseRemainingSeconds, 216);
  // Withholding continues at 0.25x until the minimum timer ends;
  // the surplus is never banked against a future dose.
  const ended = advanceSubtracterall(cleared.state, 100, 216);
  assert.equal(ended.state.phase, "ready");
  assert.equal(ended.state.liability, 0);
  // A later dose starts with zero liability, not a credit.
  const next = subtracterallTakeDose(ended.state);
  assert.equal(next.liability, 0);
});

test("withdrawal ends only when BOTH conditions hold: minimum elapses first, then the debt clears at the exact point", () => {
  const { state } = burstAt(100);
  // At 1 LOC/s the 240s minimum repays only 180 of the 18,000.
  const minElapsed = advanceSubtracterall(state, 1, 240);
  assert.equal(minElapsed.state.liability, 17_820);
  assert.equal(minElapsed.state.phase, "withdrawal");
  assert.equal(minElapsed.state.phaseRemainingSeconds, 0);
  // The remaining 17,820 clears at 0.75 LOC/s, which takes exactly
  // 23,760s. The withdrawal ends at that exact debt-clear point.
  const cleared = advanceSubtracterall(minElapsed.state, 1, 23_760);
  assert.equal(cleared.state.liability, 0);
  assert.equal(cleared.state.phase, "ready");
  assert.equal(cleared.credited, 5_940);
});

test("a phase ending mid-interval splits the interval at the boundary", () => {
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  // 90s at 100 LOC/s: 60s of burst at 3x (18,000) + 30s of
  // withdrawal at 0.25x (750). Liability after the burst part is
  // 18,000; the 30s withdrawal repays 2,250, leaving 15,750.
  const split = advanceSubtracterall(dosed, 100, 90);
  assert.equal(split.credited, 18_750);
  assert.equal(split.state.liability, 15_750);
  assert.equal(split.state.phase, "withdrawal");
  assert.equal(split.state.phaseRemainingSeconds, 210);
  // And a debt clearing mid-interval credits the remainder at 1x:
  // 24,000s at 1 LOC/s after the minimum elapsed repays 17,820 in
  // 23,760s (5,940 credited) and credits the last 240s at 1x (240).
  const { state } = burstAt(100);
  const minElapsed = advanceSubtracterall(state, 1, 240);
  const overrun = advanceSubtracterall(minElapsed.state, 1, 24_000);
  assert.equal(overrun.credited, 5_940 + 240);
  assert.equal(overrun.state.liability, 0);
  assert.equal(overrun.state.phase, "ready");
});

test("a tick with no production advances the phase clock but repays no liability", () => {
  const { state } = burstAt(100);
  const idle = advanceSubtracterall(state, 0, 60);
  assert.equal(idle.credited, 0);
  assert.equal(idle.state.liability, 18_000);
  assert.equal(idle.state.phase, "withdrawal");
  assert.equal(idle.state.phaseRemainingSeconds, 180);
});

// --- Clicks ---

test("clicks through the phase: burst 3x, withdrawal floor(0.25x) with exact repayment, ready unchanged", () => {
  // Burst: a 10 LOC click credits 30 and adds 30 to liability.
  const burst = subWith({ phase: "burst", phaseRemainingSeconds: 60 });
  const burstClick = subtracterallApplyClick(burst, 10);
  assert.equal(burstClick.credited, 30);
  assert.equal(burstClick.state.liability, 30);
  assert.equal(burstClick.state.phase, "burst");

  // Withdrawal: a 10 LOC click credits floor(2.5) = 2, and the
  // withheld 8 repays liability exactly (credited + withheld = 10).
  const withdrawal = subWith({
    phase: "withdrawal",
    phaseRemainingSeconds: 240,
    liability: 100,
  });
  const withdrawalClick = subtracterallApplyClick(withdrawal, 10);
  assert.equal(withdrawalClick.credited, 2);
  assert.equal(withdrawalClick.state.liability, 92);
  assert.equal(withdrawalClick.state.phase, "withdrawal");

  // A click that clears the last liability when the minimum has
  // already elapsed ends the withdrawal right there.
  const lastDebt = subWith({
    phase: "withdrawal",
    phaseRemainingSeconds: 0,
    liability: 8,
  });
  const clearingClick = subtracterallApplyClick(lastDebt, 10);
  assert.equal(clearingClick.credited, 2);
  assert.equal(clearingClick.state.liability, 0);
  assert.equal(clearingClick.state.phase, "ready");

  // Ready: the healthy click is credited unchanged.
  const readyClick = subtracterallApplyClick(zeroSubtracterallState(), 10);
  assert.equal(readyClick.credited, 10);
  assert.equal(readyClick.state.liability, 0);
});

// --- Tolerance recovery (criterion 12) ---

test("criterion 12: tolerance drops by exactly one after six eligible healthy hours", () => {
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  const burst = advanceSubtracterall(dosed, 100, 60);
  const ready = advanceSubtracterall(burst.state, 100, 240);
  assert.equal(ready.state.phase, "ready");
  assert.equal(ready.state.tolerance, 1);
  // Five hours: no drop yet, partial progress kept.
  const fiveHours = advanceSubtracterall(ready.state, 100, 5 * 3600);
  assert.equal(fiveHours.state.tolerance, 1);
  assert.equal(fiveHours.state.recoverySeconds, 18_000);
  // The sixth hour drops exactly one tier.
  const sixHours = advanceSubtracterall(fiveHours.state, 100, 3600);
  assert.equal(sixHours.state.tolerance, 0);
  assert.equal(sixHours.state.recoverySeconds, 0);
  // A second dose at tolerance 1, then twelve healthy hours, drops
  // two tiers (one per six hours), never below zero.
  const dosedAgain = subtracterallTakeDose(sixHours.state);
  assert.equal(dosedAgain.tolerance, 1);
  const cycled = advanceSubtracterall(
    advanceSubtracterall(dosedAgain, 100, 60).state,
    100,
    240
  );
  const twelveHours = advanceSubtracterall(cycled.state, 100, 12 * 3600);
  assert.equal(twelveHours.state.tolerance, 0);
  assert.equal(twelveHours.state.recoverySeconds, 0);
});

test("criterion 12: recovery needs positive employee production and no active phase", () => {
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  const ready = advanceSubtracterall(
    advanceSubtracterall(dosed, 100, 60).state,
    100,
    240
  );
  assert.equal(ready.state.tolerance, 1);
  // Six hours at zero production: no recovery, and no liability
  // change either (nothing to withhold from).
  const idle = advanceSubtracterall(ready.state, 0, 6 * 3600);
  assert.equal(idle.state.tolerance, 1);
  assert.equal(idle.state.recoverySeconds, 0);
  // Six hours during a burst: the phase runs, but recovery does
  // not accrue while a phase is active.
  const dosedAgain = subtracterallTakeDose(ready.state);
  const duringBurst = advanceSubtracterall(dosedAgain, 100, 60);
  assert.equal(duringBurst.state.tolerance, 2);
  assert.equal(duringBurst.state.recoverySeconds, 0);
});

// --- Withdrawal estimate ---

test("withdrawal estimate is null without production, and exact at a steady rate", () => {
  const { state } = burstAt(100);
  assert.equal(
    subtracterallWithdrawalEstimateSeconds(state, 0),
    null
  );
  assert.equal(
    subtracterallWithdrawalEstimateSeconds(state, -5),
    null
  );
  // At 100 LOC/s the 240s minimum repays the whole 18,000, so the
  // estimate is exactly the remaining minimum: 240s.
  assert.equal(subtracterallWithdrawalEstimateSeconds(state, 100), 240);
  // At 1 LOC/s the minimum repays only 180, leaving 17,820 to
  // clear at 0.75 LOC/s: 240 + 23,760 = 24,000s.
  assert.equal(subtracterallWithdrawalEstimateSeconds(state, 1), 24_000);
  // Not a withdrawal: no estimate.
  assert.equal(
    subtracterallWithdrawalEstimateSeconds(zeroSubtracterallState(), 100),
    null
  );
});

// --- Supply (criterion 14) ---

test("criterion 14: the third company dose exhausts the supply; a new company gets exactly three fresh doses", () => {
  const third = subtracterallTakeDose(subWith({ dosesUsed: 2 }));
  assert.equal(third.dosesUsed, 3);
  assert.equal(subtracterallCanDose(third, 100), false);
  assert.equal(subtracterallTakeDose(third), null);
  // A sale resets the supply to zero used (three fresh doses); it
  // does not carry the used count forward.
  const pre = {
    ...initialSaveState(),
    totalLinesOfCode: 1_000_000,
    subtracterall: subWith({ dosesUsed: 3 }),
  };
  const post = applyPrestigeSale(pre, randomUUID());
  assert.equal(post.subtracterall.dosesUsed, 0);
  assert.equal(subtracterallCanDose(post.subtracterall, 100), true);
});

// --- Sale preservation (criterion 9) ---

test("criterion 9: a sale during withdrawal preserves the phase, liability, tolerance, and recovery, and resets only the dose supply", () => {
  const pre = {
    ...initialSaveState(),
    totalLinesOfCode: 1_000_000,
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
  const post = applyPrestigeSale(pre, randomUUID());
  assert.deepEqual(post.subtracterall, {
    phase: "withdrawal",
    phaseRemainingSeconds: 120,
    liability: 5000,
    tolerance: 2,
    activeTier: 1,
    dosesUsed: 0,
    recoverySeconds: 3000,
  });
  // The new company cannot dose over the existing withdrawal, even
  // with a fresh supply.
  assert.equal(subtracterallCanDose(post.subtracterall, 100), false);
  assert.equal(subtracterallTakeDose(post.subtracterall), null);
  // A sale during a burst preserves it the same way.
  const burstPre = {
    ...initialSaveState(),
    totalLinesOfCode: 1_000_000,
    subtracterall: subWith({
      phase: "burst",
      phaseRemainingSeconds: 25,
      liability: 9000,
      tolerance: 1,
      activeTier: 0,
      dosesUsed: 1,
      recoverySeconds: 0,
    }),
  };
  const burstPost = applyPrestigeSale(burstPre, randomUUID());
  assert.equal(burstPost.subtracterall.phase, "burst");
  assert.equal(burstPost.subtracterall.phaseRemainingSeconds, 25);
  assert.equal(burstPost.subtracterall.liability, 9000);
  assert.equal(burstPost.subtracterall.dosesUsed, 0);
});

test("criterion 9 (server): selling during withdrawal returns the surviving phase in the post-sale state", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 1_000_000,
      money: 2000000,
      subtracterall: subWith({
        phase: "withdrawal",
        phaseRemainingSeconds: 120,
        liability: 5000,
        tolerance: 2,
        activeTier: 1,
        dosesUsed: 2,
        recoverySeconds: 3000,
      }),
    });
    const res = await sell(srv.base, playerId, pre);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.state.subtracterall, {
      phase: "withdrawal",
      phaseRemainingSeconds: 120,
      liability: 5000,
      tolerance: 2,
      activeTier: 1,
      dosesUsed: 0,
      recoverySeconds: 3000,
    });
    // The Overtime reskin setting survives the sale too.
    assert.equal(body.state.overtimeReskin, false);
  } finally {
    await srv.stop();
  }
});

test("criterion 12 (sale): partial tolerance recovery survives a sale", () => {
  const pre = {
    ...initialSaveState(),
    totalLinesOfCode: 1_000_000,
    subtracterall: subWith({ tolerance: 1, recoverySeconds: 10_800 }),
  };
  const post = applyPrestigeSale(pre, randomUUID());
  assert.equal(post.subtracterall.tolerance, 1);
  assert.equal(post.subtracterall.recoverySeconds, 10_800);
});

// --- Airdrops (criterion 11) ---

test("criterion 11: only production repays liability — a gain with no production behind it repays nothing", () => {
  const { state } = burstAt(100);
  // An Airdrop is a fixed LOC gain, not production: it never flows
  // through advanceSubtracterall or subtracterallApplyClick, so it
  // can neither create nor repay liability. The closest unit-level
  // check: credited time with zero production moves the clock but
  // leaves the liability exactly where it was.
  const idle = advanceSubtracterall(state, 0, 60);
  assert.equal(idle.state.liability, 18_000);
  assert.equal(idle.credited, 0);
  // And a zero-LOC click repays nothing.
  const noClick = subtracterallApplyClick(state, 0);
  assert.equal(noClick.credited, 0);
  assert.equal(noClick.state.liability, 18_000);
});

// --- Overtime reskin framing ---

test("the Overtime reskin changes only the framing, never the mechanics", () => {
  const drug = subtracterallFraming(false);
  const overtime = subtracterallFraming(true);
  assert.equal(drug.name, "SUBTRACTERALL");
  assert.equal(overtime.name, "Overtime");
  assert.equal(drug.doseAction, "Take Dose");
  assert.equal(overtime.doseAction, "Work Overtime");
  assert.equal(drug.withdrawalLabel, "Withdrawal");
  assert.equal(overtime.withdrawalLabel, "Wellness clinic");
  assert.equal(
    overtime.withdrawalDescription,
    "The overtime is over. Time to visit the wellness clinic."
  );
  // Same durations, same multipliers, same liability: the framing is
  // a text layer, so the same state advances identically either way.
  const dosed = subtracterallTakeDose(zeroSubtracterallState());
  const burst = advanceSubtracterall(dosed, 100, 60);
  assert.equal(burst.credited, 18_000);
  assert.equal(burst.state.liability, 18_000);
  assert.deepEqual(SUBTRACTERALL_FRAMING.subtracterall, drug);
  assert.deepEqual(SUBTRACTERALL_FRAMING.overtime, overtime);
});

// --- Save shape, migration, and validation ---

test("a fresh save carries the SUBTRACTERALL fields and the reskin setting", () => {
  const fresh = initialSaveState();
  assert.deepEqual(fresh.subtracterall, zeroSubtracterallState());
  assert.equal(fresh.overtimeReskin, false);
});

test("migration: a save from before Slice 3 shipped backfills to a fresh Ready state and still validates", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    // A pre-Slice-3 stored state: the two new fields deleted.
    const old = initialSaveState();
    old.linesOfCode = 500_000;
    old.totalLinesOfCode = 1_500_000;
    delete old.subtracterall;
    delete old.overtimeReskin;
    await setRawState(srv, playerId, old);

    // A normal save from a new client (fields present) validates
    // against it: the backfill is a fresh Ready state, never a
    // reset of a phase the old save never had.
    srv.advance(2000);
    const current = initialSaveState();
    current.linesOfCode = 500_000;
    current.totalLinesOfCode = 1_500_000;
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: current,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200);
    const stored = (await saved.json()).state;
    assert.deepEqual(stored.subtracterall, zeroSubtracterallState());
    assert.equal(stored.overtimeReskin, false);
  } finally {
    await srv.stop();
  }
});

test("a save carrying a withdrawal phase validates, and the phase survives a normal save", async () => {
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
    srv.advance(2000);
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: stored,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200);
    const next = (await saved.json()).state;
    assert.deepEqual(next.subtracterall, {
      phase: "withdrawal",
      phaseRemainingSeconds: 120,
      liability: 5000,
      tolerance: 2,
      activeTier: 1,
      dosesUsed: 2,
      recoverySeconds: 3000,
    });
    assert.equal(next.overtimeReskin, true);
  } finally {
    await srv.stop();
  }
});

test("shape: an invalid phase, tolerance, or dose count is rejected", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, {
      linesOfCode: 500_000,
      totalLinesOfCode: 1_500_000,
    });
    const badStates = [
      { subtracterall: subWith({ phase: "high" }) },
      { subtracterall: subWith({ tolerance: 3 }) },
      { subtracterall: subWith({ activeTier: -1 }) },
      { subtracterall: subWith({ dosesUsed: 4 }) },
      { subtracterall: subWith({ phaseRemainingSeconds: -1 }) },
      { subtracterall: subWith({ liability: -100 }) },
      { subtracterall: subWith({ recoverySeconds: -1 }) },
      { overtimeReskin: "yes" },
    ];
    for (const overrides of badStates) {
      srv.advance(2000);
      const state = initialSaveState();
      state.linesOfCode = 500_000;
      state.totalLinesOfCode = 1_500_000;
      for (const [key, value] of Object.entries(overrides)) {
        state[key] =
          value !== null && typeof value === "object" && !Array.isArray(value)
            ? { ...state[key], ...value }
            : value;
      }
      const res = await post(srv.base, "/api/save", {
        playerId,
        state,
        actionsSinceLastSave: zeroActions(),
      });
      assert.equal(
        res.status,
        400,
        `expected 400 for ${JSON.stringify(overrides)}, got ${res.status}`
      );
    }
  } finally {
    await srv.stop();
  }
});

test("the store never offers anything that removes withdrawal or restores doses", () => {
  // The permanent store (Slice 2) has exactly five tracks, and none
  // of them touches SUBTRACTERALL: no withdrawal cure, no dose
  // refill, no tolerance reset. This is a guard against a future
  // store addition quietly breaking the design's hard rule.
  assert.deepEqual(PRESTIGE_STORE_IDS, [
    "startingCapital",
    "keyboard",
    "engineeringHandbook",
    "clientNetwork",
    "companyTemplate",
  ]);
  for (const storeId of PRESTIGE_STORE_IDS) {
    const config = PRESTIGE_STORE_CONFIG[storeId];
    const text = JSON.stringify(config).toLowerCase();
    assert.ok(!text.includes("subtracterall"));
    assert.ok(!text.includes("withdrawal"));
    assert.ok(!text.includes("dose"));
    assert.ok(!text.includes("tolerance"));
  }
});
