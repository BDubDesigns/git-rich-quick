/**
 * Tests for the two new employee types (Project Manager and Commit
 * Specialist): the passive boost and the click bonus, the floor on the
 * final totals (Brandon: a click/tick must never commit a fractional
 * amount), the Sprint/Meeting scaling for the new types, the unlock
 * conditions, and hire/cost validation. Pure function tests (no
 * database) except where noted — same style as validate.test.js.
 *
 * Key numbers: both cost 500000c base, x1.2 per hire. A Project
 * Manager adds +1% to ALL employee passive LOC. A Commit Specialist
 * adds +0.2 LOC to each manual click, and the bonus gets the same
 * OverReact click boost as the base manual click; the FINAL click
 * total is floored (10 specialists = +2, 15 = +3, 25 = +5 at no
 * OverReact). Project Manager unlocks at TOTAL_LOC >= 50000 AND 25
 * employees; Commit Specialist at TOTAL_LOC >= 25000 AND 20 employees.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave } from "../src/validate.js";
import {
  BALANCE,
  clickBonus,
  commitSpecialistClickBonus,
  deriveUnlockedCosmetics,
  effectiveEmployeeMultiplier,
  employeeBuffTypeRate,
  employeeCost,
  employeeUnlockConditionsMet,
  initialSaveState,
  locPerClick,
  locPerSecond,
  normalizeSaveState,
  projectManagerBoostFraction,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
let claimCounter = 0;

const OPEN_SOURCE_ZERO = {
  overReactFramework: 0,
  blocker: 0,
  constellation: 0,
  starBroker: 0,
};

function counts(overrides = {}) {
  return {
    intern: 0,
    junior: 0,
    senior: 0,
    projectManager: 0,
    commitSpecialist: 0,
    ...overrides,
  };
}

function zeroCounts() {
  return {
    employeesBought: counts(),
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

/** A star claim the server issued (4th arg to validateSave). */
function starClaim(overrides) {
  claimCounter += 1;
  const claimId = `bbbbbbbb-0000-4000-8000-${String(claimCounter).padStart(12, "0")}`;
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

/**
 * A state with a Constellation level. Same helper as validate.test.js:
 * a player who owns Constellation levels necessarily met the
 * TOTAL_LOC >= 500 unlock (L1 costs 1000 LOC), so the fixture carries
 * a realistic lifetime-LOC base of 1000 on top of the test's own value.
 */
function constellationState(level, overrides = {}) {
  const state = stateWith({
    openSourceProjects: { constellation: level },
    ...overrides,
  });
  if (level > 0) {
    state.totalLinesOfCode += 1000;
  }
  return state;
}

test("both new types cost 500000c base at x1.2 (same cost, different names)", () => {
  assert.equal(BALANCE.employees.projectManager.baseCost, 500000);
  assert.equal(BALANCE.employees.commitSpecialist.baseCost, 500000);
  assert.equal(BALANCE.employees.projectManager.costMultiplier, 1.2);
  assert.equal(BALANCE.employees.commitSpecialist.costMultiplier, 1.2);
  assert.equal(employeeCost("projectManager", 0), 500000);
  assert.equal(employeeCost("commitSpecialist", 0), 500000);
  // Second hire: round(500000 * 1.2) = 600000.
  assert.equal(employeeCost("projectManager", 1), 600000);
  assert.equal(employeeCost("commitSpecialist", 1), 600000);
});

test("Project Manager: each adds +1% to ALL employee passive LOC (floored final rate)", () => {
  // 10 interns + 5 managers: 10 x 1.05 = 10.5, floored to 10.
  assert.equal(
    locPerSecond(counts({ intern: 10, projectManager: 5 }), OPEN_SOURCE_ZERO),
    10
  );
  // 100 interns + 5 managers: 100 x 1.05 = 105 (no floor loss).
  assert.equal(
    locPerSecond(counts({ intern: 100, projectManager: 5 }), OPEN_SOURCE_ZERO),
    105
  );
  // No managers: unchanged.
  assert.equal(
    locPerSecond(counts({ intern: 10 }), OPEN_SOURCE_ZERO),
    10
  );
  // Managers alone produce nothing (their locPerSecond is 0).
  assert.equal(
    locPerSecond(counts({ projectManager: 5 }), OPEN_SOURCE_ZERO),
    0
  );
  // The boost fraction itself: 5 managers = 0.05.
  assert.equal(projectManagerBoostFraction(counts({ projectManager: 5 })), 0.05);
  // A 5x Sprint on managers makes each give +5% (0.25 total).
  assert.equal(
    projectManagerBoostFraction(counts({ projectManager: 5 }), 5),
    0.25
  );
  // A Meeting halves it (+0.5% per manager).
  assert.equal(
    projectManagerBoostFraction(counts({ projectManager: 5 }), 0.5),
    0.025
  );
});

test("passive floor also floors a pre-existing fractional Blocker rate", () => {
  // 3 interns at Blocker L1: 3 x 1.5 = 4.5, floored to 4. The floor
  // is on the final rate, not on any one component, so it catches
  // the Blocker fraction too — at most 1 LOC/s is lost.
  assert.equal(
    locPerSecond(counts({ intern: 3 }), { ...OPEN_SOURCE_ZERO, blocker: 1 }),
    4
  );
});

test("Commit Specialist: the RAW bonus is +0.2 per specialist (no floor here)", () => {
  assert.equal(commitSpecialistClickBonus(counts({ commitSpecialist: 15 })), 3);
  assert.equal(commitSpecialistClickBonus(counts({ commitSpecialist: 25 })), 5);
  assert.equal(commitSpecialistClickBonus(counts({ commitSpecialist: 0 })), 0);
  // A 5x Sprint makes each specialist give +1.0 per click.
  assert.equal(
    commitSpecialistClickBonus(counts({ commitSpecialist: 15 }), 5),
    15
  );
  // A Meeting halves it (+0.1 per specialist).
  assert.equal(
    commitSpecialistClickBonus(counts({ commitSpecialist: 15 }), 0.5),
    1.5
  );
});

test("click total is floored (Brandon: never commit 5093.1, always 5093)", () => {
  // Base click 1 + the raw bonus, floored as a total: 10 -> +2,
  // 15 -> +3 (floor of 3), 25 -> +5, 30 -> +6.
  assert.equal(locPerClick(OPEN_SOURCE_ZERO, counts({ commitSpecialist: 10 })), 3);
  assert.equal(locPerClick(OPEN_SOURCE_ZERO, counts({ commitSpecialist: 15 })), 4);
  assert.equal(locPerClick(OPEN_SOURCE_ZERO, counts({ commitSpecialist: 25 })), 6);
  assert.equal(locPerClick(OPEN_SOURCE_ZERO, counts({ commitSpecialist: 30 })), 7);
  assert.equal(locPerClick(OPEN_SOURCE_ZERO, counts()), 1);
  // A 5x Sprint on 15 specialists: floor(1 + 15) = 16.
  assert.equal(
    locPerClick(OPEN_SOURCE_ZERO, counts({ commitSpecialist: 15 }), 5),
    16
  );
  // OverReact L1 (+1 click) boosts the Commit Specialist bonus too:
  // the bonus is part of the click, not a flat add-on, so the total
  // is floor((1 + 3) x 2) = 8. Without the scaling it would be
  // floor(1 x 2 + 3) = 5.
  assert.equal(
    locPerClick(
      { ...OPEN_SOURCE_ZERO, overReactFramework: 1 },
      counts({ commitSpecialist: 15 })
    ),
    8
  );
  // The floored Sprint delta is exact: floor(8.6) - floor(4.8) = 4.
  // (19 specialists at 2x vs 1x.) The server's allowance uses this
  // difference, so it credits exactly what the client earns.
  assert.equal(
    locPerClick(OPEN_SOURCE_ZERO, counts({ commitSpecialist: 19 }), 2) -
      locPerClick(OPEN_SOURCE_ZERO, counts({ commitSpecialist: 19 })),
    4
  );
});

test("effectiveEmployeeMultiplier includes the Project Manager boost", () => {
  // 5 managers: every type's multiplier carries x1.05 even with no
  // star buff live — so a card tints green whenever managers are
  // owned (the boost is permanent, not a star effect).
  assert.equal(
    effectiveEmployeeMultiplier([], "senior", T0, counts({ projectManager: 5 })),
    1.05
  );
  // It multiplies with a Frenzy buff, like the production math.
  assert.equal(
    effectiveEmployeeMultiplier(
      [{ effect: "frenzy", multiplier: 2, expiresAtMs: T0 + 60_000 }],
      "senior",
      T0,
      counts({ projectManager: 5 })
    ),
    2.1
  );
  // Without counts the multiplier is the star-buff-only value
  // (backward compatible with the old 3-arg callers).
  assert.equal(effectiveEmployeeMultiplier([], "senior", T0), 1);
});

test("employeeBuffTypeRate: PM is the boost, CS is zero, normal types carry the boost", () => {
  // 10 interns + 5 managers: the boost contributes 0.05 x 10 = 0.5.
  assert.equal(
    employeeBuffTypeRate(
      "projectManager",
      counts({ intern: 10, projectManager: 5 }),
      OPEN_SOURCE_ZERO
    ),
    0.5
  );
  // A Commit Specialist contributes nothing to passive LOC.
  assert.equal(
    employeeBuffTypeRate(
      "commitSpecialist",
      counts({ commitSpecialist: 10 }),
      OPEN_SOURCE_ZERO
    ),
    0
  );
  // A senior with 5 managers: 20 x 1.05 = 21 (the boost scales the
  // type's contribution, so a Sprint on seniors scales the boosted
  // rate, not the base rate).
  assert.equal(
    employeeBuffTypeRate(
      "senior",
      counts({ senior: 1, projectManager: 5 }),
      OPEN_SOURCE_ZERO
    ),
    21
  );
});

test("unlock conditions: later than senior, both thresholds required", () => {
  const fresh = initialSaveState();
  assert.equal(employeeUnlockConditionsMet("projectManager", fresh), false);
  assert.equal(employeeUnlockConditionsMet("commitSpecialist", fresh), false);

  // Project Manager: TOTAL_LOC >= 50000 AND 25 employees.
  assert.equal(
    employeeUnlockConditionsMet(
      "projectManager",
      stateWith({
        totalLinesOfCode: 50000,
        employees: { intern: 20, projectManager: 5 },
      })
    ),
    true
  );
  assert.equal(
    employeeUnlockConditionsMet(
      "projectManager",
      stateWith({
        totalLinesOfCode: 49999,
        employees: { intern: 20, projectManager: 5 },
      })
    ),
    false
  );
  assert.equal(
    employeeUnlockConditionsMet(
      "projectManager",
      stateWith({
        totalLinesOfCode: 50000,
        employees: { intern: 24 },
      })
    ),
    false
  );

  // Commit Specialist: TOTAL_LOC >= 25000 AND 20 employees.
  assert.equal(
    employeeUnlockConditionsMet(
      "commitSpecialist",
      stateWith({
        totalLinesOfCode: 25000,
        employees: { intern: 20 },
      })
    ),
    true
  );
  assert.equal(
    employeeUnlockConditionsMet(
      "commitSpecialist",
      stateWith({
        totalLinesOfCode: 25000,
        employees: { intern: 19 },
      })
    ),
    false
  );
});

test("old saves migrate: missing PM/CS keys default to 0, latches derive from the save", () => {
  const old = initialSaveState();
  delete old.employees.projectManager;
  delete old.employees.commitSpecialist;
  delete old.unlockedEmployees.projectManager;
  delete old.unlockedEmployees.commitSpecialist;
  const migrated = normalizeSaveState(old);
  assert.equal(migrated.employees.projectManager, 0);
  assert.equal(migrated.employees.commitSpecialist, 0);
  // A fresh save meets neither condition, so both latches derive false.
  assert.equal(migrated.unlockedEmployees.projectManager, false);
  assert.equal(migrated.unlockedEmployees.commitSpecialist, false);

  // A veteran who already meets a condition gets it unlocked on load.
  const veteran = initialSaveState();
  veteran.totalLinesOfCode = 60000;
  veteran.employees = counts({ intern: 20, projectManager: 5 });
  delete veteran.unlockedEmployees.projectManager;
  delete veteran.unlockedEmployees.commitSpecialist;
  const migratedVeteran = normalizeSaveState(veteran);
  assert.equal(migratedVeteran.unlockedEmployees.projectManager, true);
  assert.equal(migratedVeteran.unlockedEmployees.commitSpecialist, true);
});

test("cosmetics: one per new tier at 25 hires", () => {
  assert.deepEqual(
    deriveUnlockedCosmetics(stateWith({ employees: { projectManager: 25 } })),
    ["projectManager-icon-platinum"]
  );
  assert.deepEqual(
    deriveUnlockedCosmetics(
      stateWith({ employees: { commitSpecialist: 25 } })
    ),
    ["commitSpecialist-icon-diamond"]
  );
  // Below the trigger, nothing unlocks.
  assert.deepEqual(
    deriveUnlockedCosmetics(
      stateWith({ employees: { projectManager: 24, commitSpecialist: 24 } })
    ),
    []
  );
});

test("hire validation: a Project Manager hire at exactly 500000c passes, short money fails", () => {
  const before = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 60000,
    money: 500000,
    employees: { intern: 25 },
    unlockedEmployees: { projectManager: true },
  });
  const after = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 60000,
    money: 0,
    employees: { intern: 25, projectManager: 1 },
    unlockedEmployees: { projectManager: true },
  });
  const ok = validateSave(
    prev(before, T0),
    body(after, {
      ...zeroActions(),
      employeesBought: counts({ projectManager: 1 }),
    }),
    T0 + 60_000
  );
  assert.deepEqual(ok, { ok: true });

  const broke = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 60000,
    money: 499999,
    employees: { intern: 25 },
    unlockedEmployees: { projectManager: true },
  });
  const r = validateSave(
    prev(broke, T0),
    body(after, {
      ...zeroActions(),
      employeesBought: counts({ projectManager: 1 }),
    }),
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "MONEY");
});

