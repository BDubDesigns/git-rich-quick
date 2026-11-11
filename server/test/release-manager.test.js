/**
 * Tests for the Release Manager employee (auto-ships freelance
 * projects): the config (cost, unlock, ship interval, cosmetic), the
 * assignment state, the auto-ship accounting (LOC/money/deltas), the
 * server rate cap (one ship per manager per interval), and the
 * old-save backfill. Pure function tests (no database) — same style
 * as two-new-employees.test.js.
 *
 * Key numbers: base cost 500000c, x1.2 per hire. Unlocks at
 * TOTAL_LOC >= 100000 AND 30 employees. One ship per assigned manager
 * per 1s, only if the player has enough LOC for that project's cost
 * at that moment. A ship follows the same rules as a manual ship
 * (LOC deducted, money credited, shipped count up); the auto-ship
 * count is reported in actions.autoShips and rate-capped by the
 * server, so a hacked client cannot claim ships faster than the
 * interval allows.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave } from "../src/validate.js";
import {
  BALANCE,
  RELEASE_MANAGER_CONFIG,
  canEquipCosmetic,
  cosmeticTriggerMet,
  deriveUnlockedCosmetics,
  employeeCost,
  employeeUnlockConditionsMet,
  findCosmetic,
  initialSaveState,
  maxReleaseManagerShips,
  normalizeSaveState,
  normalizeStarActions,
  releaseManagerAssignedCount,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";

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
    releaseManager: 0,
    ...overrides,
  };
}

function projectCounts(overrides = {}) {
  return {
    toDoListApp: 0,
    hobbyWebsite: 0,
    paradigmShiftingBlockchainProject: 0,
    aiPoweredDashboard: 0,
    nftMarketplace: 0,
    metaverseRealEstate: 0,
    quantumToDoList: 0,
    ...overrides,
  };
}

function zeroActions(overrides = {}) {
  return {
    clicks: 0,
    employeesBought: counts(),
    projectsCompleted: projectCounts(),
    autoShips: projectCounts(),
    openSourceLevelsBought: { ...OPEN_SOURCE_ZERO },
    starClaims: [],
    farmBreedClaims: [],
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

function prev(state, savedAtMs) {
  return { state, savedAtMs };
}

function body(state, actions) {
  return { playerId: PLAYER_ID, state, actionsSinceLastSave: actions };
}

/**
 * A state that meets the Release Manager unlock (TOTAL_LOC >= 100000
 * AND 30 employees), with zero passive LOC/s (only Project Managers,
 * Commit Specialists, and Release Managers — all 0 LOC/s), so the LOC
 * accounting in the window is exact with no passive earnings to track.
 * `rmCount` is the Release Manager count; the other 30 - rmCount
 * employees are split between Project Managers and Commit Specialists.
 */
function rmUnlockedState(rmCount, overrides = {}) {
  const others = 30 - rmCount;
  const pm = Math.ceil(others / 2);
  const cs = others - pm;
  return stateWith({
    totalLinesOfCode: 100000,
    linesOfCode: 1000,
    money: 0,
    employees: counts({
      projectManager: pm,
      commitSpecialist: cs,
      releaseManager: rmCount,
    }),
    unlockedEmployees: {
      intern: true,
      junior: true,
      senior: true,
      projectManager: true,
      commitSpecialist: true,
      releaseManager: true,
    },
    ...overrides,
  });
}

test("Release Manager costs 500000c base at x1.2 (same as PM and CS)", () => {
  assert.equal(BALANCE.employees.releaseManager.baseCost, 500000);
  assert.equal(BALANCE.employees.releaseManager.costMultiplier, 1.2);
  assert.equal(employeeCost("releaseManager", 0), 500000);
  // Second hire: round(500000 * 1.2) = 600000.
  assert.equal(employeeCost("releaseManager", 1), 600000);
  // A Release Manager contributes nothing to passive LOC or clicks.
  assert.equal(BALANCE.employees.releaseManager.locPerSecond, 0);
  assert.equal(
    BALANCE.employees.releaseManager.clickBonusPerEmployee,
    undefined
  );
});

