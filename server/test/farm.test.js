/**
 * Tests for the llama farm mini-game (issue #79): the purchase, the
 * breeding rules, and the old-save migration that backfills the farm.
 *
 * Key numbers: farm costs 25000c ($250); 9 stalls in a 3x3 grid;
 * breeding check every 5s; the starting barn holds 5 llamas (3 Classic,
 * 2 Drama) in a checkerboard, so all 4 empty stalls sit between llamas
 * and can breed from the start. A kid can only be born in a stall with
 * at least two llama neighbours, and no more kids can be born in a
 * window than there were empty stalls when the window started (each kid
 * fills a distinct empty stall).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave } from "../src/validate.js";
import {
  FARM_CONFIG,
  LLAMA_BASE_TYPES,
  emptyFarmState,
  farmEligibleBreedingStalls,
  farmLlamaCount,
  farmMaxKidsPerWindow,
  farmStallNeighbours,
  farmStartingStalls,
  initialFarmState,
  initialSaveState,
  normalizeSaveState,
  rollFarmBreeding,
  rollFarmKid,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";

function zeroActions() {
  return {
    clicks: 0,
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
      starBroker: 0,
    },
    starClaims: [],
  };
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

/** A farm-owned state: the starting barn, with the given money. */
function ownedFarmState(money) {
  return stateWith({ money, farm: initialFarmState() });
}

/** Deep-copy a farm's stalls so a test can mutate one stall. */
function withStall(farm, index, stall) {
  const stalls = farm.stalls.map((entry, i) =>
    i === index ? { ...entry, ...stall } : { ...entry }
  );
  return { ...farm, stalls };
}

// ---- Shared breeding helpers ----

test("farmStallNeighbours returns the orthogonal neighbours", () => {
  // Corner stall 0: right and down only.
  assert.deepEqual(farmStallNeighbours(0), [1, 3]);
  // Edge stall 1 (top middle): left, right, down.
  assert.deepEqual(farmStallNeighbours(1), [0, 2, 4]);
  // Centre stall 4: all four.
  assert.deepEqual(farmStallNeighbours(4), [3, 5, 1, 7]);
  // Corner stall 8: left and up only.
  assert.deepEqual(farmStallNeighbours(8), [7, 5]);
});

test("the starting barn leaves all four empty stalls breed-eligible", () => {
  const stalls = farmStartingStalls();
  assert.equal(farmLlamaCount(stalls), 5);
  assert.deepEqual(farmEligibleBreedingStalls(stalls), [1, 3, 5, 7]);
  // The cap is the empty-stall count: each kid fills a distinct stall.
  assert.equal(farmMaxKidsPerWindow(stalls), 4);
});

test("rollFarmBreeding with a rigged rng fills every eligible stall", () => {
  // rng() always returns 0: every kid roll succeeds, and every kid is
  // the first undiscovered type (spaghetti — the base types are taken).
  const stalls = farmStartingStalls();
  const { stalls: next, kidsBorn } = rollFarmBreeding(
    stalls,
    [...LLAMA_BASE_TYPES],
    () => 0
  );
  assert.equal(kidsBorn.length, 4);
  assert.ok(kidsBorn.every((type) => type === "spaghetti"));
  assert.equal(farmLlamaCount(next), 9);
  // A kid born in one stall does not make a neighbour eligible in the
  // same tick — but here every empty stall was already eligible.
  assert.deepEqual(farmEligibleBreedingStalls(next), []);
});

test("rollFarmKid returns null for an occupied stall or a lone neighbour", () => {
  const stalls = farmStartingStalls();
  // Occupied stall 0 never breeds.
  assert.equal(rollFarmKid(0, stalls, [...LLAMA_BASE_TYPES], () => 0), null);
  // A stall with only one llama neighbour never breeds, even with a
  // rigged rng. Stall 6 has neighbours 3 and 7, both empty.
  assert.equal(rollFarmKid(6, stalls, [...LLAMA_BASE_TYPES], () => 0), null);
});

