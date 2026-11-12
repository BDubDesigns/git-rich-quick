/**
 * Tests for the Cosmetic Unlock System (issue #11).
 *
 * Cosmetics are employee-icon skins, earned by hiring: one per tier
 * at 25 hires (Bronze Duck / Silver Backpack / Gold Coffee). The
 * registry (which cosmetic belongs to which slot, what triggers it)
 * lives in shared/game-balance.js; the server validates saves
 * against it. The visual data (name, icon, color) is client-only
 * (gameConfig.js) and is not tested here.
 *
 * Rules under test:
 * - a newly claimed cosmetic's hire-count trigger must be met
 *   (COSMETIC); an already-unlocked cosmetic is grandfathered;
 * - an equipped cosmetic must be unlocked and in its own slot (COSMETIC);
 * - the unlocked list only grows (MONOTONIC); the equipped map
 *   switches freely;
 * - unknown cosmetic ids / slots and duplicates are shape errors (400);
 * - a save from before cosmetics shipped normalizes: the unlocked
 *   list is derived from the employee counts, the equipped map
 *   defaults to empty.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateSave } from "../src/validate.js";
import {
  COSMETIC_SLOTS,
  canEquipCosmetic,
  cosmeticTriggerMet,
  deriveUnlockedCosmetics,
  employeeCost,
  employeePurchaseCosts,
  findCosmetic,
  initialSaveState,
  newlyUnlockedCosmetics,
  normalizeSaveState,
} from "../../shared/game-balance.js";
import {
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";

function zeroActions() {
  return {
    clicks: 0,
    employeesBought: { intern: 0, junior: 0, senior: 0, projectManager: 0, commitSpecialist: 0 },
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

/** Total cost of hiring `n` interns starting from `fromCount`. */
function internHireCost(fromCount, n) {
  return employeePurchaseCosts("intern", fromCount, n).reduce(
    (sum, cost) => sum + cost,
    0
  );
}

test("cosmetic registry: one slot per employee type, one unlock each at 25 hires", () => {
  assert.deepEqual(COSMETIC_SLOTS, [
    "employeeIcon_intern",
    "employeeIcon_junior",
    "employeeIcon_senior",
    "employeeIcon_projectManager",
    "employeeIcon_commitSpecialist",
    "employeeIcon_releaseManager",
  ]);
  assert.deepEqual(findCosmetic("intern-icon-bronze"), {
    cosmeticId: "intern-icon-bronze",
    slot: "employeeIcon_intern",
    employeeType: "intern",
    triggerCount: 25,
  });
  assert.deepEqual(findCosmetic("junior-icon-silver"), {
    cosmeticId: "junior-icon-silver",
    slot: "employeeIcon_junior",
    employeeType: "junior",
    triggerCount: 25,
  });
  assert.deepEqual(findCosmetic("senior-icon-gold"), {
    cosmeticId: "senior-icon-gold",
    slot: "employeeIcon_senior",
    employeeType: "senior",
    triggerCount: 25,
  });
  assert.deepEqual(findCosmetic("projectManager-icon-platinum"), {
    cosmeticId: "projectManager-icon-platinum",
    slot: "employeeIcon_projectManager",
    employeeType: "projectManager",
    triggerCount: 25,
  });
  assert.deepEqual(findCosmetic("commitSpecialist-icon-diamond"), {
    cosmeticId: "commitSpecialist-icon-diamond",
    slot: "employeeIcon_commitSpecialist",
    employeeType: "commitSpecialist",
    triggerCount: 25,
  });
  assert.equal(findCosmetic("not-a-cosmetic"), null);
});

test("cosmetic triggers: met at the hire count, not before", () => {
  const twentyFour = stateWith({ employees: { intern: 24 } });
  const twentyFive = stateWith({ employees: { intern: 25 } });
  assert.equal(cosmeticTriggerMet("intern-icon-bronze", twentyFour), false);
  assert.equal(cosmeticTriggerMet("intern-icon-bronze", twentyFive), true);
  assert.equal(cosmeticTriggerMet("not-a-cosmetic", twentyFive), false);
  assert.deepEqual(deriveUnlockedCosmetics(twentyFour), []);
  assert.deepEqual(deriveUnlockedCosmetics(twentyFive), ["intern-icon-bronze"]);
  assert.deepEqual(
    deriveUnlockedCosmetics(
      stateWith({ employees: { intern: 25, junior: 25 } })
    ),
    ["intern-icon-bronze", "junior-icon-silver"]
  );
});

test("newly unlocked cosmetics: threshold-crossing, so a bulk buy past a trigger still fires", () => {
  assert.deepEqual(newlyUnlockedCosmetics("intern", 24, 25), [
    "intern-icon-bronze",
  ]);
  // 5 -> 30 jumps past the 25 trigger; the unlock must still fire.
  assert.deepEqual(newlyUnlockedCosmetics("intern", 5, 30), [
    "intern-icon-bronze",
  ]);
  // Already past the trigger: nothing new.
  assert.deepEqual(newlyUnlockedCosmetics("intern", 25, 26), []);
  assert.deepEqual(newlyUnlockedCosmetics("intern", 0, 24), []);
  assert.deepEqual(newlyUnlockedCosmetics("nope", 0, 25), []);
});

