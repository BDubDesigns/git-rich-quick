/**
 * Tests for SUBTRACTERALL after the issue #150 rework: unlimited uses,
 * a diminishing burst, and an escalating withdrawal (burnout in the
 * Overtime reskin). Replaces the tiers, liability, tolerance, and
 * recovery, which are gone from the engine and the save shape.
 *
 * Use n (1-indexed, resets on sale):
 *   burst       3x for 180 x 0.9^(n-1) s
 *   withdrawal  0.5 x 0.9^(n-1) for 180 x 1.2^(n-1) s
 *
 * Acceptance numbers (the issue's table):
 *   1: 180s at 3x, then 180s at 0.5x
 *   2: 162s at 3x, then 216s at 0.45x
 *   3: 145.8s at 3x, then 259.2s at 0.405x
 *   4: 131.22s at 3x, then 311.04s at 0.3645x
 *
 * Phase timers advance in credited simulation seconds only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  achievementMetricValue,
  advanceSubtracterall,
  applyPrestigeSale,
  formatSubtracterallMultiplier,
  formatSubtracterallSeconds,
  initialSaveState,
  normalizeSaveState,
  normalizeSubtracterallState,
  subtracterallActivate,
  subtracterallApplyClick,
  subtracterallBurstSeconds,
  subtracterallCanActivate,
  subtracterallFraming,
  subtracterallPhaseMultiplier,
  subtracterallUnlocked,
  subtracterallUseTerms,
  subtracterallWithdrawalMultiplier,
  subtracterallWithdrawalSeconds,
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

/** A fresh SUBTRACTERALL state with overrides. */
function subWith(overrides) {
  return { ...zeroSubtracterallState(), ...overrides };
}

/** Float compare for the 0.9^n / 1.2^n arithmetic. */
function near(actual, expected, label = "") {
  assert.ok(
    Math.abs(actual - expected) < 1e-9 * Math.max(1, Math.abs(expected)),
    `${label}: ${actual} vs ${expected}`
  );
}

// --- Config and unlock ---

test("config: unlock 100k lifetime LOC, 3x burst, 180s bases, 0.9 / 1.2 / 0.9 per use", () => {
  assert.deepEqual({ ...SUBTRACTERALL_CONFIG }, {
    unlockLifetimeLoc: 100_000,
    burstMultiplier: 3,
    burstBaseSeconds: 180,
    burstDecayPerUse: 0.9,
    withdrawalBaseSeconds: 180,
    withdrawalGrowthPerUse: 1.2,
    withdrawalBaseMultiplier: 0.5,
    withdrawalMultiplierDecayPerUse: 0.9,
  });
  // The removed system leaves nothing behind.
  for (const gone of ["maxDosesPerCompany", "tiers", "liabilityPerHealthyBurst", "withheldPerHealthyWithdrawal", "recoverySecondsPerTolerance", "withdrawalMultiplier"]) {
    assert.equal(SUBTRACTERALL_CONFIG[gone], undefined, gone);
  }
  assert.deepEqual(zeroSubtracterallState(), {
    phase: "ready",
    phaseRemainingSeconds: 0,
    uses: 0,
    activeUse: 0,
  });
});

test("unlocks permanently at 100,000 lifetime LOC", () => {
  assert.equal(subtracterallUnlocked(99_999), false);
  assert.equal(subtracterallUnlocked(100_000), true);
  assert.equal(subtracterallUnlocked(undefined), false);
  assert.equal(subtracterallUnlocked(-5), false);
});

// --- The scaling (acceptance numbers) ---

test("acceptance table: burst and withdrawal at uses 1 to 4", () => {
  const table = [
    [1, 180, 180, 0.5],
    [2, 162, 216, 0.45],
    [3, 145.8, 259.2, 0.405],
    [4, 131.22, 311.04, 0.3645],
  ];
  for (const [n, burst, withdrawal, multiplier] of table) {
    near(subtracterallBurstSeconds(n), burst, `burst ${n}`);
    near(subtracterallWithdrawalSeconds(n), withdrawal, `withdrawal ${n}`);
    near(subtracterallWithdrawalMultiplier(n), multiplier, `multiplier ${n}`);
    const terms = subtracterallUseTerms(n);
    assert.equal(terms.burstMultiplier, 3, `use ${n} burst stays 3x`);
    near(terms.burstSeconds, burst);
  }
});

