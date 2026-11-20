/**
 * Tests for the track upgrades (issue #118, retuned by Funding Rounds
 * in issue #170): one leveled GitNub project per employee type.
 *
 * - CoffeeScript (Intern, 100K), Junior Achievement (Junior, 250K),
 *   Senior Moment (Senior, 500K): 21 levels, 1.4x output per level,
 *   cost x2.5 per level rounded to 3 significant figures.
 * - Scrum Master (Project Manager, 1M): 20 levels, LINEAR, cost x2:
 *   the per-manager boost is 1% x (1 + level).
 * - Commitment Issues (Commit Specialist, 460K): 16 levels at the
 *   #160 prices, 2x per level.
 * - Ship Happens (Release Manager, 2M): unchanged, 10 levels at 2x.
 * Unlock: own 10 of that type. The Funding Rounds caps are covered in
 * funding-rounds.test.js. Click formula is
 * floor((base + 0.2 x CS) x (1 + clickBonus)).
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

/** Float-tolerant equality for the 1.4x products. */
function near(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)),
    `expected ${expected}, got ${actual}`
  );
}

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

test("config: six track projects, per-track power and length (issue #170), unlock at 10 of that type", () => {
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
  const expected = {
    coffeeScript: { length: 21, bonus: { type: "MULTIPLY", value: 1.4 } },
    juniorAchievement: { length: 21, bonus: { type: "MULTIPLY", value: 1.4 } },
    seniorMoment: { length: 21, bonus: { type: "MULTIPLY", value: 1.4 } },
    scrumMaster: { length: 20, bonus: { type: "LINEAR", value: 1 } },
    commitmentIssues: { length: 16, bonus: { type: "MULTIPLY", value: 2 } },
    shipHappens: { length: 10, bonus: { type: "MULTIPLY", value: 2 } },
  };
  for (const id of DOUBLING_PROJECT_IDS) {
    assert.ok(OPEN_SOURCE_IDS.includes(id), id);
    assert.equal(BALANCE.openSource[id].levels.length, expected[id].length, id);
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
        expected[id].bonus,
        `${id} L${i + 1}`
      );
    }
    assert.ok(OPEN_SOURCE_DISPLAY_NAMES[id], id);
  }
  // Base costs are unchanged.
  assert.equal(BALANCE.openSource.coffeeScript.levels[0].locCost, 100000);
  assert.equal(BALANCE.openSource.juniorAchievement.levels[0].locCost, 250000);
  assert.equal(BALANCE.openSource.seniorMoment.levels[0].locCost, 500000);
  assert.equal(BALANCE.openSource.scrumMaster.levels[0].locCost, 1000000);
  assert.equal(BALANCE.openSource.commitmentIssues.levels[0].locCost, 460000);
  assert.equal(BALANCE.openSource.shipHappens.levels[0].locCost, 2000000);
  // The Senior Moment cost line from the build spec (issue #170).
  const senior = (level) => BALANCE.openSource.seniorMoment.levels[level - 1].locCost;
  assert.equal(senior(6), 48_800_000);
  assert.equal(senior(9), 763_000_000);
  assert.equal(senior(12), 11_900_000_000);
  assert.equal(senior(15), 186_000_000_000);
  assert.equal(senior(18), 2_910_000_000_000);
  assert.equal(senior(21), 45_500_000_000_000);
  // The passive tracks step 2.5x (within the 3-figure rounding), and
  // every price is a whole number of LOC.
  for (const id of ["coffeeScript", "juniorAchievement", "seniorMoment"]) {
    const levels = BALANCE.openSource[id].levels;
    for (let i = 1; i < levels.length; i += 1) {
      const step = levels[i].locCost / levels[i - 1].locCost;
      assert.ok(Math.abs(step - 2.5) < 0.02, `${id} L${i + 1} step ${step}`);
      assert.ok(Number.isInteger(levels[i].locCost), `${id} L${i + 1}`);
    }
  }
  // Scrum Master and Ship Happens keep exact 2x cost steps.
  for (const id of ["scrumMaster", "shipHappens"]) {
    const levels = BALANCE.openSource[id].levels;
    for (let i = 1; i < levels.length; i += 1) {
      assert.equal(levels[i].locCost, levels[i - 1].locCost * 2, `${id} L${i + 1}`);
    }
  }
  // Ship Happens is untouched: base x (2^10 - 1) to max.
  assert.equal(openSourceLevelCosts("shipHappens", 0, 10), 2_046_000_000);
  assert.equal(BALANCE.openSource.scrumMaster.levels[19].locCost, 524_288_000_000);
});