test("canEquipCosmetic: unlocked + own slot only; null is unequip", () => {
  assert.equal(
    canEquipCosmetic("employeeIcon_intern", "intern-icon-bronze", [
      "intern-icon-bronze",
    ]),
    true
  );
  // Wrong slot.
  assert.equal(
    canEquipCosmetic("employeeIcon_junior", "intern-icon-bronze", [
      "intern-icon-bronze",
    ]),
    false
  );
  // Not unlocked.
  assert.equal(
    canEquipCosmetic("employeeIcon_intern", "intern-icon-bronze", []),
    false
  );
  // Unknown cosmetic.
  assert.equal(
    canEquipCosmetic("employeeIcon_intern", "not-a-cosmetic", [
      "not-a-cosmetic",
    ]),
    false
  );
  // Unequip is always allowed.
  assert.equal(
    canEquipCosmetic("employeeIcon_intern", null, []),
    true
  );
});

test("fresh state starts with no cosmetics unlocked or equipped", () => {
  const fresh = initialSaveState();
  assert.deepEqual(fresh.unlockedCosmetics, []);
  assert.deepEqual(fresh.equippedCosmetics, {});
});

test("normalizeSaveState derives the unlocked list for an old save", () => {
  const old = initialSaveState();
  delete old.unlockedCosmetics;
  delete old.equippedCosmetics;
  old.employees.intern = 25;
  const normalized = normalizeSaveState(old);
  assert.deepEqual(normalized.unlockedCosmetics, ["intern-icon-bronze"]);
  assert.deepEqual(normalized.equippedCosmetics, {});
  // A save that already has the fields is unchanged.
  const current = stateWith({
    employees: { intern: 25 },
    unlockedCosmetics: ["intern-icon-bronze"],
    equippedCosmetics: { employeeIcon_intern: "intern-icon-bronze" },
  });
  assert.deepEqual(normalizeSaveState(current), current);
  // A wrong-typed field is defaulted, not a shape error — the same
  // pattern as activeStarEffects / emails (normalize only ever
  // fills in new fields; a missing OLD field is still a shape
  // error). The unlocked list is derived from the counts, so a
  // wrong-typed value cannot invent an unearned cosmetic.
  const mistyped = stateWith({ employees: { intern: 25 } });
  mistyped.unlockedCosmetics = "intern-icon-bronze";
  mistyped.equippedCosmetics = [];
  const mistypedNormalized = normalizeSaveState(mistyped);
  assert.deepEqual(mistypedNormalized.unlockedCosmetics, [
    "intern-icon-bronze",
  ]);
  assert.deepEqual(mistypedNormalized.equippedCosmetics, {});
});

test("validateSave accepts a hire that unlocks a cosmetic at the trigger count", () => {
  const cost = employeeCost("intern", 24);
  const before = stateWith({
    employees: { intern: 24 },
    money: cost,
  });
  const after = stateWith({
    employees: { intern: 25 },
    money: 0,
    unlockedCosmetics: ["intern-icon-bronze"],
  });
  const actions = zeroActions();
  actions.employeesBought.intern = 1;
  const result = validateSave(prev(before, T0), body(after, actions), T0 + 11_000);
  assert.deepEqual(result, { ok: true });
});

test("validateSave accepts equipping an unlocked cosmetic, and unequipping it", () => {
  const before = stateWith({
    employees: { intern: 25 },
    unlockedCosmetics: ["intern-icon-bronze"],
  });
  const equipped = stateWith({
    employees: { intern: 25 },
    unlockedCosmetics: ["intern-icon-bronze"],
    equippedCosmetics: { employeeIcon_intern: "intern-icon-bronze" },
  });
  assert.deepEqual(
    validateSave(prev(before, T0), body(equipped, zeroActions()), T0 + 11_000),
    { ok: true }
  );
  // Unequip back to the default icon: the equipped map switches freely.
  assert.deepEqual(
    validateSave(
      prev(equipped, T0),
      body(before, zeroActions()),
      T0 + 11_000
    ),
    { ok: true }
  );
});