test("the formulas are exactly 180 x 0.9^(n-1), 180 x 1.2^(n-1), 0.5 x 0.9^(n-1), with no cap or floor", () => {
  for (const n of [1, 5, 10, 25, 50]) {
    near(subtracterallBurstSeconds(n), 180 * 0.9 ** (n - 1));
    near(subtracterallWithdrawalSeconds(n), 180 * 1.2 ** (n - 1));
    near(subtracterallWithdrawalMultiplier(n), 0.5 * 0.9 ** (n - 1));
  }
  // Self-limiting: by use 30 the burst is under 9s and the crash is
  // over 9 hours at under 0.025x.
  assert.ok(subtracterallBurstSeconds(30) < 9);
  assert.ok(subtracterallWithdrawalSeconds(30) > 9 * 3600);
  assert.ok(subtracterallWithdrawalMultiplier(30) < 0.025);
  // A bad use number reads as use 1, never NaN.
  for (const bad of [0, -3, undefined, Number.NaN, "x"]) {
    assert.equal(subtracterallBurstSeconds(bad), 180);
    assert.equal(subtracterallWithdrawalMultiplier(bad), 0.5);
  }
});

test("the card's labels read the acceptance terms: 2m 42s, 2m 25.8s, 0.405x, 0.3645x", () => {
  assert.equal(formatSubtracterallSeconds(180), "3m");
  assert.equal(formatSubtracterallSeconds(162), "2m 42s");
  assert.equal(formatSubtracterallSeconds(216), "3m 36s");
  assert.equal(formatSubtracterallSeconds(subtracterallBurstSeconds(3)), "2m 25.8s");
  assert.equal(formatSubtracterallSeconds(subtracterallWithdrawalSeconds(3)), "4m 19.2s");
  assert.equal(formatSubtracterallSeconds(subtracterallBurstSeconds(4)), "2m 11.22s");
  assert.equal(formatSubtracterallSeconds(subtracterallWithdrawalSeconds(4)), "5m 11.04s");
  assert.equal(formatSubtracterallSeconds(45), "45s");
  assert.equal(formatSubtracterallSeconds(subtracterallWithdrawalSeconds(25)), "3h 58m");
  assert.equal(formatSubtracterallMultiplier(3), "3x");
  assert.equal(formatSubtracterallMultiplier(subtracterallWithdrawalMultiplier(3)), "0.405x");
  assert.equal(formatSubtracterallMultiplier(subtracterallWithdrawalMultiplier(4)), "0.3645x");
});

// --- Activation ---

test("activation needs Ready and positive healthy production, and there is no use cap", () => {
  assert.equal(subtracterallCanActivate(zeroSubtracterallState(), 100), true);
  assert.equal(subtracterallCanActivate(zeroSubtracterallState(), 0), false);
  assert.equal(subtracterallCanActivate(zeroSubtracterallState(), -5), false);
  assert.equal(subtracterallCanActivate(subWith({ phase: "burst", activeUse: 1 }), 100), false);
  assert.equal(subtracterallCanActivate(subWith({ phase: "withdrawal", activeUse: 1 }), 100), false);
  // The old 3-dose cap is gone: use 4, 50, and 500 are all allowed.
  for (const uses of [3, 49, 499]) {
    assert.equal(subtracterallCanActivate(subWith({ uses }), 100), true);
  }
  assert.equal(subtracterallActivate(subWith({ phase: "burst", activeUse: 1 })), null);
  assert.equal(subtracterallActivate(subWith({ phase: "withdrawal", activeUse: 1 })), null);
});

