/**
 * Tests for the four big freelance projects (AI-Powered Dashboard,
 * NFT Marketplace, Metaverse Real Estate, Quantum To-Do List) and the
 * old-save migration that backfills their keys.
 *
 * Key numbers: the rate gets worse as the LOC cost rises (the
 * tradeoff: hammer the cheap efficient gigs, or spam the big ones for
 * faster money but less per LOC). To Do 60c/LOC, Hobby 48, Blockchain
 * 40, AI Dashboard 34, NFT Marketplace 29, Metaverse Real Estate 25,
 * Quantum To-Do List 21.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave } from "../src/validate.js";
import {
  BALANCE,
  FREELANCE_PROJECT_KEYS,
  freelanceProjectUnlockConditionsMet,
  initialSaveState,
  normalizeSaveState,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";

const NEW_PROJECT_KEYS = [
  "aiPoweredDashboard",
  "nftMarketplace",
  "metaverseRealEstate",
  "quantumToDoList",
];

function zeroCounts() {
  return {
    employeesBought: {
      intern: 0,
      junior: 0,
      senior: 0,
      projectManager: 0,
      commitSpecialist: 0,
    },
    projectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
      aiPoweredDashboard: 0,
      nftMarketplace: 0,
      metaverseRealEstate: 0,
      quantumToDoList: 0,
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

/**
 * A save from before the big projects shipped: the freelance maps
 * have only the first three keys. The new keys are deleted after
 * building, the way a stored old save would look.
 */
function oldSaveState(overrides) {
  const state = stateWith(overrides);
  for (const key of NEW_PROJECT_KEYS) {
    delete state.freelanceProjectsCompleted[key];
    delete state.unlockedFreelanceProjects[key];
  }
  return state;
}

/** Actions from an older client: the projectsCompleted map has only
 * the first three keys. */
function oldZeroActions() {
  const actions = zeroActions();
  for (const key of NEW_PROJECT_KEYS) {
    delete actions.projectsCompleted[key];
  }
  return actions;
}

test("rates fall as the LOC cost rises (the big-project tradeoff)", () => {
  const rate = (key) =>
    BALANCE.freelanceProjects[key].reward / BALANCE.freelanceProjects[key].loc;
  assert.equal(rate("toDoListApp"), 60);
  assert.equal(rate("hobbyWebsite"), 48);
  assert.equal(rate("paradigmShiftingBlockchainProject"), 40);
  assert.equal(rate("aiPoweredDashboard"), 34);
  assert.equal(rate("nftMarketplace"), 29);
  assert.equal(rate("metaverseRealEstate"), 25);
  assert.equal(rate("quantumToDoList"), 21);
  // The ladder is strictly decreasing: every bigger project pays
  // less per LOC than the one before it.
  const rates = FREELANCE_PROJECT_KEYS.map(rate);
  for (let i = 1; i < rates.length; i++) {
    assert.ok(rates[i] < rates[i - 1], `${rates[i]} < ${rates[i - 1]}`);
  }
});

test("the four big projects have the approved costs and payouts", () => {
  assert.deepEqual(BALANCE.freelanceProjects.aiPoweredDashboard, {
    loc: 6000,
    reward: 204000,
    unlockConditions: [
      {
        type: "SPECIFIC_PROJECT_COUNT",
        projectKey: "paradigmShiftingBlockchainProject",
        target: 25,
      },
    ],
  });
  assert.deepEqual(BALANCE.freelanceProjects.nftMarketplace, {
    loc: 20000,
    reward: 580000,
    unlockConditions: [
      {
        type: "SPECIFIC_PROJECT_COUNT",
        projectKey: "aiPoweredDashboard",
        target: 500,
      },
      { type: "TOTAL_PROJECTS_COUNT", target: 1000 },
    ],
  });
  assert.deepEqual(BALANCE.freelanceProjects.metaverseRealEstate, {
    loc: 60000,
    reward: 1500000,
    unlockConditions: [
      {
        type: "SPECIFIC_PROJECT_COUNT",
        projectKey: "nftMarketplace",
        target: 500,
      },
      { type: "TOTAL_PROJECTS_COUNT", target: 2000 },
    ],
  });
  assert.deepEqual(BALANCE.freelanceProjects.quantumToDoList, {
    loc: 200000,
    reward: 4200000,
    unlockConditions: [
      {
        type: "SPECIFIC_PROJECT_COUNT",
        projectKey: "metaverseRealEstate",
        target: 500,
      },
      { type: "TOTAL_PROJECTS_COUNT", target: 4000 },
    ],
  });
});

test("fresh saves have all seven freelance projects", () => {
  const fresh = initialSaveState();
  assert.deepEqual(fresh.freelanceProjectsCompleted, {
    toDoListApp: 0,
    hobbyWebsite: 0,
    paradigmShiftingBlockchainProject: 0,
    aiPoweredDashboard: 0,
    nftMarketplace: 0,
    metaverseRealEstate: 0,
    quantumToDoList: 0,
  });
  assert.deepEqual(fresh.unlockedFreelanceProjects, {
    toDoListApp: true,
    hobbyWebsite: false,
    paradigmShiftingBlockchainProject: false,
    aiPoweredDashboard: false,
    nftMarketplace: false,
    metaverseRealEstate: false,
    quantumToDoList: false,
  });
});

