/**
 * Tests for the save validator — pure function, no database.
 *
 * The scenarios below are hand-computed from the client rules in
 * `GameContext.jsx` (master 86053c3), not derived from the implementation,
 * so they catch drift between the server's math and the game's math.
 *
 * Key numbers: intern 1 LOC/s, junior 5, senior 20; click = 1 LOC base;
 * To Do List App 50 LOC -> 3000c; intern costs 2500c, junior 20000c
 * (x1.15 each), senior 150000c (x1.2 each); OverReact levels cost
 * 100/500/3000 LOC for +1/+2/+4 click bonus; Blocker levels cost
 * 2000/10000/75000 LOC for +0.5/+1/+1.5 passive bonus.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave } from "../src/validate.js";
import {
  employeeCost,
  initialSaveState,
  locPerClick,
  locPerSecond,
  openSourceLevelCosts,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";

function zeroCounts() {
  return {
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
  };
}

function zeroActions() {
  return { clicks: 0, ...zeroCounts(), starClaims: [] };
}

function prev(state, savedAtMs) {
  return { state, savedAtMs };
}

function body(state, actions) {
  return { playerId: PLAYER_ID, state, actionsSinceLastSave: actions };
}

/** A save state derived from the initial state with overrides. */
function stateWith(overrides) {
  const state = initialSaveState();
  for (const [key, value] of Object.entries(overrides)) {
    state[key] =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? { ...state[key], ...value }
        : value;
  }
  return state;
}

test("shared math matches the client formulas", () => {
  assert.equal(employeeCost("intern", 2), 3025); // round(2500 * 1.1^2)
  assert.equal(employeeCost("junior", 0), 20000);
  assert.equal(employeeCost("junior", 1), 23000); // round(20000 * 1.15)
  assert.equal(employeeCost("senior", 1), 180000); // round(150000 * 1.2)
  assert.equal(
    locPerSecond({ intern: 3, junior: 1, senior: 0 }, { overReactFramework: 0, blocker: 0 }),
    8
  );
  assert.equal(
    locPerSecond({ intern: 3, junior: 1, senior: 0 }, { overReactFramework: 0, blocker: 1 }),
    12
  );
  // Level 2 means levels 1 and 2 are both active: bonus 1 + 2 = 3, so 1 x (1 + 3) = 4.
  assert.equal(locPerClick({ overReactFramework: 2, blocker: 0 }), 4);
  const fresh = initialSaveState();
  assert.deepEqual(fresh.unlockedEmployees, {
    intern: true,
    junior: false,
    senior: false,
  });
  assert.deepEqual(fresh.unlockedOpenSourceProjects, {
    overReactFramework: true,
    blocker: false,
    constellation: true,
  });
  // Levels 4-5 (issue #33 slice): OverReact keeps doubling the click
  // bonus (8, 16), Blocker keeps adding 0.5 passive (2, 2.5).
  assert.equal(locPerClick({ overReactFramework: 5, blocker: 0 }), 32);
  assert.equal(
    locPerSecond(
      { intern: 3, junior: 1, senior: 0 },
      { overReactFramework: 0, blocker: 5 }
    ),
    68
  );
  assert.equal(
    openSourceLevelCosts("overReactFramework", 0, 5),
    100 + 500 + 3000 + 15000 + 75000
  );
  assert.equal(
    openSourceLevelCosts("blocker", 0, 5),
    2000 + 10000 + 75000 + 300000 + 1500000
  );
  assert.equal(
    openSourceLevelCosts("constellation", 0, 5),
    1000 + 5000 + 20000 + 75000 + 250000
  );
});