test("activating starts the next use's burst and counts it", () => {
  const first = subtracterallActivate(zeroSubtracterallState());
  assert.deepEqual(first, { phase: "burst", phaseRemainingSeconds: 180, uses: 1, activeUse: 1 });
  const third = subtracterallActivate(subWith({ uses: 2 }));
  assert.equal(third.uses, 3);
  assert.equal(third.activeUse, 3);
  near(third.phaseRemainingSeconds, 145.8);
  // A missing or NaN count reads as 0, so the next use is use 1.
  assert.equal(subtracterallActivate({ phase: "ready" }).uses, 1);
  assert.equal(subtracterallActivate(subWith({ uses: Number.NaN })).uses, 1);
});

test("many consecutive uses all go through, each crash longer and harsher than the last", () => {
  let sub = zeroSubtracterallState();
  let lastBurst = Infinity;
  let lastWithdrawal = 0;
  let lastMultiplier = 1;
  for (let n = 1; n <= 30; n += 1) {
    assert.equal(subtracterallCanActivate(sub, 100), true, `use ${n}`);
    sub = subtracterallActivate(sub);
    assert.equal(sub.uses, n);
    assert.ok(sub.phaseRemainingSeconds < lastBurst);
    lastBurst = sub.phaseRemainingSeconds;
    // Run the burst out: the withdrawal that follows uses this use.
    sub = advanceSubtracterall(sub, 100, sub.phaseRemainingSeconds).state;
    assert.equal(sub.phase, "withdrawal");
    assert.ok(sub.phaseRemainingSeconds > lastWithdrawal);
    lastWithdrawal = sub.phaseRemainingSeconds;
    const multiplier = subtracterallPhaseMultiplier(sub);
    assert.ok(multiplier < lastMultiplier);
    lastMultiplier = multiplier;
    sub = advanceSubtracterall(sub, 100, sub.phaseRemainingSeconds).state;
    assert.equal(sub.phase, "ready");
    assert.equal(sub.activeUse, 0);
  }
});

// --- Credited simulation time ---

test("a full use-1 cycle at 100 LOC/s: +36,000 in the burst, -9,000 in the crash (net +27,000)", () => {
  // Healthy output over 360s is 36,000. Burst: 180s x 300 = 54,000
  // (+36,000 over healthy). Withdrawal: 180s x 50 = 9,000 (-9,000).
  const used = subtracterallActivate(zeroSubtracterallState());
  const burst = advanceSubtracterall(used, 100, 180);
  near(burst.credited, 54_000);
  assert.equal(burst.state.phase, "withdrawal");
  near(burst.state.phaseRemainingSeconds, 180);
  const crash = advanceSubtracterall(burst.state, 100, 180);
  near(crash.credited, 9_000);
  assert.equal(crash.state.phase, "ready");
  assert.equal(crash.state.uses, 1);
});

test("use 4's withdrawal runs 311.04s at 0.3645x", () => {
  let sub = subtracterallActivate(subWith({ uses: 3 }));
  sub = advanceSubtracterall(sub, 100, subtracterallBurstSeconds(4)).state;
  assert.equal(sub.phase, "withdrawal");
  near(sub.phaseRemainingSeconds, 311.04);
  const oneSecond = advanceSubtracterall(sub, 100, 1);
  near(oneSecond.credited, 36.45);
});

test("phase timers advance per credited second, one tick at a time, and split at the boundary", () => {
  // 180 one-second ticks end the use-1 burst exactly.
  let sub = subtracterallActivate(zeroSubtracterallState());
  let credited = 0;
  for (let i = 0; i < 180; i += 1) {
    const r = advanceSubtracterall(sub, 10, 1);
    sub = r.state;
    credited += r.credited;
  }
  assert.equal(sub.phase, "withdrawal");
  near(credited, 5400);
  // Use 3's burst is 145.8s: the 146th tick is 0.8s at 3x and 0.2s at 0.405x.
  sub = subtracterallActivate(subWith({ uses: 2 }));
  sub = advanceSubtracterall(sub, 100, 145).state;
  near(sub.phaseRemainingSeconds, 0.8);
  const boundary = advanceSubtracterall(sub, 100, 1);
  near(boundary.credited, 0.8 * 300 + 0.2 * 40.5);
  assert.equal(boundary.state.phase, "withdrawal");
  near(boundary.state.phaseRemainingSeconds, 259.0);
});