test("old saves migrate: missing project keys default to 0, latches derive from shipped counts", () => {
  // A veteran: 475 To Do List Apps + 25 Blockchain Projects = 500
  // total. They already cleared the AI Dashboard unlock (25
  // blockchain) but have shipped 0 AI Dashboards, so the NFT
  // Marketplace stays locked.
  const old = oldSaveState({
    freelanceProjectsCompleted: {
      toDoListApp: 475,
      paradigmShiftingBlockchainProject: 25,
    },
  });
  const migrated = normalizeSaveState(old);
  assert.deepEqual(migrated.freelanceProjectsCompleted, {
    toDoListApp: 475,
    hobbyWebsite: 0,
    paradigmShiftingBlockchainProject: 25,
    aiPoweredDashboard: 0,
    nftMarketplace: 0,
    metaverseRealEstate: 0,
    quantumToDoList: 0,
  });
  assert.equal(migrated.unlockedFreelanceProjects.aiPoweredDashboard, true);
  assert.equal(migrated.unlockedFreelanceProjects.nftMarketplace, false);
  assert.equal(migrated.unlockedFreelanceProjects.metaverseRealEstate, false);
  assert.equal(migrated.unlockedFreelanceProjects.quantumToDoList, false);

  // The same old save validates as the previous state of a save: the
  // shape check passes after migration, and the derived AI Dashboard
  // latch in the new state agrees with the migrated previous state.
  const before = oldSaveState({
    freelanceProjectsCompleted: {
      toDoListApp: 475,
      paradigmShiftingBlockchainProject: 25,
    },
  });
  const after = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 475,
      paradigmShiftingBlockchainProject: 25,
    },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });
});

test("AI-Powered Dashboard unlock is trusted with or without 25 Blockchain Projects (leaderboard killed)", () => {
  // 24 is not enough for the unlock — but the server stores the claim anyway now.
  const before = stateWith({
    freelanceProjectsCompleted: { paradigmShiftingBlockchainProject: 24 },
  });
  const cheater = stateWith({
    freelanceProjectsCompleted: { paradigmShiftingBlockchainProject: 24 },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const r = validateSave(
    prev(before, T0),
    body(cheater, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });

  // 25 is exactly enough.
  const met = stateWith({
    freelanceProjectsCompleted: { paradigmShiftingBlockchainProject: 25 },
  });
  const legit = stateWith({
    freelanceProjectsCompleted: { paradigmShiftingBlockchainProject: 25 },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const ok = validateSave(
    prev(met, T0),
    body(legit, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(ok, { ok: true });
});

test("NFT Marketplace unlock is trusted with or without 500 AI Dashboards AND 1000 total projects (leaderboard killed)", () => {
  // 500 AI Dashboards but only 925 total: the total condition fails on the client — the server stores the claim anyway now.
  const shortTotal = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 400,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
    },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const cheaterTotal = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 400,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
    },
  });
  const r1 = validateSave(
    prev(shortTotal, T0),
    body(cheaterTotal, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(r1, { ok: true });

  // 1000 total but only 5 AI Dashboards: the specific condition fails on the client — the server stores the claim anyway now.
  const shortSpecific = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 970,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 5,
    },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const cheaterSpecific = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 970,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 5,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
    },
  });
  const r2 = validateSave(
    prev(shortSpecific, T0),
    body(cheaterSpecific, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(r2, { ok: true });

  // Both met: 475 To Do + 25 Blockchain + 500 AI Dashboards = 1000.
  const met = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 475,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
    },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const legit = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 475,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
    },
  });
  const ok = validateSave(
    prev(met, T0),
    body(legit, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(ok, { ok: true });
});

test("Metaverse Real Estate unlock is trusted with or without 500 NFT Marketplaces AND 2000 total projects (leaderboard killed)", () => {
  // 500 NFT Marketplaces but only 1425 total — the server stores the claim anyway now.
  const shortTotal = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 400,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
      nftMarketplace: 500,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
    },
  });
  const cheaterTotal = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 400,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
      nftMarketplace: 500,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
      metaverseRealEstate: true,
    },
  });
  const r1 = validateSave(
    prev(shortTotal, T0),
    body(cheaterTotal, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(r1, { ok: true });

  // Both met: 975 To Do + 25 Blockchain + 500 AI + 500 NFT = 2000.
  const met = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 975,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
      nftMarketplace: 500,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
    },
  });
  const legit = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 975,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
      nftMarketplace: 500,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
      metaverseRealEstate: true,
    },
  });
  const ok = validateSave(
    prev(met, T0),
    body(legit, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(ok, { ok: true });
});