test("legit play: clicks, then a project, then a hire, then passive", () => {
  // Window 1: 60s, 50 clicks, complete the To Do List App (50 LOC -> 3000c).
  const afterClicks = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 50,
    money: 3000,
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const r1 = validateSave(
    prev(initialSaveState(), T0),
    body(afterClicks, {
      clicks: 50,
      ...zeroCounts(),
      projectsCompleted: {
        toDoListApp: 1,
        hobbyWebsite: 0,
        paradigmShiftingBlockchainProject: 0,
      },
    }),
    T0 + 60_000
  );
  assert.deepEqual(r1, { ok: true });

  // Window 2: 60s, buy one intern (2500c of the 3000c).
  const afterHire = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 50,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const r2 = validateSave(
    prev(afterClicks, T0 + 60_000),
    body(afterHire, {
      ...zeroActions(),
      employeesBought: { intern: 1, junior: 0, senior: 0 },
    }),
    T0 + 120_000
  );
  assert.deepEqual(r2, { ok: true });

  // Window 3: 60s, one intern earns 60 LOC passively.
  const afterPassive = stateWith({
    linesOfCode: 60,
    totalLinesOfCode: 110,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const r3 = validateSave(
    prev(afterHire, T0 + 120_000),
    body(afterPassive, zeroActions()),
    T0 + 180_000
  );
  assert.deepEqual(r3, { ok: true });
});

test("tampered money is rejected, exact to the cent", () => {
  const before = stateWith({
    linesOfCode: 60,
    totalLinesOfCode: 110,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const tampered = stateWith({
    linesOfCode: 60,
    totalLinesOfCode: 110,
    money: 501,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const r = validateSave(
    prev(before, T0),
    body(tampered, zeroActions()),
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "MONEY");
});

test("inflated LOC is rejected", () => {
  const before = stateWith({
    linesOfCode: 60,
    totalLinesOfCode: 110,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const tampered = stateWith({
    linesOfCode: 1000,
    totalLinesOfCode: 110,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const r = validateSave(
    prev(before, T0),
    body(tampered, zeroActions()),
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "LOC");
});

test("decreasing totals and latches are rejected", () => {
  const before = stateWith({
    linesOfCode: 60,
    totalLinesOfCode: 110,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const decreased = stateWith({
    linesOfCode: 60,
    totalLinesOfCode: 109,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const r = validateSave(
    prev(before, T0),
    body(decreased, zeroActions()),
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "MONOTONIC");
});

test("claimed unlock without meeting the conditions is rejected", () => {
  const before = stateWith({
    linesOfCode: 60,
    totalLinesOfCode: 110,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const cheater = stateWith({
    linesOfCode: 60,
    totalLinesOfCode: 110,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
    unlockedEmployees: { senior: true },
  });
  const r = validateSave(
    prev(before, T0),
    body(cheater, zeroActions()),
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "UNLOCK");
});

test("shape violations: NoPilot, level 6, unknown keys, bad types", () => {
  const before = stateWith({
    linesOfCode: 60,
    totalLinesOfCode: 110,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const cases = [
    stateWith({
      linesOfCode: 60,
      totalLinesOfCode: 110,
      money: 500,
      employees: { intern: 1 },
      freelanceProjectsCompleted: { toDoListApp: 1 },
      aiAssistants: { noPilot: 1 },
    }),
    stateWith({
      linesOfCode: 60,
      totalLinesOfCode: 110,
      money: 500,
      employees: { intern: 1 },
      freelanceProjectsCompleted: { toDoListApp: 1 },
      openSourceProjects: { overReactFramework: 6 },
    }),
    stateWith({
      linesOfCode: 60,
      totalLinesOfCode: 110,
      money: 500,
      employees: { intern: 1 },
      freelanceProjectsCompleted: { toDoListApp: 1 },
      extraKey: true,
    }),
    stateWith({
      linesOfCode: 60,
      totalLinesOfCode: 110,
      money: 500.5,
      employees: { intern: 1 },
      freelanceProjectsCompleted: { toDoListApp: 1 },
    }),
  ];
  for (const bad of cases) {
    const r = validateSave(
      prev(before, T0),
      body(bad, zeroActions()),
      T0 + 60_000
    );
    assert.equal(r.ok, false);
    assert.equal(r.rule, "SHAPE");
  }
});

test("action deltas must agree with the snapshot", () => {
  const before = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 50,
    money: 3000,
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  // Claims an intern purchase, but the snapshot shows no new intern.
  // (Money is set to 500, as if the purchase had been paid for, so the
  // money rule passes and the delta rule is the one that fires.)
  const snapshot = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 50,
    money: 500,
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const r = validateSave(
    prev(before, T0),
    body(snapshot, {
      ...zeroActions(),
      employeesBought: { intern: 1, junior: 0, senior: 0 },
    }),
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "DELTA");
});

test("clicks above 10/sec are rejected", () => {
  const r = validateSave(
    prev(initialSaveState(), T0),
    body(
      stateWith({ linesOfCode: 1000, totalLinesOfCode: 1000 }),
      { ...zeroActions(), clicks: 1000 }
    ),
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "CLICKS");
});

test("a save within 10s of the last one is rate-limited", () => {
  const r = validateSave(
    prev(initialSaveState(), T0),
    body(initialSaveState(), zeroActions()),
    T0 + 5_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "RATE_LIMIT");
});

test("offline passive accrual is capped at 8 hours", () => {
  const before = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 50,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  // 48h away, one intern: capped at 8h = 28,800 LOC.
  const capped = stateWith({
    linesOfCode: 28800,
    totalLinesOfCode: 28850,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const ok = validateSave(
    prev(before, T0),
    body(capped, zeroActions()),
    T0 + 48 * 60 * 60 * 1000
  );
  assert.deepEqual(ok, { ok: true });

  const over = stateWith({
    linesOfCode: 30000,
    totalLinesOfCode: 30050,
    money: 500,
    employees: { intern: 1 },
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const rejected = validateSave(
    prev(before, T0),
    body(over, zeroActions()),
    T0 + 48 * 60 * 60 * 1000
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.rule, "LOC");
});

test("buying an OverReact level mid-window does not false-reject", () => {
  // The player had 100 LOC, bought OverReact level 1 (100 LOC), then
  // clicked 100 times at the new rate of 2 LOC/click: 100 + 200 - 100 = 200.
  // Crediting at the new snapshot's rates accepts this; the previous
  // snapshot's rates would reject it (see the deviation note in validate.js).
  const before = stateWith({ linesOfCode: 100, totalLinesOfCode: 100 });
  const after = stateWith({
    linesOfCode: 200,
    totalLinesOfCode: 300,
    openSourceProjects: { overReactFramework: 1 },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      clicks: 100,
      ...zeroCounts(),
      openSourceLevelsBought: {
        overReactFramework: 1,
        blocker: 0,
        constellation: 0,
      },
      starClaims: [],
    }),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });
});

test("second junior costs the scaled price, exact money", () => {
  const before = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 100,
    money: 23000,
    employees: { junior: 1 },
    unlockedEmployees: { junior: true },
  });
  const after = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 100,
    money: 0,
    employees: { junior: 2 },
    unlockedEmployees: { junior: true },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      ...zeroActions(),
      employeesBought: { intern: 0, junior: 1, senior: 0 },
    }),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });

  const wrongPrice = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 100,
    money: 1,
    employees: { junior: 2 },
    unlockedEmployees: { junior: true },
  });
  const r2 = validateSave(
    prev(before, T0),
    body(wrongPrice, {
      ...zeroActions(),
      employeesBought: { intern: 0, junior: 1, senior: 0 },
    }),
    T0 + 60_000
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.rule, "MONEY");
});

test("heavy shipping that drains LOC does not false-reject (tick quantization)", () => {
  // Regression test for the Nov 10 live rejection: Brandon bulk-bought
  // employees and shipped a lot of To Do List Apps, draining his LOC,
  // and the save 409'd with LOC "linesOfCode exceeds the maximum
  // earnable". The bulk-buy was not the cause — the failure is the
  // tick quantization in rule 6 (see the tolerance note in validate.js):
  // the client earns passive LOC in whole 1-second ticks, the server
  // credits it continuously by elapsed seconds. In a 49.9s window the
  // client fires 50 ticks (50 * 150 = 7500 LOC) while the server credits
  // 49.9s * 150 = 7485, a 15 LOC excess. Shipping 215 To Do List Apps
  // spends 10750 LOC, so expectedLoc falls to 87 and the old tolerance
  // (max(10, 1% of 87) = 10) could not cover the 15 LOC excess.
  // The tolerance now includes one full tick (150 LOC), so this passes.
  // Numbers: 42 employees (intern 35, junior 5, senior 2), Blocker v1
  // (+0.5 passive) => 100 base * 1.5 = 150 LOC/s; OverReact v3.
  const before = stateWith({
    linesOfCode: 3352,
    totalLinesOfCode: 60000,
    money: 1803000,
    employees: { intern: 35, junior: 5, senior: 2 },
    freelanceProjectsCompleted: {
      toDoListApp: 200,
      hobbyWebsite: 20,
      paradigmShiftingBlockchainProject: 5,
    },
    openSourceProjects: { overReactFramework: 3, blocker: 1 },
    unlockedEmployees: { intern: true, junior: true, senior: true },
    unlockedOpenSourceProjects: { overReactFramework: true, blocker: true },
  });
  const after = stateWith({
    // 3352 + 50 ticks * 150 - 215 ships * 50 LOC = 102.
    linesOfCode: 102,
    // 60000 + 7500 passive LOC.
    totalLinesOfCode: 67500,
    // 1803000 + 215 ships * 3000c.
    money: 2448000,
    employees: { intern: 35, junior: 5, senior: 2 },
    freelanceProjectsCompleted: {
      toDoListApp: 415,
      hobbyWebsite: 20,
      paradigmShiftingBlockchainProject: 5,
    },
    openSourceProjects: { overReactFramework: 3, blocker: 1 },
    unlockedEmployees: { intern: true, junior: true, senior: true },
    unlockedOpenSourceProjects: { overReactFramework: true, blocker: true },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      ...zeroActions(),
      projectsCompleted: {
        toDoListApp: 215,
        hobbyWebsite: 0,
        paradigmShiftingBlockchainProject: 0,
      },
    }),
    T0 + 49_900
  );
  assert.deepEqual(r, { ok: true });
});

/**
 * A star claim with the fields the client sends; overrides win.
 * Each claim gets a distinct claimId (the server-issued outcome id,
 * issue #29). A legit test passes the SAME claim object as the save's
 * claim and as the issued outcome (4th arg to validateSave); a
 * rejection test passes a different (or no) issued outcome.
 */
let claimCounter = 0;
function starClaim(overrides) {
  claimCounter += 1;
  const claimId = `aaaaaaaa-0000-4000-8000-${String(claimCounter).padStart(12, "0")}`;
  return {
    claimId,
    effect: "lucky",
    good: true,
    locDelta: 0,
    moneyDelta: 0,
    multiplier: null,
    durationSeconds: null,
    employeeType: null,
    ...overrides,
  };
}

/** A state with a Constellation level (and optional employees). */
function constellationState(level, overrides = {}) {
  return stateWith({
    openSourceProjects: { constellation: level },
    ...overrides,
  });
}

test("legit star play: lucky LOC gain, lucky money gain, lucky loss all pass", () => {
  // (a) Lucky good, LOC: 1 intern (1 LOC/s), 60s, +35 LOC (20-50x rate).
  const beforeA = constellationState(1, {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    money: 0,
    employees: { intern: 1 },
  });
  const afterA = constellationState(1, {
    linesOfCode: 95, // 60 passive + 35 lucky
    totalLinesOfCode: 95,
    money: 0,
    employees: { intern: 1 },
  });
  // The claim is the outcome the server issued (4th arg); the save
  // carries the identical claim, so it matches.
  const claimA = starClaim({ locDelta: 35 });
  assert.deepEqual(
    validateSave(
      prev(beforeA, T0),
      body(afterA, {
        ...zeroActions(),
        starClaims: [claimA],
      }),
      T0 + 60_000,
      [claimA]
    ),
    { ok: true }
  );

  // (b) Lucky good, money: 100000c on hand, +5000c (5%, within 1-10%).
  const beforeB = constellationState(1, {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    money: 100000,
    employees: { intern: 1 },
  });
  const afterB = constellationState(1, {
    linesOfCode: 60,
    totalLinesOfCode: 60,
    money: 105000,
    employees: { intern: 1 },
  });
  const claimB = starClaim({ moneyDelta: 5000 });
  assert.deepEqual(
    validateSave(
      prev(beforeB, T0),
      body(afterB, {
        ...zeroActions(),
        starClaims: [claimB],
      }),
      T0 + 60_000,
      [claimB]
    ),
    { ok: true }
  );

  // (c) Lucky bad, LOC loss: 500 LOC on hand, -15 LOC (10-25x rate).
  // The loss lowers linesOfCode but not totalLinesOfCode (cumulative).
  const beforeC = constellationState(1, {
    linesOfCode: 500,
    totalLinesOfCode: 500,
    money: 0,
    employees: { intern: 1 },
  });
  const afterC = constellationState(1, {
    linesOfCode: 545, // 500 + 60 passive - 15 loss
    totalLinesOfCode: 560, // 500 + 60 passive
    money: 0,
    employees: { intern: 1 },
  });
  const claimC = starClaim({ good: false, locDelta: -15 });
  assert.deepEqual(
    validateSave(
      prev(beforeC, T0),
      body(afterC, {
        ...zeroActions(),
        starClaims: [claimC],
      }),
      T0 + 60_000,
      [claimC]
    ),
    { ok: true }
  );
});

test("legit star play: frenzy buff boosts passive for its duration", () => {
  // 10 interns (10 LOC/s), Constellation L3, 50s window. A Frenzy x7
  // for 60s claimed at the window start: 10 * 7 * 50 = 3500 LOC.
  // The buff is still active at the save (expires T0+60s).
  const before = constellationState(3, {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    employees: { intern: 10 },
  });
  const after = constellationState(3, {
    linesOfCode: 3500,
    totalLinesOfCode: 3500,
    employees: { intern: 10 },
    activeStarEffects: [
      {
        effect: "frenzy",
        multiplier: 7,
        expiresAtMs: T0 + 60_000,
        employeeType: null,
      },
    ],
  });
  const claim = starClaim({
    effect: "frenzy",
    good: true,
    multiplier: 7,
    durationSeconds: 60,
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      ...zeroActions(),
      starClaims: [claim],
    }),
    T0 + 50_000,
    [claim]
  );
  assert.deepEqual(r, { ok: true });
});

test("legit star play: click buff boosts clicks made while it is live", () => {
  // OverReact L1 (2 LOC/click), Constellation L2, 60s window. A Click
  // x3 for 20s, 40 clicks (all inside the buff): 40 * 2 * 3 = 240 LOC.
  // The buff expired before the save, so activeStarEffects is empty —
  // the claim alone carries the allowance.
  const before = constellationState(2, {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    openSourceProjects: { overReactFramework: 1, constellation: 2 },
  });
  const after = constellationState(2, {
    linesOfCode: 240,
    totalLinesOfCode: 240,
    openSourceProjects: { overReactFramework: 1, constellation: 2 },
    activeStarEffects: [],
  });
  const claim = starClaim({
    effect: "click",
    good: true,
    multiplier: 3,
    durationSeconds: 20,
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      ...zeroActions(),
      clicks: 40,
      starClaims: [claim],
    }),
    T0 + 60_000,
    [claim]
  );
  assert.deepEqual(r, { ok: true });
});

test("legit star play: frenzy and employee buffs multiply (interaction)", () => {
  // Regression: Frenzy and Employee buffs MULTIPLY on the client
  // ((base + employee extra) x frenzy), so the server must credit
  // their interaction, not just add them independently. 10 interns +
  // 1 junior (15 LOC/s base), Constellation L4, 50s window. Frenzy x7
  // and a junior Sprint (2x) both live the whole window:
  // (15 + 5) * 7 * 50 = 7000 LOC. Without the interaction term the
  // server would allow only 5500 and false-reject.
  const before = constellationState(4, {
    linesOfCode: 1000,
    totalLinesOfCode: 1000,
    employees: { intern: 10, junior: 1 },
    unlockedEmployees: { intern: true, junior: true },
  });
  const after = constellationState(4, {
    linesOfCode: 8000,
    totalLinesOfCode: 8000,
    employees: { intern: 10, junior: 1 },
    unlockedEmployees: { intern: true, junior: true },
    activeStarEffects: [
      {
        effect: "frenzy",
        multiplier: 7,
        expiresAtMs: T0 + 60_000,
        employeeType: null,
      },
      {
        effect: "employee",
        multiplier: 2,
        expiresAtMs: T0 + 60_000,
        employeeType: "junior",
      },
    ],
  });
  const frenzyClaim = starClaim({
    effect: "frenzy",
    good: true,
    multiplier: 7,
    durationSeconds: 60,
  });
  const employeeClaim = starClaim({
    effect: "employee",
    good: true,
    multiplier: 2,
    durationSeconds: 60,
    employeeType: "junior",
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      ...zeroActions(),
      starClaims: [frenzyClaim, employeeClaim],
    }),
    T0 + 50_000,
    [frenzyClaim, employeeClaim]
  );
  assert.deepEqual(r, { ok: true });
});

test("legit star play: shooting stars burst", () => {
  // 1 intern (1 LOC/s), 100000c, Constellation L5, 60s window. A
  // Shooting Stars burst worth 5 good Lucky rolls: +100 LOC (max 250)
  // and +8000c (max 50000c).
  const before = constellationState(5, {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    money: 100000,
    employees: { intern: 1 },
  });
  const after = constellationState(5, {
    linesOfCode: 160, // 60 passive + 100 burst
    totalLinesOfCode: 160,
    money: 108000,
    employees: { intern: 1 },
  });
  const claim = starClaim({
    effect: "shootingStars",
    good: true,
    locDelta: 100,
    moneyDelta: 8000,
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      ...zeroActions(),
      starClaims: [claim],
    }),
    T0 + 60_000,
    [claim]
  );
  assert.deepEqual(r, { ok: true });
});

test("buying Constellation levels 4-5 and OverReact level 4 passes validation", () => {
  // Constellation L3 -> L5 costs 75000 + 250000 LOC.
  const beforeC = constellationState(3, {
    linesOfCode: 400000,
    totalLinesOfCode: 400000,
  });
  const afterC = constellationState(5, {
    linesOfCode: 75000,
    totalLinesOfCode: 400000,
  });
  assert.deepEqual(
    validateSave(
      prev(beforeC, T0),
      body(afterC, {
        ...zeroActions(),
        openSourceLevelsBought: {
          overReactFramework: 0,
          blocker: 0,
          constellation: 2,
        },
      }),
      T0 + 60_000
    ),
    { ok: true }
  );

  // OverReact L3 -> L4 costs 15000 LOC.
  const beforeO = stateWith({
    linesOfCode: 20000,
    totalLinesOfCode: 20000,
    openSourceProjects: { overReactFramework: 3 },
  });
  const afterO = stateWith({
    linesOfCode: 5000,
    totalLinesOfCode: 20000,
    openSourceProjects: { overReactFramework: 4 },
  });
  assert.deepEqual(
    validateSave(
      prev(beforeO, T0),
      body(afterO, {
        ...zeroActions(),
        openSourceLevelsBought: {
          overReactFramework: 1,
          blocker: 0,
          constellation: 0,
        },
      }),
      T0 + 60_000
    ),
    { ok: true }
  );
});

test("inflated star claims are rejected", () => {
  const before = constellationState(1, {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    money: 100000,
    employees: { intern: 1 },
  });
  const cases = [
    // Lucky LOC gain far above the 50x rate max (50 LOC at 1 LOC/s).
    starClaim({ locDelta: 1000 }),
    // Lucky money gain above the 10% max (10000c at 100000c).
    starClaim({ moneyDelta: 50000 }),
    // Shooting Stars LOC above the 5x Lucky max (250 LOC at 1 LOC/s).
    starClaim({ effect: "shootingStars", locDelta: 1000 }),
  ];
  for (const claim of cases) {
    const after = constellationState(1, {
      linesOfCode: 1000,
      totalLinesOfCode: 1000,
      money: 100000,
      employees: { intern: 1 },
    });
    const r = validateSave(
      prev(before, T0),
      body(after, { ...zeroActions(), starClaims: [claim] }),
      T0 + 60_000
    );
    assert.equal(r.ok, false);
    assert.equal(r.rule, "STAR");
  }
});

test("star claims for locked effects, at level 0, or beyond the issued outcomes are rejected", () => {
  // Frenzy unlocks at L3; the server never issues it at L1, so a
  // claim for it has no matching issued outcome.
  const beforeL1 = constellationState(1, {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    employees: { intern: 1 },
  });
  const afterL1 = constellationState(1, {
    linesOfCode: 60,
    totalLinesOfCode: 60,
    employees: { intern: 1 },
  });
  const locked = validateSave(
    prev(beforeL1, T0),
    body(afterL1, {
      ...zeroActions(),
      starClaims: [
        starClaim({
          effect: "frenzy",
          multiplier: 7,
          durationSeconds: 60,
        }),
      ],
    }),
    T0 + 60_000
  );
  assert.equal(locked.ok, false);
  assert.equal(locked.rule, "STAR");

  // Level 0 means no stars at all.
  const beforeL0 = constellationState(0, {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    employees: { intern: 1 },
  });
  const afterL0 = constellationState(0, {
    linesOfCode: 60,
    totalLinesOfCode: 60,
    employees: { intern: 1 },
  });
  const levelZero = validateSave(
    prev(beforeL0, T0),
    body(afterL0, {
      ...zeroActions(),
      starClaims: [starClaim({ locDelta: 10 })],
    }),
    T0 + 60_000
  );
  assert.equal(levelZero.ok, false);
  assert.equal(levelZero.rule, "STAR");

  // More claims than issued outcomes: the server issued two stars,
  // the save claims three — the third has no issued outcome to match.
  // (The spawn cap is now enforced at issuance, not here.)
  const issuedA = starClaim({ locDelta: 10 });
  const issuedB = starClaim({ locDelta: 10 });
  const tooMany = validateSave(
    prev(beforeL1, T0),
    body(afterL1, {
      ...zeroActions(),
      starClaims: [issuedA, issuedB, starClaim({ locDelta: 10 })],
    }),
    T0 + 60_000,
    [issuedA, issuedB]
  );
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.rule, "STAR");
});

test("a tampered star claim (same claimId, different content) is rejected", () => {
  // The server issued a valid outcome; the save presents the same
  // claimId with different content. The content must match the issued
  // outcome exactly, so every tamper is a STAR rejection.
  const before = constellationState(3, {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    money: 100000,
    employees: { intern: 1 },
  });
  const after = constellationState(3, {
    linesOfCode: 60,
    totalLinesOfCode: 60,
    money: 100000,
    employees: { intern: 1 },
  });
  const cases = [
    // A Lucky roll gives LOC or cash, never both — the issued claim
    // was LOC-only, the saved claim adds a money gain.
    {
      issued: starClaim({ locDelta: 10 }),
      tamper: (c) => ({ ...c, moneyDelta: 100 }),
    },
    // Frenzy is x7 good / x0.5 bad — the issued claim was x7, the
    // saved claim says x3.
    {
      issued: starClaim({
        effect: "frenzy",
        multiplier: 7,
        durationSeconds: 60,
      }),
      tamper: (c) => ({ ...c, multiplier: 3 }),
    },
    // Click good is an integer x2-5 — the issued claim was x3, the
    // saved claim says x6.
    {
      issued: starClaim({
        effect: "click",
        multiplier: 3,
        durationSeconds: 20,
      }),
      tamper: (c) => ({ ...c, multiplier: 6 }),
    },
  ];
  for (const { issued, tamper } of cases) {
    const saved = tamper(issued);
    const r = validateSave(
      prev(before, T0),
      body(after, { ...zeroActions(), starClaims: [saved] }),
      T0 + 60_000,
      [issued]
    );
    assert.equal(r.ok, false);
    assert.equal(r.rule, "STAR");
  }
});

test("a save from before Constellation (no star fields) still validates", () => {
  // An old client / old stored save has no constellation key, no
  // activeStarEffects, and no starClaims. Normalization defaults them
  // (constellation 0 / unlocked, no buffs, no claims) instead of
  // failing the shape check.
  const before = initialSaveState();
  delete before.openSourceProjects.constellation;
  delete before.unlockedOpenSourceProjects.constellation;
  delete before.activeStarEffects;
  const after = {
    ...initialSaveState(),
    linesOfCode: 50,
    totalLinesOfCode: 50,
  };
  delete after.openSourceProjects.constellation;
  delete after.unlockedOpenSourceProjects.constellation;
  delete after.activeStarEffects;
  const actions = {
    clicks: 50,
    employeesBought: { intern: 0, junior: 0, senior: 0 },
    projectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    openSourceLevelsBought: { overReactFramework: 0, blocker: 0 },
  };
  const r = validateSave(prev(before, T0), body(after, actions), T0 + 60_000);
  assert.deepEqual(r, { ok: true });
});
