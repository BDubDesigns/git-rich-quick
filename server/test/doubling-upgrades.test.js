/**
 * Tests for the doubling upgrades (issue #118): one leveled GitNub
 * project per employee type, 10 levels each, each level doubling that
 * type's output. Cost curve is 2x per level (Brandon, Nov 15) — this
 * supersedes the Nov 11 10x lock: 10x makes the high click levels
 * unreachable (Commitment Issues L5 would cost 10B, over a month of
 * passive at 3,660 LOC/s) while 1.15x maxes everything in about 1.5
 * hours. At 2x, maxing one track costs about 1B LOC (around 3 days
 * at 3,660/s) and maxing all six is about 16 days of passive.
 *
 * Key numbers: CoffeeScript (Intern, 100k), Junior Achievement
 * (Junior, 250k), Senior Moment (Senior, 500k), Scrum Master
 * (Project Manager, 1M), Commitment Issues (Commit Specialist, 1M),
 * Ship Happens (Release Manager, 2M). Unlock: own 10 of that type.
 * Click formula is floor((base + 0.2 x CS) x (1 + clickBonus)): at
 * OverReact L5 the multiplier is 32, so 9 Commit Specialists give
 * 89 at Commitment Issues L0, 492 at L3, 1875 at L5.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave } from "../src/validate.js";
import {
  BALANCE,
  DOUBLING_PROJECT_EMPLOYEE,
  DOUBLING_PROJECT_IDS,
  OPEN_SOURCE_DISPLAY_NAMES,
  OPEN_SOURCE_IDS,
  baseLocPerSecond,
  doublingMultiplier,
  effectiveEmployeeMultiplier,
  initialSaveState,
  locPerClick,
  locPerSecond,
  normalizeActions,
  normalizeSaveState,
  openSourceLevelCosts,
  openSourceUnlockConditionsMet,
  projectManagerBoostFraction,
  releaseManagerShipsPerInterval,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";

/** Flat open-source levels with every project at 0. */
function zeroLevels(overrides = {}) {
  const levels = {};
  for (const id of OPEN_SOURCE_IDS) levels[id] = 0;
  return { ...levels, ...overrides };
}

function counts(overrides = {}) {
  return {
    intern: 0,
    junior: 0,
    senior: 0,
    projectManager: 0,
    commitSpecialist: 0,
    releaseManager: 0,
    ...overrides,
  };
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

function zeroActions() {
  return {
    clicks: 0,
    employeesBought: counts(),
    projectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
      aiPoweredDashboard: 0,
      nftMarketplace: 0,
      metaverseRealEstate: 0,
      quantumToDoList: 0,
    },
    autoShips: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
      aiPoweredDashboard: 0,
      nftMarketplace: 0,
      metaverseRealEstate: 0,
      quantumToDoList: 0,
    },
    openSourceLevelsBought: zeroLevels(),
  };
}

function prev(state, savedAtMs) {
  return { state, savedAtMs };
}

function body(state, actions) {
  return { playerId: PLAYER_ID, state, actionsSinceLastSave: actions };
}

