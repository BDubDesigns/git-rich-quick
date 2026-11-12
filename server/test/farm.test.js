/**
 * Tests for the llama farm mini-game (issue #79): the purchase, llama
 * buying, and the server-rolled breeding rules, plus the old-save
 * migration that backfills the farm.
 *
 * Key numbers (issue #79 feedback): farm costs 1000000c ($10,000); 9
 * stalls in a 3x3 grid; breeding check every 60s, rolled on the SERVER
 * (POST /api/farm/breed) — the client never rolls breeding. The barn
 * arrives EMPTY (no free llamas); base llamas cost 50000c ($500) each
 * in the shop, and bred types come only from breeding. A kid can only
 * be born in a stall with at least two llama neighbours, and no more
 * kids can be born in a window than there were empty stalls when the
 * window started (each kid fills a distinct empty stall). A save only
 * accepts a kid that matches a server-issued breed outcome — a
 * client-injected kid is rejected.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave, matchIssuedFarmBreeds } from "../src/validate.js";
import {
  FARM_CONFIG,
  LLAMA_BASE_TYPES,
  emptyFarmState,
  farmEligibleBreedingStalls,
  farmLlamaCount,
  farmMaxKidsPerWindow,
  farmStallNeighbours,
  initialFarmState,
  initialSaveState,
  normalizeSaveState,
  rollFarmBreeding,
  rollFarmKid,
} from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
const BREED_ID = "123e4567-e89b-42d3-a456-426614174001";
const BREED_ID_2 = "123e4567-e89b-42d3-a456-426614174002";

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
    farmBreedClaims: [],
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

/**
 * A stocked barn: 5 bought llamas (3 Classic, 2 Drama) in a
 * checkerboard (stalls 0, 2, 4, 6, 8), so all four empty stalls sit
 * between llamas and can breed. This is a player who bought the farm
 * and then bought 5 llamas — the barn never starts stocked anymore.
 */
function stockedFarm() {
  const placed = {
    0: "classic",
    2: "drama",
    4: "classic",
    6: "drama",
    8: "classic",
  };
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
      llama: placed[i] ?? null,
      lighting: "warm",
    })),
    unlockedTypes: [...LLAMA_BASE_TYPES],
  };
}

/** A farm-owned state: the stocked barn, with the given money. */
function ownedFarmState(money) {
  return stateWith({ money, farm: stockedFarm() });
}

/** An owned but EMPTY barn (just bought, no llamas yet). */
function emptyOwnedFarmState(money) {
  return stateWith({ money, farm: initialFarmState() });
}

/** Deep-copy a farm's stalls so a test can mutate one stall. */
function withStall(farm, index, stall) {
  const stalls = farm.stalls.map((entry, i) =>
    i === index ? { ...entry, ...stall } : { ...entry }
  );
  return { ...farm, stalls };
}

/** One issued breed outcome, as the store would read it. */
function issuedBreed(breedId, kids, issuedAtMs = T0) {
  return { breedId, kids, issuedAtMs };
}

/** One farm breed claim, as the client would send it. */
function breedClaim(breedId, kids) {
  return { breedId, kids };
}