test("hire validation: a Commit Specialist hire at exactly 500000c passes", () => {
  const before = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 30000,
    money: 500000,
    employees: { intern: 20 },
    unlockedEmployees: { commitSpecialist: true },
  });
  const after = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 30000,
    money: 0,
    employees: { intern: 20, commitSpecialist: 1 },
    unlockedEmployees: { commitSpecialist: true },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      ...zeroActions(),
      employeesBought: counts({ commitSpecialist: 1 }),
    }),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });
});

test("Brandon's live case: 9 Commit Specialists with OverReact L5 is not eaten by the floor", () => {
  // Brandon, Nov 10 (playerId 0c3781c2-d611-441e-b5df-e04330c8223e):
  // 9 Commit Specialists, OverReact L5 (cumulative click bonus +31),
  // click showed +32. The old math floored (1 x 32 + 0.9) = 32.9 to
  // 32, so all 9 specialists gave him 0 extra LOC — he would have
  // needed 10 just to see +1. With the 0.2 rate AND the OverReact
  // scaling, the bonus is part of the click: floor((1 + 1.8) x 32)
  // = floor(89.6) = 89. (Unscaled, 0.2 alone would give
  // floor(32 + 1.8) = 33; the scaling is what makes the bonus
  // match the manual click's GitNub boost.)
  const overReact5 = { ...OPEN_SOURCE_ZERO, overReactFramework: 5 };
  assert.equal(clickBonus(overReact5), 31);
  assert.equal(
    locPerClick(overReact5, counts({ commitSpecialist: 9 })),
    89
  );
  // Sanity: the old 0.1 rate really was invisible here.
  assert.equal(
    Math.floor(1 * (1 + 31) + 0.1 * 9),
    32
  );
});