test("config: six doubling projects, 2x power per level, unlock at 10 of that type", () => {
  assert.deepEqual(DOUBLING_PROJECT_IDS, [
    "coffeeScript",
    "juniorAchievement",
    "seniorMoment",
    "scrumMaster",
    "commitmentIssues",
    "shipHappens",
  ]);
  assert.deepEqual(DOUBLING_PROJECT_EMPLOYEE, {
    coffeeScript: "intern",
    juniorAchievement: "junior",
    seniorMoment: "senior",
    scrumMaster: "projectManager",
    commitmentIssues: "commitSpecialist",
    shipHappens: "releaseManager",
  });
  for (const id of DOUBLING_PROJECT_IDS) {
    assert.ok(OPEN_SOURCE_IDS.includes(id), id);
    // Commitment Issues has 20 levels (issue #151); the five passive
    // tracks keep 10.
    assert.equal(
      BALANCE.openSource[id].levels.length,
      id === "commitmentIssues" ? 20 : 10,
      id
    );
    assert.deepEqual(
      BALANCE.openSource[id].unlockConditions,
      [
        {
          type: "SPECIFIC_EMPLOYEE_COUNT",
          employeeType: DOUBLING_PROJECT_EMPLOYEE[id],
          target: 10,
        },
      ],
      id
    );
    for (let i = 0; i < BALANCE.openSource[id].levels.length; i += 1) {
      assert.deepEqual(
        BALANCE.openSource[id].levels[i].bonus,
        { type: "DOUBLE", value: 2 },
        `${id} L${i + 1}`
      );
    }
    assert.ok(OPEN_SOURCE_DISPLAY_NAMES[id], id);
  }
  // Cost curve is 2x per level: base x 2^(level-1).
  assert.equal(BALANCE.openSource.coffeeScript.levels[0].locCost, 100000);
  assert.equal(BALANCE.openSource.coffeeScript.levels[1].locCost, 200000);
  assert.equal(BALANCE.openSource.coffeeScript.levels[9].locCost, 51200000);
  assert.equal(
    BALANCE.openSource.juniorAchievement.levels[0].locCost,
    250000
  );
  assert.equal(BALANCE.openSource.seniorMoment.levels[0].locCost, 500000);
  assert.equal(BALANCE.openSource.scrumMaster.levels[0].locCost, 1000000);
  assert.equal(
    BALANCE.openSource.commitmentIssues.levels[0].locCost,
    1000000
  );
  assert.equal(BALANCE.openSource.shipHappens.levels[0].locCost, 2000000);
  // Total to max a passive track is base x (2^10 - 1) = base x 1023.
  assert.equal(openSourceLevelCosts("coffeeScript", 0, 10), 102300000);
  assert.equal(openSourceLevelCosts("scrumMaster", 0, 10), 1023000000);
  assert.equal(openSourceLevelCosts("coffeeScript", 0, 3), 700000);
  // The five passive tracks are untouched by issue #151: 2x cost steps.
  for (const id of DOUBLING_PROJECT_IDS.filter((x) => x !== "commitmentIssues")) {
    const levels = BALANCE.openSource[id].levels;
    for (let i = 1; i < levels.length; i += 1) {
      assert.equal(levels[i].locCost, levels[i - 1].locCost * 2, `${id} L${i + 1}`);
    }
  }
});

test("Commitment Issues (issue #151): 20 levels, old ten costs kept, a sqrt(2) step between", () => {
  const costs = BALANCE.openSource.commitmentIssues.levels.map((l) => l.locCost);
  assert.deepEqual(costs, [
    1000000, 1410000, 2000000, 2830000, 4000000, 5660000, 8000000,
    11310000, 16000000, 22630000, 32000000, 45250000, 64000000, 90510000,
    128000000, 181020000, 256000000, 362040000, 512000000, 724080000,
  ]);
  // Every old cost (1M x 2^k, k = 0..9) is still a level: the new
  // levels sit in between, they do not replace the old ones.
  for (let k = 0; k < 10; k += 1) assert.equal(costs[2 * k], 1000000 * 2 ** k);
  // Cost grows slower than the 2x power: about 1.41x per level.
  for (let i = 1; i < costs.length; i += 1) {
    const step = costs[i] / costs[i - 1];
    assert.ok(step > 1.4 && step < 1.42, `L${i + 1} step ${step}`);
  }
  assert.equal(openSourceLevelCosts("commitmentIssues", 0, 20), 2469740000);
  assert.equal(doublingMultiplier("commitSpecialist", { commitmentIssues: 20 }), 2 ** 20);
});

test("doublingMultiplier: 2^level per type, 1 at level 0 or missing", () => {
  assert.equal(doublingMultiplier("intern", {}), 1);
  assert.equal(doublingMultiplier("intern", zeroLevels()), 1);
  assert.equal(doublingMultiplier("intern", { coffeeScript: 1 }), 2);
  assert.equal(doublingMultiplier("intern", { coffeeScript: 3 }), 8);
  assert.equal(doublingMultiplier("intern", { coffeeScript: 10 }), 1024);
  // Per-type independence: leveling one track does not double another.
  assert.equal(
    doublingMultiplier("junior", { coffeeScript: 10 }),
    1
  );
  assert.equal(
    doublingMultiplier("junior", { juniorAchievement: 2 }),
    4
  );
  assert.equal(
    doublingMultiplier("commitSpecialist", { commitmentIssues: 5 }),
    32
  );
  assert.equal(
    doublingMultiplier("projectManager", { scrumMaster: 10 }),
    1024
  );
  assert.equal(
    doublingMultiplier("releaseManager", { shipHappens: 3 }),
    8
  );
  // Unknown employee type (or no doubling project) is 1x.
  assert.equal(doublingMultiplier("noPilot", { coffeeScript: 10 }), 1);
  assert.equal(doublingMultiplier("intern", undefined), 1);
});