test("validateSave rejects an equipped-but-not-unlocked cosmetic (COSMETIC)", () => {
  const before = stateWith({ employees: { intern: 0 } });
  const after = stateWith({
    employees: { intern: 0 },
    equippedCosmetics: { employeeIcon_intern: "intern-icon-bronze" },
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 11_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "COSMETIC");
});

test("validateSave rejects a cosmetic equipped in the wrong slot (COSMETIC)", () => {
  const before = stateWith({
    employees: { intern: 25 },
    unlockedCosmetics: ["intern-icon-bronze"],
  });
  const after = stateWith({
    employees: { intern: 25 },
    unlockedCosmetics: ["intern-icon-bronze"],
    equippedCosmetics: { employeeIcon_junior: "intern-icon-bronze" },
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 11_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "COSMETIC");
});

test("validateSave accepts an unlocked cosmetic whose trigger is not met (leaderboard killed: triggers are not policed)", () => {
  const before = stateWith({
    employees: { intern: 5 },
    money: internHireCost(0, 5),
  });
  const after = stateWith({
    employees: { intern: 5 },
    money: internHireCost(0, 5),
    unlockedCosmetics: ["intern-icon-bronze"],
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 11_000
  );
  assert.deepEqual(result, { ok: true });
});

test("validateSave accepts a grandfathered cosmetic unlocked below the new trigger", () => {
  // The trigger rose from 10 to 25 hires. A player who earned the
  // Bronze Duck at 10 hires keeps it: the unlocked list only grows
  // (MONOTONIC), and the server no longer checks triggers at all.
  // Their save must not be rejected, and the cosmetic must still equip.
  const before = stateWith({
    employees: { intern: 10 },
    unlockedCosmetics: ["intern-icon-bronze"],
  });
  const after = stateWith({
    employees: { intern: 10 },
    unlockedCosmetics: ["intern-icon-bronze"],
    equippedCosmetics: { employeeIcon_intern: "intern-icon-bronze" },
  });
  assert.deepEqual(
    validateSave(prev(before, T0), body(after, zeroActions()), T0 + 11_000),
    { ok: true }
  );
});

test("validateSave rejects removing an unlocked cosmetic (MONOTONIC)", () => {
  const before = stateWith({
    employees: { intern: 25 },
    unlockedCosmetics: ["intern-icon-bronze"],
  });
  const after = stateWith({
    employees: { intern: 25 },
    unlockedCosmetics: [],
  });
  const result = validateSave(
    prev(before, T0),
    body(after, zeroActions()),
    T0 + 11_000
  );
  assert.equal(result.ok, false);
  assert.equal(result.rule, "MONOTONIC");
});

test("validateSave rejects unknown cosmetic ids, unknown slots, and duplicates (SHAPE)", () => {
  const before = initialSaveState();
  const cases = [
    stateWith({ unlockedCosmetics: ["not-a-cosmetic"] }),
    stateWith({
      unlockedCosmetics: ["intern-icon-bronze", "intern-icon-bronze"],
      employees: { intern: 25 },
    }),
    stateWith({
      equippedCosmetics: { employeeIcon_nope: "intern-icon-bronze" },
    }),
    stateWith({
      equippedCosmetics: { employeeIcon_intern: "not-a-cosmetic" },
    }),
  ];
  for (const after of cases) {
    const result = validateSave(
      prev(before, T0),
      body(after, zeroActions()),
      T0 + 11_000
    );
    assert.equal(result.ok, false);
    assert.equal(result.rule, "SHAPE");
  }
});

test("validateSave accepts an old save without cosmetic fields (derived on normalize)", () => {
  const total25 = internHireCost(0, 25);
  const before = stateWith({ money: total25 });
  const after = stateWith({ employees: { intern: 25 }, money: 0 });
  delete after.unlockedCosmetics;
  delete after.equippedCosmetics;
  const actions = zeroActions();
  actions.employeesBought.intern = 25;
  const result = validateSave(prev(before, T0), body(after, actions), T0 + 11_000);
  assert.deepEqual(result, { ok: true });
});

test("serialize round-trips the cosmetic fields, deriving them for old saves", () => {
  const withCosmetics = stateWith({
    employees: { intern: 25 },
    unlockedCosmetics: ["intern-icon-bronze"],
    equippedCosmetics: { employeeIcon_intern: "intern-icon-bronze" },
  });
  // Client state shape -> flat save shape -> client state shape.
  const gameFields = saveStateToGameFields(withCosmetics);
  assert.deepEqual(gameFields.unlockedCosmetics, ["intern-icon-bronze"]);
  assert.deepEqual(gameFields.equippedCosmetics, {
    employeeIcon_intern: "intern-icon-bronze",
  });
  const back = stateToSaveState({
    ...gameFields,
    linesOfCode: withCosmetics.linesOfCode,
    totalLinesOfCode: withCosmetics.totalLinesOfCode,
    money: withCosmetics.money,
  });
  assert.deepEqual(back.unlockedCosmetics, ["intern-icon-bronze"]);
  assert.deepEqual(back.equippedCosmetics, {
    employeeIcon_intern: "intern-icon-bronze",
  });
  // Old save without the fields: the unlocked list is derived from
  // the employee counts on load.
  const old = stateWith({ employees: { intern: 25 } });
  delete old.unlockedCosmetics;
  delete old.equippedCosmetics;
  const oldFields = saveStateToGameFields(old);
  assert.deepEqual(oldFields.unlockedCosmetics, ["intern-icon-bronze"]);
  assert.deepEqual(oldFields.equippedCosmetics, {});
});