test("Release Manager unlocks at TOTAL_LOC >= 100000 AND 30 employees", () => {
  const unlocked = rmUnlockedState(1);
  assert.equal(employeeUnlockConditionsMet("releaseManager", unlocked), true);
  // Below the LOC threshold: locked.
  assert.equal(
    employeeUnlockConditionsMet(
      "releaseManager",
      stateWith({ totalLinesOfCode: 99999, employees: counts({ projectManager: 30 }) })
    ),
    false
  );
  // Below the employee threshold: locked (29 employees, 100000 LOC).
  assert.equal(
    employeeUnlockConditionsMet(
      "releaseManager",
      stateWith({
        totalLinesOfCode: 100000,
        employees: counts({ projectManager: 15, commitSpecialist: 14 }),
      })
    ),
    false
  );
});

test("ship interval is 1s; the rate cap is one ship per manager per interval plus one grace", () => {
  assert.equal(RELEASE_MANAGER_CONFIG.shipIntervalSeconds, 1);
  // 1 manager, 60s window: floor(60/1) + 1 = 61 (the grace covers a
  // ship event landing exactly on a window boundary).
  assert.equal(maxReleaseManagerShips(1, 60), 61);
  // 1 manager, 30s window: floor(30/1) + 1 = 31.
  assert.equal(maxReleaseManagerShips(1, 30), 31);
  // 1 manager, 0s window: 1 (the grace ship — a window can straddle
  // one ship event even when it is short).
  assert.equal(maxReleaseManagerShips(1, 0), 1);
  // 2 managers, 120s: 2 x (120 + 1) = 242.
  assert.equal(maxReleaseManagerShips(2, 120), 242);
  // No managers: no ships.
  assert.equal(maxReleaseManagerShips(0, 600), 0);
});

test("releaseManagerAssignedCount sums the per-project assignments", () => {
  assert.equal(
    releaseManagerAssignedCount(projectCounts({ toDoListApp: 2, hobbyWebsite: 1 })),
    3
  );
  assert.equal(releaseManagerAssignedCount(projectCounts()), 0);
  assert.equal(releaseManagerAssignedCount(null), 0);
});

test("initial state has empty assignments and zero auto-ships; old saves backfill", () => {
  const fresh = initialSaveState();
  assert.deepEqual(fresh.releaseManagerAssignments, projectCounts());
  assert.deepEqual(fresh.autoShipsCompleted, projectCounts());
  assert.equal(fresh.employees.releaseManager, 0);
  assert.equal(fresh.unlockedEmployees.releaseManager, false);

  // A save from before the Release Manager shipped lacks the new
  // fields entirely. normalizeSaveState backfills them to all-zero
  // (no manager assigned, none shipped) instead of failing the shape
  // check, and the employee keys too.
  const old = initialSaveState();
  delete old.releaseManagerAssignments;
  delete old.autoShipsCompleted;
  delete old.employees.releaseManager;
  delete old.unlockedEmployees.releaseManager;
  const normalized = normalizeSaveState(old);
  assert.deepEqual(normalized.releaseManagerAssignments, projectCounts());
  assert.deepEqual(normalized.autoShipsCompleted, projectCounts());
  assert.equal(normalized.employees.releaseManager, 0);
  assert.equal(normalized.unlockedEmployees.releaseManager, false);

  // An old client's actions lack autoShips; normalizeStarActions
  // backfills it to all-zero.
  const oldActions = zeroActions();
  delete oldActions.autoShips;
  assert.deepEqual(normalizeStarActions(oldActions).autoShips, projectCounts());
});

