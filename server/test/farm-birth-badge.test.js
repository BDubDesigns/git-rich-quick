/**
 * Tests for the Farm tab birth badge (issue #204). Brandon, Nov 20: "if
 * 2 llamas are born it should show 2 notification bubble and then next
 * round of another 1 is born it should show three if I haven't been to
 * the farm yet so I know when I can sell."
 *
 * farm.unseenBirths counts llamas born since the Farm tab was last
 * opened: only kids a breed result actually placed, accumulating across
 * results, never while the player is on the Farm tab (shipped behavior:
 * births there are not counted at all, so the badge is never nonzero on
 * the tab), cleared on opening the tab, saved and reloaded with the
 * farm, and reset with the farm on a sale.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { validateSave } from "../src/validate.js";
import {
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  applyFarmBirths,
  applyPrestigeSale,
  emptyFarmState,
  equityThresholdLoc,
  farmBirthsPlaced,
  farmSeen,
  farmUnseenBirths,
  initialFarmState,
  initialSaveState,
  normalizeSaveState,
} from "../../shared/game-balance.js";
import {
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

/** An owned barn with llamas placed by stall index. */
function farmWith(placed, unseenBirths = 0) {
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
      llama: placed[i] ?? null,
      lighting: "warm",
    })),
    unlockedTypes: [...new Set(Object.values(placed))],
    unseenBirths,
  };
}

function zeroActions() {
  const counts = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
  return {
    clicks: 0,
    employeesBought: counts(EMPLOYEE_TYPES),
    projectsCompleted: counts(FREELANCE_PROJECT_KEYS),
    autoShips: counts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: counts(OPEN_SOURCE_IDS),
  };
}

function validate(prev, next) {
  return validateSave(
    { state: prev, savedAtMs: T0 },
    { playerId: PLAYER_ID, state: next, actionsSinceLastSave: zeroActions() },
    T0 + 60_000
  );
}

test("a breed result raises the count by the number of kids actually placed", () => {
  const farm = farmWith({ 0: "classic", 2: "drama", 4: "classic" });
  const two = applyFarmBirths(farm, [
    { stallIndex: 1, type: "classic" },
    { stallIndex: 3, type: "spaghetti" },
  ]);
  assert.equal(two.unseenBirths, 2);
  assert.equal(two.stalls[1].llama, "classic");
  assert.equal(two.stalls[3].llama, "spaghetti");
  // Kids that are not placed do not count: an occupied stall, a bad
  // index, an unknown type, a junk payload.
  const none = applyFarmBirths(farm, [
    { stallIndex: 0, type: "classic" },
    { stallIndex: 99, type: "classic" },
    { stallIndex: 5, type: "unicorn" },
    null,
  ]);
  assert.equal(none.unseenBirths, 0);
  assert.equal(applyFarmBirths(farm, undefined).unseenBirths, 0);
  assert.equal(applyFarmBirths(farm, []).unseenBirths, 0);
  // The placement itself is the unchanged applyFarmBreedKids.
  assert.equal(farmBirthsPlaced(farm, two), 2);
});

test("births accumulate across breed results until a visit: 2, then one more is 3", () => {
  let farm = farmWith({ 0: "classic", 2: "drama", 4: "classic", 6: "drama" });
  farm = applyFarmBirths(farm, [
    { stallIndex: 1, type: "classic" },
    { stallIndex: 3, type: "drama" },
  ]);
  assert.equal(farm.unseenBirths, 2);
  farm = applyFarmBirths(farm, [{ stallIndex: 5, type: "quantum" }]);
  assert.equal(farm.unseenBirths, 3);
  // An empty tick changes nothing.
  farm = applyFarmBirths(farm, []);
  assert.equal(farm.unseenBirths, 3);
});

