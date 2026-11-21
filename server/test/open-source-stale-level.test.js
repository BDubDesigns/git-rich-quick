/**
 * Tests for the stale client guard on the Open Source card (issue #179).
 *
 * Nov 18: a stale build (9 OverReact levels) loaded a save written by
 * the current client (OverReact level 10), and the unguarded read
 * `config.levels[currentLevel - 1].bonus` in OpenSource.jsx threw
 * "Cannot read properties of undefined (reading 'bonus')", taking the
 * tab down. The card now renders from openSourceCardModel, which
 * clamps the save level to the levels this client defines: a level
 * above the maximum renders as the highest known level, maxed, never
 * a crash. The production math's totalBonusByType gets the same clamp.
 *
 * The server suite cannot render JSX (CI installs only the server
 * workspace), so "rendering the card" is pinned as: the card's whole
 * prop model, plus every per-level helper the card calls with it,
 * computes without throwing; and the component reads only the model.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BALANCE,
  OPEN_SOURCE_IDS,
  doublingTrackMultiplier,
  isDoublingProject,
  launchPadCooldownSeconds,
  launchPadLevelUpFloatText,
  starBrokerCooldownSeconds,
  starBrokerLevelUpFloatText,
  starSpawnIntervalSeconds,
  totalBonusByType,
  unlockedStarEffects,
} from "../../shared/game-balance.js";
import {
  clampedOpenSourceLevel,
  openSourceCardModel,
} from "../../client/src/utils/openSourceCard.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

function stateAt(levels, extra = {}) {
  return {
    linesOfCode: 1e15,
    openSourceProjects: Object.fromEntries(
      OPEN_SOURCE_IDS.map((id) => [id, { level: levels[id] ?? 0 }])
    ),
    permanentStoreRanks: { fundingRounds: 99 },
    ...extra,
  };
}

/** Every per-level helper OpenSourceCard calls with the model's level. */
function cardHelpers(projectId, level, isMaxed) {
  starSpawnIntervalSeconds(level);
  unlockedStarEffects(level);
  if (!isMaxed) starSpawnIntervalSeconds(level + 1);
  if (level > 0) starBrokerCooldownSeconds(level);
  if (!isMaxed) starBrokerCooldownSeconds(level + 1);
  if (level > 0) launchPadCooldownSeconds(level);
  launchPadCooldownSeconds(level + 1);
  launchPadLevelUpFloatText(level + 1);
  starBrokerLevelUpFloatText(level + 1);
  if (isDoublingProject(projectId)) {
    doublingTrackMultiplier(projectId, level);
    doublingTrackMultiplier(projectId, level + 1);
  }
}

test("the bug: the old unguarded read throws on a level above the defined max", () => {
  const config = BALANCE.openSource.overReactFramework;
  const saveLevel = config.levels.length + 1;
  assert.throws(() => config.levels[saveLevel - 1].bonus, /reading 'bonus'/);
});

test("a level above the client's max renders as the highest known level, maxed, without throwing", () => {
  const config = BALANCE.openSource.overReactFramework;
  const max = config.levels.length;
  const model = openSourceCardModel("overReactFramework", stateAt({ overReactFramework: max + 1 }));
  assert.deepEqual(model, {
    currentLevel: max,
    currentBonus: config.levels[max - 1].bonus,
    nextBonus: undefined,
    locCost: undefined,
    isMaxed: true,
    lockedRoundName: null,
    canContribute: false,
  });
});

test("every project, at every level above its max, models and renders its helpers without throwing", () => {
  for (const id of OPEN_SOURCE_IDS) {
    const max = BALANCE.openSource[id].levels.length;
    for (const level of [max + 1, max + 5, 999]) {
      let model;
      assert.doesNotThrow(() => {
        model = openSourceCardModel(id, stateAt({ [id]: level }));
      }, `${id} at ${level}`);
      assert.equal(model.currentLevel, max, `${id} clamps to ${max}`);
      assert.equal(model.isMaxed, true);
      assert.equal(model.canContribute, false);
      assert.deepEqual(model.currentBonus, BALANCE.openSource[id].levels[max - 1].bonus);
      assert.doesNotThrow(() => cardHelpers(id, model.currentLevel, model.isMaxed), id);
    }
  }
});