test("hiring a Release Manager is accepted (money deducted, count up)", () => {
  const prevState = rmUnlockedState(0, { money: 600000 });
  const newState = stateWith({
    totalLinesOfCode: 100000,
    linesOfCode: 1000,
    money: 100000,
    employees: counts({ projectManager: 15, commitSpecialist: 15, releaseManager: 1 }),
    unlockedEmployees: {
      intern: true,
      junior: true,
      senior: true,
      projectManager: true,
      commitSpecialist: true,
      releaseManager: true,
    },
  });
  const result = validateSave(
    prev(prevState, T0),
    body(newState, zeroActions({ employeesBought: counts({ releaseManager: 1 }) })),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("assigning a manager to a project is accepted (no money or LOC moves)", () => {
  const prevState = rmUnlockedState(1);
  const newState = rmUnlockedState(1, {
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
  });
  const result = validateSave(
    prev(prevState, T0),
    body(newState, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("assigning more managers than owned is rejected (RELEASE_MANAGER)", () => {
  const prevState = rmUnlockedState(1);
  const newState = rmUnlockedState(1, {
    releaseManagerAssignments: projectCounts({ toDoListApp: 2 }),
  });
  const result = validateSave(
    prev(prevState, T0),
    body(newState, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "RELEASE_MANAGER");
});

test("one auto-ship is accepted (LOC spent, money paid, counts up, auto-ship recorded)", () => {
  // 1 manager, 60s window, 1 auto-ship of the To Do List App
  // (50 LOC -> 3000c). The rate cap allows 61, so 1 is inside it.
  const prevState = rmUnlockedState(1, {
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
  });
  const newState = rmUnlockedState(1, {
    linesOfCode: 950,
    money: 3000,
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
    freelanceProjectsCompleted: projectCounts({ toDoListApp: 1 }),
    autoShipsCompleted: projectCounts({ toDoListApp: 1 }),
  });
  const result = validateSave(
    prev(prevState, T0),
    body(
      newState,
      zeroActions({
        projectsCompleted: projectCounts({ toDoListApp: 1 }),
        autoShips: projectCounts({ toDoListApp: 1 }),
      })
    ),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("auto-ships past the rate cap are rejected (RELEASE_MANAGER)", () => {
  // 1 manager, 11s window: the cap is 12 (one per second plus the
  // grace). Claiming 13 auto-ships is faster than the interval allows.
  // (11s, not 10s, so the window sits safely past the 10s save rate
  // limit.)
  const prevState = rmUnlockedState(1, {
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
  });
  const newState = rmUnlockedState(1, {
    linesOfCode: 350,
    money: 39000,
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
    freelanceProjectsCompleted: projectCounts({ toDoListApp: 13 }),
    autoShipsCompleted: projectCounts({ toDoListApp: 13 }),
  });
  const result = validateSave(
    prev(prevState, T0),
    body(
      newState,
      zeroActions({
        projectsCompleted: projectCounts({ toDoListApp: 13 }),
        autoShips: projectCounts({ toDoListApp: 13 }),
      })
    ),
    T0 + 11_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "RELEASE_MANAGER");

  // Same manager, 60s window: the cap is 61. Claiming 62 is too fast.
  // The player needs enough LOC for 62 ships (62 x 50 = 3100), so the
  // previous state holds 10000 LOC.
  const richPrev = rmUnlockedState(1, {
    linesOfCode: 10000,
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
  });
  const richState = rmUnlockedState(1, {
    linesOfCode: 6900,
    money: 186000,
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
    freelanceProjectsCompleted: projectCounts({ toDoListApp: 62 }),
    autoShipsCompleted: projectCounts({ toDoListApp: 62 }),
  });
  const richResult = validateSave(
    prev(richPrev, T0),
    body(
      richState,
      zeroActions({
        projectsCompleted: projectCounts({ toDoListApp: 62 }),
        autoShips: projectCounts({ toDoListApp: 62 }),
      })
    ),
    T0 + 60_000
  );
  assert.equal(richResult.ok, false);
  assert.equal(richResult.rule, "RELEASE_MANAGER");
});

test("auto-ships must be a subset of completions (RELEASE_MANAGER)", () => {
  // The client claims 1 auto-ship but 0 completions: the auto-ship
  // count exceeds the completions it is a subset of.
  const prevState = rmUnlockedState(1, {
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
  });
  const newState = rmUnlockedState(1, {
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
    autoShipsCompleted: projectCounts({ toDoListApp: 1 }),
  });
  const result = validateSave(
    prev(prevState, T0),
    body(
      newState,
      zeroActions({ autoShips: projectCounts({ toDoListApp: 1 }) })
    ),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "RELEASE_MANAGER");
});

test("an auto-ship for a locked project is rejected (RELEASE_MANAGER)", () => {
  // The Hobby Website is locked (latch false, conditions unmet: it
  // needs 50 To Do List Apps shipped). A manager cannot auto-ship it.
  const prevState = rmUnlockedState(1, {
    releaseManagerAssignments: projectCounts({ hobbyWebsite: 1 }),
    unlockedFreelanceProjects: {
      toDoListApp: true,
      hobbyWebsite: false,
      paradigmShiftingBlockchainProject: false,
      aiPoweredDashboard: false,
      nftMarketplace: false,
      metaverseRealEstate: false,
      quantumToDoList: false,
    },
  });
  const newState = rmUnlockedState(1, {
    linesOfCode: 250,
    money: 36000,
    releaseManagerAssignments: projectCounts({ hobbyWebsite: 1 }),
    freelanceProjectsCompleted: projectCounts({ hobbyWebsite: 1 }),
    autoShipsCompleted: projectCounts({ hobbyWebsite: 1 }),
    unlockedFreelanceProjects: {
      toDoListApp: true,
      hobbyWebsite: false,
      paradigmShiftingBlockchainProject: false,
      aiPoweredDashboard: false,
      nftMarketplace: false,
      metaverseRealEstate: false,
      quantumToDoList: false,
    },
  });
  const result = validateSave(
    prev(prevState, T0),
    body(
      newState,
      zeroActions({
        projectsCompleted: projectCounts({ hobbyWebsite: 1 }),
        autoShips: projectCounts({ hobbyWebsite: 1 }),
      })
    ),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "RELEASE_MANAGER");
});

test("the auto-ship delta must match the claimed auto-ships (DELTA)", () => {
  // The cumulative auto-ship count went up by 1, but the actions claim
  // 0 auto-ships: the delta disagrees with the claim.
  const prevState = rmUnlockedState(1, {
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
  });
  const newState = rmUnlockedState(1, {
    linesOfCode: 950,
    money: 3000,
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
    freelanceProjectsCompleted: projectCounts({ toDoListApp: 1 }),
    autoShipsCompleted: projectCounts({ toDoListApp: 1 }),
  });
  const result = validateSave(
    prev(prevState, T0),
    body(
      newState,
      zeroActions({
        projectsCompleted: projectCounts({ toDoListApp: 1 }),
        autoShips: projectCounts(),
      })
    ),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "DELTA");
});

test("an auto-ship the player cannot afford is rejected (LOC)", () => {
  // The player has 40 LOC and claims an auto-ship of the To Do List
  // App (50 LOC). The LOC rule catches the overspend: the expected
  // LOC goes below what the player claims to hold.
  const prevState = rmUnlockedState(1, {
    linesOfCode: 40,
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
  });
  const newState = rmUnlockedState(1, {
    linesOfCode: 40,
    money: 3000,
    releaseManagerAssignments: projectCounts({ toDoListApp: 1 }),
    freelanceProjectsCompleted: projectCounts({ toDoListApp: 1 }),
    autoShipsCompleted: projectCounts({ toDoListApp: 1 }),
  });
  const result = validateSave(
    prev(prevState, T0),
    body(
      newState,
      zeroActions({
        projectsCompleted: projectCounts({ toDoListApp: 1 }),
        autoShips: projectCounts({ toDoListApp: 1 }),
      })
    ),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "LOC");
});

test("Release Manager cosmetic: Ruby Rocket at 25 hires, equippable in its slot", () => {
  const def = findCosmetic("releaseManager-icon-ruby");
  assert.equal(def.slot, "employeeIcon_releaseManager");
  assert.equal(def.employeeType, "releaseManager");
  assert.equal(def.triggerCount, 25);
  // 25 managers unlock it; 24 do not.
  const unlocked = stateWith({
    employees: counts({ releaseManager: 25 }),
  });
  assert.equal(cosmeticTriggerMet("releaseManager-icon-ruby", unlocked), true);
  assert.equal(
    deriveUnlockedCosmetics(unlocked).includes("releaseManager-icon-ruby"),
    true
  );
  const locked = stateWith({ employees: counts({ releaseManager: 24 }) });
  assert.equal(cosmeticTriggerMet("releaseManager-icon-ruby", locked), false);
  // Equippable in its own slot once unlocked, not in another slot.
  assert.equal(
    canEquipCosmetic("employeeIcon_releaseManager", "releaseManager-icon-ruby", [
      "releaseManager-icon-ruby",
    ]),
    true
  );
  assert.equal(
    canEquipCosmetic("employeeIcon_intern", "releaseManager-icon-ruby", [
      "releaseManager-icon-ruby",
    ]),
    false
  );
});

test("an unassigned manager ships nothing (no auto-ships, no completions)", () => {
  // 1 manager, no assignment, 60s window, nothing shipped: the save
  // validates with zero actions — the manager simply does nothing.
  const prevState = rmUnlockedState(1);
  const newState = rmUnlockedState(1);
  const result = validateSave(
    prev(prevState, T0),
    body(newState, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});