/** validateSave with the given issued farm breeds (no star claims). */
function validateWithBreeds(before, after, actions, issuedBreeds, nowMs) {
  return validateSave(
    prev(before, T0),
    body(after, actions),
    nowMs,
    [],
    issuedBreeds
  );
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

test("the stocked barn leaves all four empty stalls breed-eligible", () => {
  const stalls = stockedFarm().stalls;
  assert.equal(farmLlamaCount(stalls), 5);
  assert.deepEqual(farmEligibleBreedingStalls(stalls), [1, 3, 5, 7]);
  // The cap is the empty-stall count: each kid fills a distinct stall.
  assert.equal(farmMaxKidsPerWindow(stalls), 4);
});

test("the farm starts empty: no free llamas, no unlocked types", () => {
  const farm = initialFarmState();
  assert.equal(farm.owned, true);
  assert.equal(farmLlamaCount(farm.stalls), 0);
  assert.deepEqual(farm.unlockedTypes, []);
  assert.equal(FARM_CONFIG.purchaseCostCents, 1000000);
  assert.equal(FARM_CONFIG.llamaPriceCents, 50000);
  assert.equal(FARM_CONFIG.breedingTickSeconds, 60);
});

test("rollFarmBreeding with a rigged rng fills every eligible stall", () => {
  // rng() always returns 0: every kid roll succeeds, and every kid is
  // the first undiscovered type (spaghetti — the base types are taken).
  const stalls = stockedFarm().stalls;
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
  const stalls = stockedFarm().stalls;
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
  const stalls = stockedFarm().stalls;
  stalls[1] = { llama: null, lighting: "red" };
  const type = rollFarmKid(1, stalls, [...LLAMA_BASE_TYPES], rng);
  // Stall 1's parents are classic (0), drama (2), classic (4).
  assert.ok(type === "classic" || type === "drama");
});

// ---- Farm purchase ----

test("buying the farm deducts $10,000 and leaves the barn empty", () => {
  const before = stateWith({ money: 2000000, farm: emptyFarmState() });
  const after = stateWith({
    money: 2000000 - FARM_CONFIG.purchaseCostCents,
    farm: initialFarmState(),
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("buying the farm without enough money is accepted (leaderboard killed: money is trusted)", () => {
  // 500000c is less than the 1000000c farm cost, and the new money does
  // not deduct it — the server stores the purchase anyway now.
  const before = stateWith({ money: 500000, farm: emptyFarmState() });
  const after = stateWith({ money: 500000, farm: initialFarmState() });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("buying the farm and two llamas in one window is accepted", () => {
  // The farm and the llamas can be bought in the same 60s window: the
  // barn holds the two bought base llamas, the unlocked list is
  // exactly their types, and the money deducts the farm plus both
  // llamas.
  const before = stateWith({ money: 2000000, farm: emptyFarmState() });
  let farm = initialFarmState();
  farm = withStall(farm, 0, { llama: "classic" });
  farm = withStall(farm, 4, { llama: "drama" });
  farm.unlockedTypes = ["classic", "drama"];
  const after = stateWith({
    money:
      2000000 -
      FARM_CONFIG.purchaseCostCents -
      2 * FARM_CONFIG.llamaPriceCents,
    farm,
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("buying the farm with a non-base llama is accepted (leaderboard killed: llama types are trusted)", () => {
  const before = stateWith({ money: 2000000, farm: emptyFarmState() });
  let farm = initialFarmState();
  farm = withStall(farm, 0, { llama: "quantum" });
  farm.unlockedTypes = ["quantum"];
  const after = stateWith({
    money:
      2000000 -
      FARM_CONFIG.purchaseCostCents -
      FARM_CONFIG.llamaPriceCents,
    farm,
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("buying the farm while claiming an unlocked type with no llama is accepted (leaderboard killed: unlocks are trusted)", () => {
  // The unlocked list at purchase used to be exactly the types of the
  // llamas in the barn — no type unlocked for free. That check is gone.
  const before = stateWith({ money: 2000000, farm: emptyFarmState() });
  const farm = initialFarmState();
  farm.unlockedTypes = ["classic"];
  const after = stateWith({
    money: 2000000 - FARM_CONFIG.purchaseCostCents,
    farm,
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

// ---- Buying llamas ----

test("buying a base llama deducts the price and places it", () => {
  const before = emptyOwnedFarmState(100000);
  const farm = withStall(before.farm, 0, { llama: "classic" });
  farm.unlockedTypes = ["classic"];
  const after = stateWith({
    money: 100000 - FARM_CONFIG.llamaPriceCents,
    farm,
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("buying a llama without enough money is accepted (leaderboard killed: money is trusted)", () => {
  // 10000c is less than the 50000c llama price, and the new money does
  // not deduct it — the server stores the llama anyway now.
  const before = emptyOwnedFarmState(10000);
  const farm = withStall(before.farm, 0, { llama: "classic" });
  farm.unlockedTypes = ["classic"];
  const after = stateWith({ money: 10000, farm });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("buying a non-base llama is accepted (leaderboard killed: llama types are trusted)", () => {
  // Bred types used to be never for sale — a quantum llama that was
  // "bought" (not bred, no issued outcome) was tampered, not purchased.
  // The server stores it now.
  const before = emptyOwnedFarmState(100000);
  const farm = withStall(before.farm, 0, { llama: "quantum" });
  farm.unlockedTypes = ["quantum"];
  const after = stateWith({
    money: 100000 - FARM_CONFIG.llamaPriceCents,
    farm,
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

// ---- Breeding (server-rolled) ----

test("a server-rolled kid born in an eligible stall is accepted", () => {
  const before = ownedFarmState(75000);
  // A classic kid in stall 1: its neighbours (0, 2, 4) are all llamas.
  const farm = withStall(before.farm, 1, { llama: "classic" });
  const after = stateWith({ money: 75000, farm });
  const actions = zeroActions();
  actions.farmBreedClaims = [
    breedClaim(BREED_ID, [{ stallIndex: 1, type: "classic" }]),
  ];
  const result = validateWithBreeds(
    before,
    after,
    actions,
    [issuedBreed(BREED_ID, [{ stallIndex: 1, type: "classic" }])],
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a server-rolled kid of a brand-new type is accepted and unlocks the type", () => {
  const before = ownedFarmState(75000);
  // A spaghetti kid in stall 1: a new type, so the unlocked list grows.
  const farm = withStall(before.farm, 1, { llama: "spaghetti" });
  farm.unlockedTypes = [...LLAMA_BASE_TYPES, "spaghetti"];
  const after = stateWith({ money: 75000, farm });
  const actions = zeroActions();
  actions.farmBreedClaims = [
    breedClaim(BREED_ID, [{ stallIndex: 1, type: "spaghetti" }]),
  ];
  const result = validateWithBreeds(
    before,
    after,
    actions,
    [issuedBreed(BREED_ID, [{ stallIndex: 1, type: "spaghetti" }])],
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("filling all four empty stalls in one server-rolled tick is accepted", () => {
  // 4 kids, 4 empty stalls, one breed tick: exactly at the cap.
  const before = ownedFarmState(75000);
  let farm = before.farm;
  for (const index of [1, 3, 5, 7]) {
    farm = withStall(farm, index, { llama: "classic" });
  }
  const after = stateWith({ money: 75000, farm });
  const kids = [1, 3, 5, 7].map((stallIndex) => ({
    stallIndex,
    type: "classic",
  }));
  const actions = zeroActions();
  actions.farmBreedClaims = [breedClaim(BREED_ID, kids)];
  const result = validateWithBreeds(
    before,
    after,
    actions,
    [issuedBreed(BREED_ID, kids)],
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a llama with no issued outcome is accepted as a bought llama (leaderboard killed: llama origins are trusted)", () => {
  // A spaghetti kid sits in an eligible stall and looks plausible —
  // but the server never rolled it, so there is no breed claim and no
  // issued outcome. With no claim attached, it is indistinguishable
  // from a bought llama, and buying is no longer policed — so the
  // server stores it. A breed CLAIM that matches no issued outcome is
  // still rejected (see the claim tests below).
  const before = ownedFarmState(75000);
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

test("a breed claim that matches no issued outcome is rejected", () => {
  const before = ownedFarmState(75000);
  const farm = withStall(before.farm, 1, { llama: "classic" });
  const after = stateWith({ money: 75000, farm });
  const actions = zeroActions();
  actions.farmBreedClaims = [
    breedClaim(BREED_ID, [{ stallIndex: 1, type: "classic" }]),
  ];
  // The issued outcome is a DIFFERENT breedId: the claim is forged.
  const result = validateWithBreeds(
    before,
    after,
    actions,
    [issuedBreed(BREED_ID_2, [{ stallIndex: 1, type: "classic" }])],
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "FARM");
});

test("a breed claim for a kid the server did not roll is rejected", () => {
  const before = ownedFarmState(75000);
  const farm = withStall(before.farm, 1, { llama: "classic" });
  const after = stateWith({ money: 75000, farm });
  const actions = zeroActions();
  actions.farmBreedClaims = [
    breedClaim(BREED_ID, [{ stallIndex: 1, type: "classic" }]),
  ];
  // The issued outcome rolled a DIFFERENT kid (stall 3, drama): the
  // claim's kid is not one the server rolled.
  const result = validateWithBreeds(
    before,
    after,
    actions,
    [issuedBreed(BREED_ID, [{ stallIndex: 3, type: "drama" }])],
    T0 + 60_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "FARM");
});

test("a breed claim for an expired issued outcome is rejected", () => {
  const before = ownedFarmState(75000);
  const farm = withStall(before.farm, 1, { llama: "classic" });
  const after = stateWith({ money: 75000, farm });
  const actions = zeroActions();
  actions.farmBreedClaims = [
    breedClaim(BREED_ID, [{ stallIndex: 1, type: "classic" }]),
  ];
  // Issued at T0, saved at T0 + 400s: past the 300s validity + 5s
  // grace, so the outcome is stale even though it matches exactly.
  const result = validateWithBreeds(
    before,
    after,
    actions,
    [issuedBreed(BREED_ID, [{ stallIndex: 1, type: "classic" }], T0)],
    T0 + 400_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "FARM");
});

test("a kid in a stall without two llama neighbours is accepted when the claim matches (leaderboard killed: no plausibility backstop)", () => {
  // A barn with llamas only at stalls 0 and 4: stall 6 has neighbours
  // 3 and 7, both empty, so a kid there was never between two llamas.
  // The plausibility backstop is gone — a claim that matches the issued
  // outcome is enough.
  const before = ownedFarmState(75000);
  const sparse = {
    owned: true,
    stalls: stockedFarm().stalls.map((stall, i) => ({
      ...stall,
      llama: i === 0 || i === 4 ? stall.llama : null,
    })),
    unlockedTypes: [...LLAMA_BASE_TYPES],
  };
  const beforeSparse = stateWith({ money: 75000, farm: sparse });
  const farm = withStall(sparse, 6, { llama: "classic" });
  const after = stateWith({ money: 75000, farm });
  const actions = zeroActions();
  actions.farmBreedClaims = [
    breedClaim(BREED_ID, [{ stallIndex: 6, type: "classic" }]),
  ];
  const result = validateWithBreeds(
    beforeSparse,
    after,
    actions,
    [issuedBreed(BREED_ID, [{ stallIndex: 6, type: "classic" }])],
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a bought llama and a bred kid in one window are both accepted", () => {
  // Stall 1 gets a bred classic kid (issued), stall 5 gets a bought
  // drama llama (base type, paid for). The money deducts the llama.
  const before = ownedFarmState(75000);
  let farm = withStall(before.farm, 1, { llama: "classic" });
  farm = withStall(farm, 5, { llama: "drama" });
  const after = stateWith({
    money: 75000 - FARM_CONFIG.llamaPriceCents,
    farm,
  });
  const actions = zeroActions();
  actions.farmBreedClaims = [
    breedClaim(BREED_ID, [{ stallIndex: 1, type: "classic" }]),
  ];
  const result = validateWithBreeds(
    before,
    after,
    actions,
    [issuedBreed(BREED_ID, [{ stallIndex: 1, type: "classic" }])],
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

// ---- Breed matcher ----

test("matchIssuedFarmBreeds accepts an exact claim and returns its kids", () => {
  const result = matchIssuedFarmBreeds(
    [breedClaim(BREED_ID, [{ stallIndex: 1, type: "classic" }])],
    [issuedBreed(BREED_ID, [{ stallIndex: 1, type: "classic" }])],
    T0 + 60_000
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.breedIds, [BREED_ID]);
  assert.deepEqual(result.kids, [{ stallIndex: 1, type: "classic" }]);
});

test("matchIssuedFarmBreeds accepts a claim that applies fewer kids than issued", () => {
  // The server rolled two kids; the client only applied one (the
  // other's stall was filled by a purchase). The claim is valid for
  // the kid it applied.
  const issued = [
    issuedBreed(BREED_ID, [
      { stallIndex: 1, type: "classic" },
      { stallIndex: 3, type: "drama" },
    ]),
  ];
  const result = matchIssuedFarmBreeds(
    [breedClaim(BREED_ID, [{ stallIndex: 1, type: "classic" }])],
    issued,
    T0 + 60_000
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.kids, [{ stallIndex: 1, type: "classic" }]);
});

test("matchIssuedFarmBreeds rejects a claim with no matching outcome", () => {
  const result = matchIssuedFarmBreeds(
    [breedClaim(BREED_ID, [{ stallIndex: 1, type: "classic" }])],
    [issuedBreed(BREED_ID_2, [{ stallIndex: 1, type: "classic" }])],
    T0 + 60_000
  );
  assert.equal(result.ok, false);
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

test("a farm breed claim with a malformed breedId is a shape error", () => {
  const before = ownedFarmState(75000);
  const after = stateWith({ money: 75000, farm: before.farm });
  const actions = zeroActions();
  actions.farmBreedClaims = [
    { breedId: "not-a-uuid", kids: [{ stallIndex: 1, type: "classic" }] },
  ];
  const result = validateSave(
    prev(before, T0),
    body(after, actions),
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
    stalls: stockedFarm().stalls,
    unlockedTypes: undefined,
  };
  const normalized = normalizeSaveState(before);
  assert.deepEqual(
    [...normalized.farm.unlockedTypes].sort(),
    [...LLAMA_BASE_TYPES].sort()
  );
  const after = initialSaveState();
  after.farm = stockedFarm();
  after.money = 0;
  const result = validateSave(
    prev(normalized, T0),
    body(after, zeroActions()),
    T0 + 60_000
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});