test("clicks: Commitment Issues doubles the per-specialist bonus each level", () => {
  const overReactMax = zeroLevels({ overReactFramework: 9 });
  const nineCS = counts({ commitSpecialist: 9 });
  // OverReact L9 is a 128x click (issue #151).
  // No Commitment Issues: floor((1 + 0.2 x 9) x 128) = floor(358.4) = 358.
  assert.equal(locPerClick(overReactMax, nineCS), 358);
  // L3: 0.2 x 9 x 8 = 14.4, floor((1 + 14.4) x 128) = floor(1971.2) = 1971.
  assert.equal(
    locPerClick(zeroLevels({ overReactFramework: 9, commitmentIssues: 3 }), nineCS),
    1971
  );
  // L5: 0.2 x 9 x 32 = 57.6, floor((1 + 57.6) x 128) = floor(7500.8) = 7500.
  assert.equal(
    locPerClick(zeroLevels({ overReactFramework: 9, commitmentIssues: 5 }), nineCS),
    7500
  );
  // L10: 0.2 x 9 x 1024 = 1843.2, floor((1 + 1843.2) x 128) = 236057.
  assert.equal(
    locPerClick(zeroLevels({ overReactFramework: 9, commitmentIssues: 10 }), nineCS),
    236057
  );
  // L20: 0.2 x 9 x 2^20 = 1887436.8, floor((1 + 1887436.8) x 128).
  assert.equal(
    locPerClick(zeroLevels({ overReactFramework: 9, commitmentIssues: 20 }), nineCS),
    241592038
  );
  // Without OverReact the doubling still applies to the raw bonus.
  assert.equal(locPerClick(zeroLevels({ commitmentIssues: 1 }), nineCS), 4);
});

test("passive: CoffeeScript / Junior Achievement / Senior Moment double their type", () => {
  assert.equal(baseLocPerSecond(counts({ intern: 10 }), zeroLevels()), 10);
  assert.equal(
    baseLocPerSecond(counts({ intern: 10 }), { coffeeScript: 1 }),
    20
  );
  assert.equal(
    baseLocPerSecond(counts({ intern: 10 }), { coffeeScript: 3 }),
    80
  );
  assert.equal(
    baseLocPerSecond(counts({ junior: 10 }), { juniorAchievement: 2 }),
    200
  );
  assert.equal(
    baseLocPerSecond(counts({ senior: 5 }), { seniorMoment: 1 }),
    200
  );
  // locPerSecond floors the final total, same as before.
  assert.equal(
    locPerSecond(counts({ intern: 10 }), { coffeeScript: 1 }),
    20
  );
  assert.equal(
    locPerSecond(
      counts({ intern: 10, junior: 5 }),
      { coffeeScript: 2, juniorAchievement: 1 }
    ),
    90
  );
});

test("Scrum Master doubles the per-manager passive boost each level", () => {
  assert.equal(projectManagerBoostFraction(counts({ projectManager: 1 })), 0.01);
  assert.equal(
    projectManagerBoostFraction(counts({ projectManager: 1 }), 1, {
      scrumMaster: 1,
    }),
    0.02
  );
  assert.equal(
    projectManagerBoostFraction(counts({ projectManager: 2 }), 1, {
      scrumMaster: 3,
    }),
    0.16
  );
  assert.equal(
    projectManagerBoostFraction(counts({ projectManager: 1 }), 1, {
      scrumMaster: 10,
    }),
    10.24
  );
  // The boost flows into the passive rate: 100 interns + 1 PM is
  // floor(100 x 1.01) = 101 at L0, floor(100 x 1.02) = 102 at L1.
  assert.equal(
    locPerSecond(counts({ intern: 100, projectManager: 1 }), zeroLevels()),
    101
  );
  assert.equal(
    locPerSecond(
      counts({ intern: 100, projectManager: 1 }),
      { scrumMaster: 1 }
    ),
    102
  );
  // CoffeeScript and Scrum Master multiply: 100 interns doubled to
  // 200, then the L1 boost is floor(200 x 1.02) = 204.
  assert.equal(
    locPerSecond(
      counts({ intern: 100, projectManager: 1 }),
      { coffeeScript: 1, scrumMaster: 1 }
    ),
    204
  );
});

test("Ship Happens doubles ships per manager per interval", () => {
  assert.equal(releaseManagerShipsPerInterval({}), 1);
  assert.equal(releaseManagerShipsPerInterval(zeroLevels()), 1);
  assert.equal(releaseManagerShipsPerInterval({ shipHappens: 1 }), 2);
  assert.equal(releaseManagerShipsPerInterval({ shipHappens: 3 }), 8);
  assert.equal(releaseManagerShipsPerInterval({ shipHappens: 10 }), 1024);
});