test("click credit: 25 Commit Specialists make each click worth 6 LOC", () => {
  const before = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 30000,
    money: 0,
    employees: { intern: 20, commitSpecialist: 25 },
    unlockedEmployees: { commitSpecialist: true },
  });
  // 10 clicks x 6 LOC = 60, plus 20 interns x 1 LOC/s x 60s = 1200
  // passive. (The interns are there for the CS unlock's 20-employee
  // condition; their passive is part of the expected gain.)
  const after = stateWith({
    linesOfCode: 1260,
    totalLinesOfCode: 31260,
    money: 0,
    employees: { intern: 20, commitSpecialist: 25 },
    unlockedEmployees: { commitSpecialist: true },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, { ...zeroActions(), clicks: 10 }),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });

  // Claiming 2000 LOC from those 10 clicks exceeds the max
  // (60 click + 1200 passive + tolerance) and is rejected.
  const greedy = stateWith({
    linesOfCode: 2000,
    totalLinesOfCode: 32000,
    money: 0,
    employees: { intern: 20, commitSpecialist: 25 },
    unlockedEmployees: { commitSpecialist: true },
  });
  const r2 = validateSave(
    prev(before, T0),
    body(greedy, { ...zeroActions(), clicks: 10 }),
    T0 + 60_000
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.rule, "LOC");
});