test("Commitment Issues (issues #160, #170): 16 levels at the derived costs, every step at least 2x", () => {
  const costs = BALANCE.openSource.commitmentIssues.levels.map((l) => l.locCost);
  assert.deepEqual(costs, [
    460_000, 1_300_000, 3_300_000, 8_000_000, 19_000_000, 43_000_000,
    96_000_000, 210_000_000, 470_000_000, 1_000_000_000, 2_200_000_000,
    4_700_000_000, 10_000_000_000, 21_000_000_000, 45_000_000_000,
    95_000_000_000,
  ]);
  // The cost never steps slower than the 2x power (the #151 sqrt(2)
  // step is what let clicking run away).
  for (let i = 1; i < costs.length; i += 1) {
    const step = costs[i] / costs[i - 1];
    assert.ok(step >= 2 && step < 3, `L${i + 1} step ${step}`);
  }
  assert.equal(doublingMultiplier("commitSpecialist", { commitmentIssues: 16 }), 2 ** 16);
  // Levels 17 to 20 are gone: a level past the end clamps to 16.
  assert.equal(doublingMultiplier("commitSpecialist", { commitmentIssues: 20 }), 2 ** 16);
});

test("doublingMultiplier: 1.4^L passive, 1 + L Scrum Master, 2^L click and ships; 1 at level 0 or missing", () => {
  assert.equal(doublingMultiplier("intern", {}), 1);
  assert.equal(doublingMultiplier("intern", zeroLevels()), 1);
  near(doublingMultiplier("intern", { coffeeScript: 1 }), 1.4);
  near(doublingMultiplier("intern", { coffeeScript: 3 }), 2.744);
  // The round caps' multipliers (issue #170 section 4).
  near(doublingMultiplier("senior", { seniorMoment: 6 }), 7.529536);
  near(doublingMultiplier("senior", { seniorMoment: 21 }), 1.4 ** 21);
  assert.equal(Math.round(doublingMultiplier("senior", { seniorMoment: 21 })), 1171);
  // Per-type independence: leveling one track does not touch another.
  assert.equal(doublingMultiplier("junior", { coffeeScript: 10 }), 1);
  near(doublingMultiplier("junior", { juniorAchievement: 2 }), 1.96);
  assert.equal(doublingMultiplier("commitSpecialist", { commitmentIssues: 5 }), 32);
  // Scrum Master is linear: 1 + level.
  assert.equal(doublingMultiplier("projectManager", { scrumMaster: 1 }), 2);
  assert.equal(doublingMultiplier("projectManager", { scrumMaster: 10 }), 11);
  assert.equal(doublingMultiplier("projectManager", { scrumMaster: 20 }), 21);
  assert.equal(doublingMultiplier("releaseManager", { shipHappens: 3 }), 8);
  // Unknown employee type (or no track project) is 1x.
  assert.equal(doublingMultiplier("noPilot", { coffeeScript: 10 }), 1);
  assert.equal(doublingMultiplier("intern", undefined), 1);
  // NaN, negative, fractional and past-the-end levels are guarded.
  assert.equal(doublingMultiplier("intern", { coffeeScript: Number.NaN }), 1);
  assert.equal(doublingMultiplier("intern", { coffeeScript: -3 }), 1);
  near(doublingMultiplier("intern", { coffeeScript: 1.9 }), 1.4);
  near(doublingMultiplier("intern", { coffeeScript: 99 }), 1.4 ** 21);
});

test("clicks: Commitment Issues doubles the per-specialist bonus each level", () => {
  const overReactMax = zeroLevels({ overReactFramework: 10 });
  const nineCS = counts({ commitSpecialist: 9 });
  // OverReact L10 is a 40x click (issue #160).
  // No Commitment Issues: floor((1 + 0.2 x 9) x 40) = 112.
  assert.equal(locPerClick(overReactMax, nineCS), 112);
  // L3: 0.2 x 9 x 8 = 14.4, floor((1 + 14.4) x 40) = 616.
  assert.equal(
    locPerClick(zeroLevels({ overReactFramework: 10, commitmentIssues: 3 }), nineCS),
    616
  );
  // L5: 0.2 x 9 x 32 = 57.6, floor((1 + 57.6) x 40) = 2344.
  assert.equal(
    locPerClick(zeroLevels({ overReactFramework: 10, commitmentIssues: 5 }), nineCS),
    2344
  );
  // L10: 0.2 x 9 x 1024 = 1843.2, floor((1 + 1843.2) x 40) = 73768.
  assert.equal(
    locPerClick(zeroLevels({ overReactFramework: 10, commitmentIssues: 10 }), nineCS),
    73768
  );
  // L16 (the top since issue #170): 0.2 x 9 x 2^16 = 117964.8,
  // floor((1 + 117964.8) x 40) = 4718632.
  assert.equal(
    locPerClick(zeroLevels({ overReactFramework: 10, commitmentIssues: 16 }), nineCS),
    4718632
  );
  // Without OverReact the doubling still applies to the raw bonus.
  assert.equal(locPerClick(zeroLevels({ commitmentIssues: 1 }), nineCS), 4);
});