test("effectiveEmployeeMultiplier includes the doubling project", () => {
  // No buffs, no managers: an Intern with CoffeeScript L1 reads 2x.
  assert.equal(
    effectiveEmployeeMultiplier([], "intern", T0, null, { coffeeScript: 1 }),
    2
  );
  assert.equal(
    effectiveEmployeeMultiplier([], "intern", T0, null, { coffeeScript: 2 }),
    4
  );
  // With a Project Manager owned, the PM boost multiplies with the
  // doubling: (1 + 0.01) x 2 = 2.02.
  assert.equal(
    effectiveEmployeeMultiplier(
      [],
      "intern",
      T0,
      counts({ projectManager: 1 }),
      { coffeeScript: 1 }
    ),
    2.02
  );
  // No doubling project: unchanged from before (1x, or just the PM boost).
  assert.equal(
    effectiveEmployeeMultiplier([], "senior", T0, null, zeroLevels()),
    1
  );
  assert.equal(
    effectiveEmployeeMultiplier(
      [],
      "senior",
      T0,
      counts({ projectManager: 1 }),
      zeroLevels()
    ),
    1.01
  );
});

test("unlock: each doubling project needs 10 of its employee type", () => {
  for (const id of DOUBLING_PROJECT_IDS) {
    const type = DOUBLING_PROJECT_EMPLOYEE[id];
    assert.equal(
      openSourceUnlockConditionsMet(id, {
        totalLinesOfCode: 0,
        employees: counts({ [type]: 9 }),
      }),
      false,
      `${id} at 9`
    );
    assert.equal(
      openSourceUnlockConditionsMet(id, {
        totalLinesOfCode: 0,
        employees: counts({ [type]: 10 }),
      }),
      true,
      `${id} at 10`
    );
  }
});

test("fresh saves include the six new keys and validate", () => {
  const fresh = initialSaveState();
  for (const id of DOUBLING_PROJECT_IDS) {
    assert.equal(fresh.openSourceProjects[id], 0, id);
    assert.equal(fresh.unlockedOpenSourceProjects[id], false, id);
  }
  const r = validateSave(
    prev(initialSaveState(), T0),
    body(fresh, zeroActions()),
    T0 + 60_000
  );
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("a doubling project above level 10 is a shape rejection", () => {
  const after = stateWith({
    openSourceProjects: { coffeeScript: 11 },
  });
  const r = validateSave(
    prev(initialSaveState(), T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "SHAPE");
  assert.match(r.detail, /0-10/);
});

test("old saves and old actions missing the six keys still validate (normalized)", () => {
  const old = initialSaveState();
  for (const id of DOUBLING_PROJECT_IDS) {
    delete old.openSourceProjects[id];
    delete old.unlockedOpenSourceProjects[id];
  }
  const normalized = normalizeSaveState(old);
  for (const id of DOUBLING_PROJECT_IDS) {
    assert.equal(normalized.openSourceProjects[id], 0, id);
    assert.equal(normalized.unlockedOpenSourceProjects[id], false, id);
  }
  // A veteran save that predates the doubling upgrades (no latch
  // keys) gets the CoffeeScript latch from its own employee counts.
  const veteranOld = stateWith({ employees: { intern: 10 } });
  for (const id of DOUBLING_PROJECT_IDS) {
    delete veteranOld.unlockedOpenSourceProjects[id];
  }
  const veteran = normalizeSaveState(veteranOld);
  assert.equal(veteran.unlockedOpenSourceProjects.coffeeScript, true);
  assert.equal(veteran.unlockedOpenSourceProjects.juniorAchievement, false);
  // A current save (all latch keys present) is unchanged by normalize:
  // existing latches are trusted, only missing ones are filled.
  const current = stateWith({ employees: { intern: 10 } });
  assert.deepEqual(normalizeSaveState(current), current);
  // The old state itself validates end to end.
  const r = validateSave(
    prev(initialSaveState(), T0),
    body(old, zeroActions()),
    T0 + 60_000
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  // Old actions missing the six level-delta keys are backfilled too.
  const oldActions = zeroActions();
  for (const id of DOUBLING_PROJECT_IDS) {
    delete oldActions.openSourceLevelsBought[id];
  }
  const normalizedActions = normalizeActions(oldActions);
  for (const id of DOUBLING_PROJECT_IDS) {
    assert.equal(normalizedActions.openSourceLevelsBought[id], 0, id);
  }
});