test("in-range levels model exactly as before (no behavior change)", () => {
  for (const id of OPEN_SOURCE_IDS) {
    const levels = BALANCE.openSource[id].levels;
    for (let level = 0; level <= levels.length; level += 1) {
      const model = openSourceCardModel(id, stateAt({ [id]: level }));
      // stateAt owns every round (IPO), where the Bridge Round card is
      // closed (issue #226): it reads as maxed at level 0 too.
      const isMaxed = level >= levels.length || id === "bridgeRound";
      assert.equal(model.currentLevel, level);
      assert.equal(model.isMaxed, isMaxed);
      assert.deepEqual(model.currentBonus, level > 0 ? levels[level - 1].bonus : null);
      assert.deepEqual(model.nextBonus, isMaxed ? undefined : levels[level].bonus);
      // The Bridge Round (issue #192) is priced by the owned round, and
      // stateAt owns every round, where no bridge is offered: no price.
      const expectedCost =
        isMaxed || id === "bridgeRound" ? undefined : levels[level].locCost;
      assert.equal(model.locCost, expectedCost);
    }
  }
  // At Bootstrapped the bridge model reads its Bootstrapped price.
  const bridge = openSourceCardModel(
    "bridgeRound",
    stateAt({}, { permanentStoreRanks: { fundingRounds: 0 } })
  );
  assert.equal(bridge.locCost, 1_000_000_000);
  // Funding Rounds still gate: Bootstrapped (round 0) Senior Moment at L6.
  const capped = openSourceCardModel("seniorMoment", stateAt({ seniorMoment: 6 }, { permanentStoreRanks: { fundingRounds: 0 } }));
  assert.equal(capped.canContribute, false);
  assert.equal(typeof capped.lockedRoundName, "string");
  // Not enough LOC: not contributable.
  assert.equal(openSourceCardModel("blocker", stateAt({}, { linesOfCode: 0 })).canContribute, false);
});

test("junk levels and unknown ids are safe", () => {
  assert.equal(clampedOpenSourceLevel("blocker", -3), 0);
  assert.equal(clampedOpenSourceLevel("blocker", NaN), 0);
  assert.equal(clampedOpenSourceLevel("blocker", undefined), 0);
  assert.equal(clampedOpenSourceLevel("notAProject", 4), 0);
  assert.equal(openSourceCardModel("notAProject", stateAt({})), null);
  assert.doesNotThrow(() => openSourceCardModel("blocker", { openSourceProjects: {} }));
});

test("the production math clamps too: totalBonusByType never reads past the end", () => {
  // OverReact's levels are CLICK_BOOST, Blocker's PASSIVE_BOOST.
  for (const [id, type] of [["overReactFramework", "CLICK_BOOST"], ["blocker", "PASSIVE_BOOST"]]) {
    const max = BALANCE.openSource[id].levels.length;
    const atMax = totalBonusByType({ [id]: max }, type);
    assert.ok(atMax > 0, `${id} contributes ${type}`);
    assert.doesNotThrow(() => totalBonusByType({ [id]: max + 1 }, type));
    assert.equal(totalBonusByType({ [id]: max + 1 }, type), atMax);
    assert.equal(totalBonusByType({ [id]: 999 }, type), atMax);
  }
  assert.equal(totalBonusByType({ overReactFramework: -2 }, "CLICK_BOOST"), 0);
});

test("OpenSource.jsx renders unlocked cards from the guarded model only", () => {
  const os = src("components/OpenSource.jsx");
  assert.match(os, /import \{ openSourceCardModel \} from "\.\.\/utils\/openSourceCard\.js"/);
  assert.match(os, /\} = openSourceCardModel\(id, state\);/);
  assert.ok(!/levels\[currentLevel - 1\]/.test(os), "the unguarded read is gone");
  assert.ok(!/levels\[currentLevel\]/.test(os));
});