test("no wall-clock input: the engine only moves when credited seconds are passed in", () => {
  const sub = subWith({ phase: "withdrawal", phaseRemainingSeconds: 100, uses: 2, activeUse: 2 });
  assert.deepEqual(advanceSubtracterall(sub, 100, 0).state, sub);
  // A tick with no production still advances the phase clock (the
  // tick IS credited time) and credits nothing.
  const idle = advanceSubtracterall(sub, 0, 1);
  assert.equal(idle.credited, 0);
  assert.equal(idle.state.phaseRemainingSeconds, 99);
  // The engine source never reads the clock.
  const src = readFileSync(new URL("../../shared/game-balance.js", import.meta.url), "utf8");
  const engine = src.slice(
    src.indexOf("export function advanceSubtracterall"),
    src.indexOf("export function subtracterallApplyClick")
  );
  assert.doesNotMatch(engine, /Date\.now|new Date|performance\.now/);
});

test("clicks through the phase: burst 3x, withdrawal floor(multiplier x click), ready unchanged", () => {
  assert.equal(subtracterallApplyClick(zeroSubtracterallState(), 7).credited, 7);
  assert.equal(subtracterallApplyClick(subWith({ phase: "burst", phaseRemainingSeconds: 5, uses: 1, activeUse: 1 }), 7).credited, 21);
  // Use 1 withdrawal: floor(0.5 x 7) = 3. Use 3: floor(0.405 x 100) = 40.
  assert.equal(subtracterallApplyClick(subWith({ phase: "withdrawal", phaseRemainingSeconds: 5, uses: 1, activeUse: 1 }), 7).credited, 3);
  assert.equal(subtracterallApplyClick(subWith({ phase: "withdrawal", phaseRemainingSeconds: 5, uses: 3, activeUse: 3 }), 100).credited, 40);
  // A click never advances time.
  const sub = subWith({ phase: "burst", phaseRemainingSeconds: 5, uses: 1, activeUse: 1 });
  assert.deepEqual(subtracterallApplyClick(sub, 7).state, sub);
  assert.equal(subtracterallApplyClick(sub, Number.NaN).credited, 0);
});

// --- Sale ---

test("the use count resets on sale: the next company starts at use 1", () => {
  const pre = {
    ...initialSaveState(),
    totalLinesOfCode: 1_000_000,
    linesOfCode: 1_000_000,
    subtracterall: subWith({ uses: 7 }),
  };
  const post = applyPrestigeSale(pre, randomUUID());
  assert.deepEqual(post.subtracterall, zeroSubtracterallState());
  const next = subtracterallActivate(post.subtracterall);
  assert.equal(next.uses, 1);
  assert.equal(next.phaseRemainingSeconds, 180);
});

test("a sale mid-withdrawal keeps the withdrawal and its terms; the count still resets", () => {
  const pre = {
    ...initialSaveState(),
    totalLinesOfCode: 1_000_000,
    linesOfCode: 1_000_000,
    subtracterall: subWith({ phase: "withdrawal", phaseRemainingSeconds: 200, uses: 4, activeUse: 4 }),
  };
  const post = applyPrestigeSale(pre, randomUUID());
  assert.deepEqual(post.subtracterall, { phase: "withdrawal", phaseRemainingSeconds: 200, uses: 0, activeUse: 4 });
  // Still use 4's crash: 0.3645x, and no activation over it.
  near(subtracterallPhaseMultiplier(post.subtracterall), 0.3645);
  assert.equal(subtracterallCanActivate(post.subtracterall, 100), false);
  // When it ends, the new company's first use is use 1.
  const ended = advanceSubtracterall(post.subtracterall, 100, 200).state;
  assert.equal(ended.phase, "ready");
  assert.equal(subtracterallActivate(ended).activeUse, 1);
});

