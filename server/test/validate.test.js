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
    openSourceLevelsBought: { overReactFramework: 0, blocker: 0 },
  };
}

function zeroActions() {
  return { clicks: 0, ...zeroCounts() };
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
  });
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

test("shape violations: NoPilot, level 4, unknown keys, bad types", () => {
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
      openSourceProjects: { overReactFramework: 4 },
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

test("a save within 30s of the last one is rate-limited", () => {
  const r = validateSave(
    prev(initialSaveState(), T0),
    body(initialSaveState(), zeroActions()),
    T0 + 10_000
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
      openSourceLevelsBought: { overReactFramework: 1, blocker: 0 },
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