test("legit play: OverReact boosts the Commit Specialist bonus", () => {
  // 10 interns + 10 specialists (20 employees, TOTAL_LOC 25000 —
  // the CS unlock is met), OverReact L1 already owned, 60s window.
  // Each click is floor((1 + 2) x 2) = 6, not the unscaled
  // floor(1 x 2 + 2) = 4: the CS bonus gets the same OverReact boost
  // as the base manual click. 10 clicks x 6 = 60, plus 10 interns
  // x 60s = 600 passive. Total 660. Without the scaling the server
  // would allow only 600 + 40 + tolerance and false-reject.
  const before = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 25000,
    money: 0,
    employees: { intern: 10, commitSpecialist: 10 },
    unlockedEmployees: { commitSpecialist: true },
    openSourceProjects: { overReactFramework: 1 },
  });
  const after = stateWith({
    linesOfCode: 660,
    totalLinesOfCode: 25660,
    money: 0,
    employees: { intern: 10, commitSpecialist: 10 },
    unlockedEmployees: { commitSpecialist: true },
    openSourceProjects: { overReactFramework: 1 },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, { ...zeroActions(), clicks: 10 }),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });

  // Claiming 2000 LOC from those 10 clicks exceeds the max
  // (60 click + 600 passive + tolerance) and is rejected.
  const greedy = stateWith({
    linesOfCode: 2000,
    totalLinesOfCode: 27000,
    money: 0,
    employees: { intern: 10, commitSpecialist: 10 },
    unlockedEmployees: { commitSpecialist: true },
    openSourceProjects: { overReactFramework: 1 },
  });
  const r2 = validateSave(
    prev(before, T0),
    body(greedy, { ...zeroActions(), clicks: 10 }),
    T0 + 60_000
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.rule, "LOC");
});