test("opening the Farm tab zeroes it; births while on the tab never raise it", () => {
  const seen = farmSeen(farmWith({ 0: "classic" }, 3));
  assert.equal(seen.unseenBirths, 0);
  assert.equal(seen.stalls[0].llama, "classic", "only the count changes");
  const zero = farmWith({ 0: "classic" }, 0);
  assert.equal(farmSeen(zero), zero, "already clear: same object");
  // Watching (activeTab is farm): the kid is placed, the badge stays 0.
  const watched = applyFarmBirths(
    farmWith({ 0: "classic", 2: "drama" }),
    [{ stallIndex: 1, type: "classic" }],
    { watching: true }
  );
  assert.equal(watched.stalls[1].llama, "classic");
  assert.equal(watched.unseenBirths, 0);
});

test("the reducer counts on breed (not while watching) and clears on opening the farm, by tab or email link", () => {
  const context = src("context/GameContext.jsx");
  assert.match(
    context,
    /farm: shared\.applyFarmBirths\(farm, action\.payload\?\.kids, \{\s*watching: state\.activeTab === "farm",\s*\}\)/
  );
  assert.match(context, /return withFarmVisit\(\{ \.\.\.clearHighlight\(state\), activeTab \}\);/);
  assert.match(context, /return withFarmVisit\(navigateToTarget\(state, action\.payload\?\.target\)\);/);
  assert.match(
    context,
    /function withFarmVisit\(state\) \{\s*if \(state\.activeTab !== "farm" \|\| !state\.farm\) return state;\s*const farm = shared\.farmSeen\(state\.farm\);/
  );
});

test("the badge: the Farm tab shows the count, the Projects pattern, and never while on the Farm tab", () => {
  const nav = src("components/NavBar.jsx");
  assert.match(nav, /const unseenBirths =\s*state\.activeTab === "farm" \? 0 : farmUnseenBirths\(state\.farm\);/);
  assert.match(nav, /: id === "farm"\s*\? unseenBirths/);
  // The same NavButton badge the Projects and Email counts use.
  assert.match(src("components/NavButton.jsx"), /\{badgeCount > 0 && \(/);
  assert.ok(!nav.includes("—") && !nav.includes("–"));
});

test("resets with the farm on a sale", () => {
  const pre = initialSaveState();
  pre.totalLinesOfCode = equityThresholdLoc(2);
  pre.farm = farmWith({ 0: "classic", 1: "drama" }, 5);
  const post = applyPrestigeSale(pre, randomUUID());
  assert.equal(post.farm.unseenBirths, 0);
  assert.deepEqual(post.farm, emptyFarmState());
  assert.equal(emptyFarmState().unseenBirths, 0);
  assert.equal(initialFarmState().unseenBirths, 0);
});

test("persists in the farm state: client save round trip, the server accepts it, old saves read 0", () => {
  const save = initialSaveState();
  save.farm = farmWith({ 0: "classic", 1: "classic" }, 4);
  // Save -> client -> save keeps the count.
  const client = saveStateToGameFields(save);
  assert.equal(client.farm.unseenBirths, 4);
  assert.equal(stateToSaveState({ ...save, ...client }).farm.unseenBirths, 4);
  // The server accepts it, and a later visit (count back to 0) too.
  const prev = { ...initialSaveState(), farm: farmWith({ 0: "classic" }, 0) };
  assert.equal(validate(prev, save).ok, true, JSON.stringify(validate(prev, save)));
  assert.equal(validate(save, { ...save, farm: { ...save.farm, unseenBirths: 0 } }).ok, true);
  // A farm from before the badge has no count: it reads 0 everywhere.
  const old = initialSaveState();
  delete old.farm.unseenBirths;
  assert.equal(normalizeSaveState(old).farm.unseenBirths, 0);
  assert.equal(saveStateToGameFields(old).farm.unseenBirths, 0);
  assert.equal(validate(initialSaveState(), old).ok, true);
  // Junk is rejected by the shape check, never repaired.
  for (const bad of [-1, 1.5, "2", null]) {
    const r = validate(prev, { ...save, farm: { ...save.farm, unseenBirths: bad } });
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.rule, "SHAPE");
  }
  assert.equal(farmUnseenBirths({ unseenBirths: Number.NaN }), 0);
  assert.equal(farmUnseenBirths(undefined), 0);
});