test("criterion 9 (server): selling during withdrawal returns the surviving phase", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const pre = await setState(srv, playerId, {
      linesOfCode: 1_000_000,
      totalLinesOfCode: 1_000_000,
      subtracterall: subWith({ phase: "withdrawal", phaseRemainingSeconds: 150.5, uses: 2, activeUse: 2 }),
    });
    const res = await sell(srv.base, playerId, pre);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.state.subtracterall, {
      phase: "withdrawal",
      phaseRemainingSeconds: 150.5,
      uses: 0,
      activeUse: 2,
    });
  } finally {
    await srv.stop();
  }
});

// --- Framing ---

test("the Overtime reskin changes only the words, and never says dose", () => {
  assert.equal(subtracterallFraming(false), SUBTRACTERALL_FRAMING.subtracterall);
  assert.equal(subtracterallFraming(true), SUBTRACTERALL_FRAMING.overtime);
  const overtime = SUBTRACTERALL_FRAMING.overtime;
  assert.equal(overtime.name, "Overtime");
  assert.equal(overtime.action, "Mandate Overtime");
  assert.equal(overtime.withdrawalLabel, "Burnout");
  const overtimeText = Object.values(overtime).join(" ").toLowerCase();
  assert.doesNotMatch(overtimeText, /dose/);
  assert.doesNotMatch(overtimeText, /withdrawal/);
  // Both framings carry the same keys, so the card renders either.
  assert.deepEqual(
    Object.keys(SUBTRACTERALL_FRAMING.subtracterall).sort(),
    Object.keys(overtime).sort()
  );
  // Both explain the tradeoff in plain language.
  for (const framing of Object.values(SUBTRACTERALL_FRAMING)) {
    assert.match(framing.scalingNote, /shorter/);
    assert.match(framing.scalingNote, /longer and harsher/);
    for (const text of Object.values(framing)) assert.ok(!text.includes("\u2014"), text);
  }
});