test("legit star play: a Sprint on Project Managers scales the boost", () => {
  // 20 interns + 5 managers (25 employees, TOTAL_LOC 60000 — the PM
  // unlock is met), Constellation L4, 50s window. Base passive is
  // floor(20 x 1.05) = 21/s, so 1050 over the window. The Sprint (5x)
  // scales the boost contribution (0.05 x 20 = 1/s) by 4 extra, so
  // 4 x 50 = 200 more. Total 1250. Without the allowance the server
  // would allow only 1050 + tolerance and false-reject.
  const before = constellationState(4, {
    linesOfCode: 0,
    totalLinesOfCode: 60000,
    money: 0,
    employees: { intern: 20, projectManager: 5 },
    unlockedEmployees: { projectManager: true },
  });
  const after = constellationState(4, {
    linesOfCode: 1250,
    totalLinesOfCode: 61250,
    money: 0,
    employees: { intern: 20, projectManager: 5 },
    unlockedEmployees: { projectManager: true },
    activeStarEffects: [
      {
        effect: "employee",
        multiplier: 5,
        expiresAtMs: T0 + 60_000,
        employeeType: "projectManager",
      },
    ],
  });
  const claim = starClaim({
    effect: "employee",
    good: true,
    multiplier: 5,
    durationSeconds: 60,
    employeeType: "projectManager",
  });
  const r = validateSave(
    prev(before, T0),
    body(after, { ...zeroActions(), starClaims: [claim] }),
    T0 + 50_000,
    [claim]
  );
  assert.deepEqual(r, { ok: true });
});

test("legit play: Brandon's 9 Commit Specialists with OverReact L5 earn 89 LOC per click", () => {
  // Same live case as the unit test above, end to end through the
  // server: 11 interns + 9 specialists (20 employees, TOTAL_LOC
  // 100000 — the CS unlock is met), OverReact L5 already owned, 60s
  // window. 10 clicks x 89 = 890, plus 11 interns x 60s = 660
  // passive. Total 1550. The server's allowance must cover the
  // boosted clicks, or the save false-rejects like the old client
  // math did to Brandon.
  const before = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 100000,
    money: 0,
    employees: { intern: 11, commitSpecialist: 9 },
    unlockedEmployees: { commitSpecialist: true },
    openSourceProjects: { overReactFramework: 5 },
  });
  const after = stateWith({
    linesOfCode: 1550,
    totalLinesOfCode: 101550,
    money: 0,
    employees: { intern: 11, commitSpecialist: 9 },
    unlockedEmployees: { commitSpecialist: true },
    openSourceProjects: { overReactFramework: 5 },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, { ...zeroActions(), clicks: 10 }),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });
});