test("Quantum To-Do List unlock is trusted with or without 500 Metaverse Real Estates AND 4000 total projects (leaderboard killed)", () => {
  // 4530 total but only 5 Metaverse Real Estates — the server stores the claim anyway now.
  const shortSpecific = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 3500,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
      nftMarketplace: 500,
      metaverseRealEstate: 5,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
      metaverseRealEstate: true,
    },
  });
  const cheater = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 3500,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
      nftMarketplace: 500,
      metaverseRealEstate: 5,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
      metaverseRealEstate: true,
      quantumToDoList: true,
    },
  });
  const r = validateSave(
    prev(shortSpecific, T0),
    body(cheater, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });

  // Both met: 2475 To Do + 25 Blockchain + 500 AI + 500 NFT + 500
  // Metaverse = 4000.
  const met = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 2475,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
      nftMarketplace: 500,
      metaverseRealEstate: 500,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
      metaverseRealEstate: true,
    },
  });
  const legit = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 2475,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
      nftMarketplace: 500,
      metaverseRealEstate: 500,
    },
    unlockedFreelanceProjects: {
      aiPoweredDashboard: true,
      nftMarketplace: true,
      metaverseRealEstate: true,
      quantumToDoList: true,
    },
  });
  const ok = validateSave(
    prev(met, T0),
    body(legit, zeroActions()),
    T0 + 60_000
  );
  assert.deepEqual(ok, { ok: true });
});

test("legit play: ship an AI-Powered Dashboard (6000 LOC -> 204000c)", () => {
  const before = stateWith({
    linesOfCode: 6000,
    totalLinesOfCode: 100000,
    money: 0,
    freelanceProjectsCompleted: { paradigmShiftingBlockchainProject: 25 },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const after = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 100000,
    money: 204000,
    freelanceProjectsCompleted: {
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 1,
    },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      ...zeroActions(),
      projectsCompleted: {
        ...zeroCounts().projectsCompleted,
        aiPoweredDashboard: 1,
      },
    }),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });
});

test("shipping a big project without enough LOC is accepted (leaderboard killed: LOC is trusted)", () => {
  // Only 5000 LOC on hand for a 6000 LOC ship: the old LOC rule
  // rejected this (expected LOC is negative after the project cost).
  // The server stores the ship anyway now.
  const before = stateWith({
    linesOfCode: 5000,
    totalLinesOfCode: 100000,
    money: 0,
    freelanceProjectsCompleted: { paradigmShiftingBlockchainProject: 25 },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const cheater = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 100000,
    money: 204000,
    freelanceProjectsCompleted: {
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 1,
    },
    unlockedFreelanceProjects: { aiPoweredDashboard: true },
  });
  const r = validateSave(
    prev(before, T0),
    body(cheater, {
      ...zeroActions(),
      projectsCompleted: {
        ...zeroCounts().projectsCompleted,
        aiPoweredDashboard: 1,
      },
    }),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });
});

test("unlock conditions for the big projects match the shared config", () => {
  // Spot-check the shared helper directly: the unlock rule in the
  // validator and the client's progress bar both read this.
  const veteran = stateWith({
    freelanceProjectsCompleted: {
      toDoListApp: 2475,
      paradigmShiftingBlockchainProject: 25,
      aiPoweredDashboard: 500,
      nftMarketplace: 500,
      metaverseRealEstate: 500,
    },
  });
  assert.equal(freelanceProjectUnlockConditionsMet("aiPoweredDashboard", veteran), true);
  assert.equal(freelanceProjectUnlockConditionsMet("nftMarketplace", veteran), true);
  assert.equal(freelanceProjectUnlockConditionsMet("metaverseRealEstate", veteran), true);
  assert.equal(freelanceProjectUnlockConditionsMet("quantumToDoList", veteran), true);
  const rookie = initialSaveState();
  assert.equal(freelanceProjectUnlockConditionsMet("aiPoweredDashboard", rookie), false);
  assert.equal(freelanceProjectUnlockConditionsMet("nftMarketplace", rookie), false);
  assert.equal(freelanceProjectUnlockConditionsMet("metaverseRealEstate", rookie), false);
  assert.equal(freelanceProjectUnlockConditionsMet("quantumToDoList", rookie), false);
});

test("old actions without the new project keys still validate (deploy-window backfill)", () => {
  // A client from before the big projects shipped sends a
  // projectsCompleted map with only the first three keys. The server
  // backfills the missing keys to 0 instead of failing the shape
  // check, so a save in flight during the deploy still lands.
  const before = initialSaveState();
  const after = stateWith({
    linesOfCode: 0,
    totalLinesOfCode: 50,
    money: 3000,
    freelanceProjectsCompleted: { toDoListApp: 1 },
  });
  const r = validateSave(
    prev(before, T0),
    body(after, {
      ...oldZeroActions(),
      clicks: 50,
      projectsCompleted: {
        toDoListApp: 1,
        hobbyWebsite: 0,
        paradigmShiftingBlockchainProject: 0,
      },
    }),
    T0 + 60_000
  );
  assert.deepEqual(r, { ok: true });
});