test("the card and strip are Panel-based, use the framing, and carry no em dash", () => {
  const src = (path) =>
    readFileSync(new URL(`../../client/src/components/${path}`, import.meta.url), "utf8");
  const card = src("SubtracterallCard.jsx");
  const strip = src("SubtracterallStrip.jsx");
  const sale = src("SellCompany.jsx");
  assert.match(card, /<Panel/);
  assert.match(card, /ACTIVATE_SUBTRACTERALL/);
  for (const key of ["usesLabel", "nextLabel", "scalingNote", "withdrawalLabel", "action"]) {
    assert.match(card, new RegExp(`framing\\.${key}`), key);
  }
  for (const text of [card, strip]) assert.ok(!text.includes("\u2014"));
  for (const text of [card, strip, sale]) {
    assert.doesNotMatch(text, /liabilit|tolerance|three doses|dosesUsed/i);
  }
  // The Settings card and the header strip never hard-code "dose".
  assert.doesNotMatch(card.replace(/\/\*[\s\S]*?\*\//g, ""), /[Dd]ose/);
  assert.doesNotMatch(strip.replace(/\/\*[\s\S]*?\*\//g, ""), /[Dd]ose/);
});

test("the Borrowed Time achievement reads in both framings and counts a use", () => {
  assert.equal(achievementMetricValue("dosesTaken", { subtracterall: zeroSubtracterallState() }), 0);
  assert.equal(achievementMetricValue("dosesTaken", { subtracterall: subWith({ uses: 1 }) }), 1);
  assert.equal(achievementMetricValue("dosesTaken", { subtracterall: subWith({ phase: "withdrawal", activeUse: 2 }) }), 1);
});

// --- Save shape ---

test("a fresh save carries the new SUBTRACTERALL fields and the reskin setting", () => {
  const fresh = initialSaveState();
  assert.deepEqual(fresh.subtracterall, zeroSubtracterallState());
  assert.equal(fresh.overtimeReskin, false);
});

test("old saves get fresh defaults: no field, or the pre-#150 tier / liability shape", () => {
  const legacy = {
    phase: "withdrawal",
    phaseRemainingSeconds: 120,
    liability: 5000,
    tolerance: 2,
    activeTier: 1,
    dosesUsed: 2,
    recoverySeconds: 3000,
  };
  assert.deepEqual(normalizeSubtracterallState(legacy), zeroSubtracterallState());
  assert.deepEqual(normalizeSubtracterallState(undefined), zeroSubtracterallState());
  assert.deepEqual(normalizeSubtracterallState([]), zeroSubtracterallState());
  // A current-shape value is kept as is (a load never cures a phase).
  const current = subWith({ phase: "burst", phaseRemainingSeconds: 3, uses: 1, activeUse: 1 });
  assert.deepEqual(normalizeSubtracterallState(current), current);
  const old = { ...initialSaveState(), subtracterall: legacy };
  assert.deepEqual(normalizeSaveState(old).subtracterall, zeroSubtracterallState());
});

test("a stored pre-#150 save still accepts the next save from a new client", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const old = initialSaveState();
    old.linesOfCode = 500_000;
    old.totalLinesOfCode = 1_500_000;
    old.subtracterall = {
      phase: "burst",
      phaseRemainingSeconds: 20,
      liability: 900,
      tolerance: 1,
      activeTier: 0,
      dosesUsed: 1,
      recoverySeconds: 0,
    };
    await setRawState(srv, playerId, old);
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
    assert.deepEqual((await saved.json()).state.subtracterall, zeroSubtracterallState());
  } finally {
    await srv.stop();
  }
});

test("a save mid-withdrawal validates with a fractional remaining time", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const stored = await setState(srv, playerId, {
      linesOfCode: 500_000,
      totalLinesOfCode: 1_500_000,
      subtracterall: subWith({ phase: "withdrawal", phaseRemainingSeconds: 258.2, uses: 3, activeUse: 3 }),
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
    assert.deepEqual(next.subtracterall, { phase: "withdrawal", phaseRemainingSeconds: 258.2, uses: 3, activeUse: 3 });
    assert.equal(next.overtimeReskin, true);
  } finally {
    await srv.stop();
  }
});

test("shape: an invalid phase, count, or remaining time is rejected", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    await setState(srv, playerId, { linesOfCode: 500_000, totalLinesOfCode: 1_500_000 });
    const badSubs = [
      subWith({ phase: "high" }),
      subWith({ uses: -1 }),
      subWith({ uses: 1.5 }),
      subWith({ activeUse: -1 }),
      subWith({ phaseRemainingSeconds: -1 }),
      subWith({ phaseRemainingSeconds: Number.POSITIVE_INFINITY }),
      // Ready never has an active use; a phase always has one.
      subWith({ phase: "ready", activeUse: 2 }),
      subWith({ phase: "burst", phaseRemainingSeconds: 10, activeUse: 0 }),
      { ...zeroSubtracterallState(), extra: 1 },
    ];
    for (const sub of badSubs) {
      srv.advance(2000);
      const state = initialSaveState();
      state.linesOfCode = 500_000;
      state.totalLinesOfCode = 1_500_000;
      state.subtracterall = sub;
      const res = await post(srv.base, "/api/save", {
        playerId,
        state,
        actionsSinceLastSave: zeroActions(),
      });
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(sub)}, got ${res.status}`);
    }
    srv.advance(2000);
    const state = initialSaveState();
    state.linesOfCode = 500_000;
    state.totalLinesOfCode = 1_500_000;
    state.overtimeReskin = "yes";
    const res = await post(srv.base, "/api/save", { playerId, state, actionsSinceLastSave: zeroActions() });
    assert.equal(res.status, 400);
  } finally {
    await srv.stop();
  }
});

test("the store never offers anything that softens SUBTRACTERALL", () => {
  assert.deepEqual(PRESTIGE_STORE_IDS, [
    "startingCapital",
    "keyboard",
    "engineeringHandbook",
    "clientNetwork",
    "companyTemplate",
  ]);
  for (const storeId of PRESTIGE_STORE_IDS) {
    const text = JSON.stringify(PRESTIGE_STORE_CONFIG[storeId]).toLowerCase();
    for (const word of ["subtracterall", "withdrawal", "burnout", "dose", "overtime"]) {
      assert.ok(!text.includes(word), `${storeId}: ${word}`);
    }
  }
});