test("legit star play: a Sprint on Commit Specialists scales the click bonus", () => {
  // 5 interns + 15 specialists (20 employees, TOTAL_LOC 30000 — the
  // CS unlock is met), Constellation L4, 50s window. Base click is
  // floor(1 + 3) = 4; with the 5x Sprint it is floor(1 + 15) = 16.
  // 40 clicks x 16 = 640, plus 5 interns x 50s = 250 passive. Total
  // 890. Without the allowance the server would allow only
  // 250 + 160 = 410 + tolerance and false-reject.
  const before = constellationState(4, {
    linesOfCode: 0,
    totalLinesOfCode: 30000,
    money: 0,
    employees: { intern: 5, commitSpecialist: 15 },
    unlockedEmployees: { commitSpecialist: true },
  });
  const after = constellationState(4, {
    linesOfCode: 890,
    totalLinesOfCode: 30890,
    money: 0,
    employees: { intern: 5, commitSpecialist: 15 },
    unlockedEmployees: { commitSpecialist: true },
    activeStarEffects: [
      {
        effect: "employee",
        multiplier: 5,
        expiresAtMs: T0 + 60_000,
        employeeType: "commitSpecialist",
      },
    ],
  });
  const claim = starClaim({
    effect: "employee",
    good: true,
    multiplier: 5,
    durationSeconds: 60,
    employeeType: "commitSpecialist",
  });
  const r = validateSave(
    prev(before, T0),
    body(after, { ...zeroActions(), clicks: 40, starClaims: [claim] }),
    T0 + 50_000,
    [claim]
  );
  assert.deepEqual(r, { ok: true });
});

test("legit star play: Click buff x Commit Specialist Sprint multiply (interaction)", () => {
  // Same setup as the CS Sprint test, plus a Click x3 for 20s. All 40
  // clicks land inside both buffs: each click is floor(1 + 15) x 3
  // = 48, so 1920 click LOC + 250 passive = 2170. Without the
  // interaction term the server would allow only 250 + 160 + 320 +
  // 480 = 1210 and false-reject.
  const before = constellationState(4, {
    linesOfCode: 0,
    totalLinesOfCode: 30000,
    money: 0,
    employees: { intern: 5, commitSpecialist: 15 },
    unlockedEmployees: { commitSpecialist: true },
  });
  const after = constellationState(4, {
    linesOfCode: 2170,
    totalLinesOfCode: 32170,
    money: 0,
    employees: { intern: 5, commitSpecialist: 15 },
    unlockedEmployees: { commitSpecialist: true },
    activeStarEffects: [
      {
        effect: "employee",
        multiplier: 5,
        expiresAtMs: T0 + 60_000,
        employeeType: "commitSpecialist",
      },
    ],
  });
  const csClaim = starClaim({
    effect: "employee",
    good: true,
    multiplier: 5,
    durationSeconds: 60,
    employeeType: "commitSpecialist",
  });
  const clickClaim = starClaim({
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
      starClaims: [csClaim, clickClaim],
    }),
    T0 + 50_000,
    [csClaim, clickClaim]
  );
  assert.deepEqual(r, { ok: true });
});

test("legit star play: a Meeting on Commit Specialists does not false-reject", () => {
  // A Meeting (0.5x) makes clicks earn LESS than the base credit, so
  // the base credit already covers it — the server adds no negative
  // allowance for it (subtracting could under-credit clicks made
  // outside the Meeting). 40 clicks during the Meeting earn
  // floor(1 + 1.5) = 2 each: 80 click LOC + 250 passive = 330.
  const before = constellationState(4, {
    linesOfCode: 0,
    totalLinesOfCode: 30000,
    money: 0,
    employees: { intern: 5, commitSpecialist: 15 },
    unlockedEmployees: { commitSpecialist: true },
  });
  const after = constellationState(4, {
    linesOfCode: 330,
    totalLinesOfCode: 30330,
    money: 0,
    employees: { intern: 5, commitSpecialist: 15 },
    unlockedEmployees: { commitSpecialist: true },
    activeStarEffects: [
      {
        effect: "employee",
        multiplier: 0.5,
        expiresAtMs: T0 + 60_000,
        employeeType: "commitSpecialist",
      },
    ],
  });
  const claim = starClaim({
    effect: "employee",
    good: false,
    multiplier: 0.5,
    durationSeconds: 30,
    employeeType: "commitSpecialist",
  });
  const r = validateSave(
    prev(before, T0),
    body(after, { ...zeroActions(), clicks: 40, starClaims: [claim] }),
    T0 + 50_000,
    [claim]
  );
  assert.deepEqual(r, { ok: true });
});