test("passive: CoffeeScript / Junior Achievement / Senior Moment multiply their type by 1.4 per level", () => {
  assert.equal(baseLocPerSecond(counts({ intern: 10 }), zeroLevels()), 10);
  near(baseLocPerSecond(counts({ intern: 10 }), { coffeeScript: 1 }), 14);
  near(baseLocPerSecond(counts({ intern: 10 }), { coffeeScript: 3 }), 27.44);
  near(baseLocPerSecond(counts({ junior: 10 }), { juniorAchievement: 2 }), 98);
  near(baseLocPerSecond(counts({ senior: 5 }), { seniorMoment: 1 }), 140);
  // locPerSecond floors the final total, same as before.
  assert.equal(locPerSecond(counts({ intern: 10 }), { coffeeScript: 1 }), 14);
  // 10 x 1.96 + 25 x 1.4 = 54.6, floored to 54.
  assert.equal(
    locPerSecond(
      counts({ intern: 10, junior: 5 }),
      { coffeeScript: 2, juniorAchievement: 1 }
    ),
    54
  );
});

test("Scrum Master raises the per-manager passive boost linearly: 1% x (1 + level) (issue #170)", () => {
  assert.equal(projectManagerBoostFraction(counts({ projectManager: 1 })), 0.01);
  near(
    projectManagerBoostFraction(counts({ projectManager: 1 }), 1, { scrumMaster: 1 }),
    0.02
  );
  near(
    projectManagerBoostFraction(counts({ projectManager: 2 }), 1, { scrumMaster: 3 }),
    0.08
  );
  near(
    projectManagerBoostFraction(counts({ projectManager: 1 }), 1, { scrumMaster: 10 }),
    0.11
  );
  // The round caps: 6% Bootstrapped (L5) to 21% at IPO (L20).
  near(
    projectManagerBoostFraction(counts({ projectManager: 1 }), 1, { scrumMaster: 5 }),
    0.06
  );
  near(
    projectManagerBoostFraction(counts({ projectManager: 1 }), 1, { scrumMaster: 20 }),
    0.21
  );
  // The boost flows into the passive rate: 100 interns + 1 PM is
  // floor(100 x 1.01) = 101 at L0, floor(100 x 1.02) = 102 at L1.
  assert.equal(
    locPerSecond(counts({ intern: 100, projectManager: 1 }), zeroLevels()),
    101
  );
  assert.equal(
    locPerSecond(counts({ intern: 100, projectManager: 1 }), { scrumMaster: 1 }),
    102
  );
  // CoffeeScript and Scrum Master multiply: 100 interns at 1.4x is
  // 140, then the L1 boost is floor(140 x 1.02) = 142.
  assert.equal(
    locPerSecond(
      counts({ intern: 100, projectManager: 1 }),
      { coffeeScript: 1, scrumMaster: 1 }
    ),
    142
  );
});

test("Ship Happens doubles ships per manager per interval", () => {
  assert.equal(releaseManagerShipsPerInterval({}), 1);
  assert.equal(releaseManagerShipsPerInterval(zeroLevels()), 1);
  assert.equal(releaseManagerShipsPerInterval({ shipHappens: 1 }), 2);
  assert.equal(releaseManagerShipsPerInterval({ shipHappens: 3 }), 8);
  assert.equal(releaseManagerShipsPerInterval({ shipHappens: 10 }), 1024);
});

test("effectiveEmployeeMultiplier includes the track project", () => {
  // No buffs, no managers: an Intern with CoffeeScript L1 reads 1.4x.
  near(effectiveEmployeeMultiplier([], "intern", T0, null, { coffeeScript: 1 }), 1.4);
  near(effectiveEmployeeMultiplier([], "intern", T0, null, { coffeeScript: 2 }), 1.96);
  // With a Project Manager owned, the PM boost multiplies with the
  // track: (1 + 0.01) x 1.4 = 1.414.
  near(
    effectiveEmployeeMultiplier(
      [],
      "intern",
      T0,
      counts({ projectManager: 1 }),
      { coffeeScript: 1 }
    ),
    1.414
  );
  // No track project: unchanged from before (1x, or just the PM boost).
  assert.equal(effectiveEmployeeMultiplier([], "senior", T0, null, zeroLevels()), 1);
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

test("a track above its Bootstrapped cap is a shape rejection (issue #170)", () => {
  // Bootstrapped, CoffeeScript caps at 6 (the full track is 21).
  const after = stateWith({
    openSourceProjects: { coffeeScript: 7 },
  });
  const r = validateSave(
    prev(initialSaveState(), T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "SHAPE");
  assert.match(r.detail, /0-6/);
  // Ship Happens is gated since issue #192: Bootstrapped caps it at 1.
  const ship = stateWith({ openSourceProjects: { shipHappens: 1 } });
  const ok = validateSave(
    prev(initialSaveState(), T0),
    body(ship, zeroActions()),
    T0 + 60_000
  );
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const overShip = stateWith({ openSourceProjects: { shipHappens: 2 } });
  const over = validateSave(
    prev(initialSaveState(), T0),
    body(overShip, zeroActions()),
    T0 + 60_000
  );
  assert.equal(over.ok, false);
  assert.equal(over.rule, "SHAPE");
  assert.match(over.detail, /0-1/);
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