test("rollFarmKid picks a parent type when the new-type roll fails", () => {
  // rng() returns 0.9: the kid roll succeeds (0.9 < 1 is false for warm
  // 0.15 — so use red lighting, kidChance 0.3, still false). Use a
  // custom rng sequence instead: first call 0.1 (kid, red 0.3), second
  // call 0.9 (no new type, red 0.05), third call 0 (first parent).
  const calls = [0.1, 0.9, 0];
  let i = 0;
  const rng = () => calls[i++];
  const stalls = farmStartingStalls();
  stalls[1] = { llama: null, lighting: "red" };
  const type = rollFarmKid(1, stalls, [...LLAMA_BASE_TYPES], rng);
  // Stall 1's parents are classic (0), drama (2), classic (4).
  assert.ok(type === "classic" || type === "drama");
});

// ---- Farm purchase ----

test("buying the farm deducts the cost and places the 5 starting llamas", () => {
  const before = stateWith({ money: 100000, farm: emptyFarmState() });
  const after = stateWith({
    money: 100000 - FARM_CONFIG.purchaseCostCents,
    farm: initialFarmState(),
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("buying the farm without enough money is rejected", () => {
  // 10000c is less than the 25000c farm cost, and the new money does
  // not deduct it — the MONEY rule catches the unpaid purchase.
  const before = stateWith({ money: 10000, farm: emptyFarmState() });
  const after = stateWith({ money: 10000, farm: initialFarmState() });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "MONEY");
});

test("buying the farm with the wrong llama count is rejected", () => {
  const before = stateWith({ money: 100000, farm: emptyFarmState() });
  const farm = initialFarmState();
  // Drop the llama in stall 8: only 4 llamas placed.
  farm.stalls = farm.stalls.map((stall, i) =>
    i === 8 ? { ...stall, llama: null } : stall
  );
  const after = stateWith({
    money: 100000 - FARM_CONFIG.purchaseCostCents,
    farm,
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "FARM");
});

test("buying the farm with a non-base llama type is rejected", () => {
  const before = stateWith({ money: 100000, farm: emptyFarmState() });
  const farm = initialFarmState();
  // Swap the classic in stall 8 for a quantum llama: a new type cannot
  // be sitting in the barn before any breeding has happened.
  farm.stalls = farm.stalls.map((stall, i) =>
    i === 8 ? { ...stall, llama: "quantum" } : stall
  );
  farm.unlockedTypes = [...LLAMA_BASE_TYPES, "quantum"];
  const after = stateWith({
    money: 100000 - FARM_CONFIG.purchaseCostCents,
    farm,
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "FARM");
});

// ---- Breeding ----

test("a kid born in an eligible stall is accepted", () => {
  const before = ownedFarmState(75000);
  // A classic kid in stall 1: its neighbours (0, 2, 4) are all llamas.
  const farm = withStall(before.farm, 1, { llama: "classic" });
  const after = stateWith({ money: 75000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a kid of a brand-new type is accepted and unlocks the type", () => {
  const before = ownedFarmState(75000);
  // A spaghetti kid in stall 1: a new type, so the unlocked list grows.
  const farm = withStall(before.farm, 1, { llama: "spaghetti" });
  farm.unlockedTypes = [...LLAMA_BASE_TYPES, "spaghetti"];
  const after = stateWith({ money: 75000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("filling all four empty stalls in one window is accepted", () => {
  // 4 kids, 4 empty stalls: exactly at the cap, so it validates.
  const before = ownedFarmState(75000);
  let farm = before.farm;
  for (const index of [1, 3, 5, 7]) {
    farm = withStall(farm, index, { llama: "classic" });
  }
  const after = stateWith({ money: 75000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a kid in a stall without two llama neighbours is rejected", () => {
  // A barn with llamas only at stalls 0 and 4: stall 6 has neighbours
  // 3 and 7, both empty, so a kid there was never between two llamas.
  const before = ownedFarmState(75000);
  const sparse = {
    owned: true,
    stalls: farmStartingStalls().map((stall, i) => ({
      ...stall,
      llama: i === 0 || i === 4 ? stall.llama : null,
    })),
    unlockedTypes: [...LLAMA_BASE_TYPES],
  };
  const beforeSparse = stateWith({ money: 75000, farm: sparse });
  const farm = withStall(sparse, 6, { llama: "classic" });
  const after = stateWith({ money: 75000, farm });
  const result = validateSave(
    prev(beforeSparse, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "FARM");
});

// ---- Monotonic farm rules ----

test("a stall llama changing type is rejected", () => {
  const before = ownedFarmState(75000);
  const farm = withStall(before.farm, 0, { llama: "drama" });
  const after = stateWith({ money: 75000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "MONOTONIC");
});

test("a stall llama disappearing is rejected", () => {
  const before = ownedFarmState(75000);
  const farm = withStall(before.farm, 0, { llama: null });
  const after = stateWith({ money: 75000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "MONOTONIC");
});

test("losing an unlocked llama type is rejected", () => {
  // The unlocked list only grows. To isolate the MONOTONIC rule from
  // the shape rule (a stall holding a type that is not unlocked is a
  // shape error), the lost type must not be sitting in any stall: the
  // previous save carries spaghetti as unlocked but no stall holds
  // one — an "extra" unlocked type, which is shape-valid because the
  // shape only requires every stalled llama to be unlocked, not the
  // reverse. Dropping it from the list is then a MONOTONIC failure.
  const before = ownedFarmState(75000);
  before.farm.unlockedTypes = [...LLAMA_BASE_TYPES, "spaghetti"];
  const after = stateWith({
    money: 75000,
    farm: { ...before.farm, unlockedTypes: [...LLAMA_BASE_TYPES] },
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "MONOTONIC");
});

test("un-buying the farm is rejected", () => {
  const before = ownedFarmState(75000);
  const after = stateWith({ money: 75000, farm: emptyFarmState() });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "MONOTONIC");
});

// ---- Lighting and shape ----

test("changing a stall lighting color is accepted", () => {
  // Lighting is a free choice, like an equipped cosmetic: it switches
  // freely and never fails validation.
  const before = ownedFarmState(75000);
  const farm = withStall(before.farm, 1, { lighting: "blue" });
  const after = stateWith({ money: 75000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a stall with an unknown llama type is a shape error", () => {
  const before = ownedFarmState(75000);
  const farm = withStall(before.farm, 1, { llama: "notAType" });
  const after = stateWith({ money: 75000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "SHAPE");
});

test("a stall with an unknown lighting color is a shape error", () => {
  const before = ownedFarmState(75000);
  const farm = withStall(before.farm, 1, { lighting: "magenta" });
  const after = stateWith({ money: 75000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "SHAPE");
});

test("an unbought farm holding llamas is a shape error", () => {
  const before = stateWith({ money: 100000, farm: emptyFarmState() });
  const farm = emptyFarmState();
  farm.stalls = farm.stalls.map((stall, i) =>
    i === 0 ? { ...stall, llama: "classic" } : stall
  );
  const after = stateWith({ money: 100000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "SHAPE");
});

// ---- Old-save migration ----

test("a save from before the farm shipped backfills to an empty farm", () => {
  const before = initialSaveState();
  delete before.farm;
  const normalized = normalizeSaveState(before);
  assert.equal(normalized.farm.owned, false);
  assert.equal(normalized.farm.stalls.length, FARM_CONFIG.stallCount);
  assert.ok(normalized.farm.stalls.every((stall) => stall.llama === null));
  assert.deepEqual(normalized.farm.unlockedTypes, []);
  // And the backfilled save validates.
  const after = initialSaveState();
  const result = validateSave(
    prev(normalized, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a save with a partial farm gets its missing pieces defaulted", () => {
  const before = initialSaveState();
  // A farm that predates unlockedTypes: the types are derived from the
  // llamas actually in the stalls.
  before.farm = {
    owned: true,
    stalls: farmStartingStalls(),
    unlockedTypes: undefined,
  };
  const normalized = normalizeSaveState(before);
  assert.deepEqual(
    [...normalized.farm.unlockedTypes].sort(),
    [...LLAMA_BASE_TYPES].sort()
  );
  const after = initialSaveState();
  after.farm = initialFarmState();
  after.money = 0;
  const result = validateSave(
    prev(normalized, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});
