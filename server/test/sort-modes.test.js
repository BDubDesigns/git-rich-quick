/**
 * Tests for the shared sort control and ordering helper (issue #180),
 * and the Open Source tab's Default / Cheapest modes.
 *
 * - Default reproduces the tab's pre-#180 order exactly (favorites
 *   first among buyable, config order, round-capped, then maxed).
 * - Cheapest orders the buyable list by next-level LOC cost ascending
 *   (ties in config order), locked teasers at level 1's cost, no
 *   favorite pinning; round-capped tracks grouped after the buyable
 *   list and sorted by cost among themselves; maxed projects last,
 *   untouched.
 * - The mode is a per-tab device preference in localStorage, Default
 *   by default, never save data.
 * - The Open Source description explains the tab, with no em dashes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BALANCE,
  OPEN_SOURCE_IDS,
  initialSaveState,
  openSourceNextLevelCost,
  openSourceNextLevelNeedsRound,
  storeMaxRank,
} from "../../shared/game-balance.js";
import { sortOpenSourceProjectIds } from "../../client/src/utils/unlockProgress.js";
import {
  DEFAULT_SORT_MODE,
  SORT_MODES,
  SORT_TABS,
  readSortMode,
  setSortMode,
  sortIdsByCost,
  sortModeStorageKey,
  subscribeSortModes,
} from "../../client/src/utils/sortModes.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

/**
 * The pre-#180 sortOpenSourceProjectIds, verbatim: the Default oracle.
 * One change since: the round-cap check reads the company's Open Source
 * levels too, so a Bridge Round (issue #192) lifts the cap here exactly
 * as it does in the game.
 */
function legacyOrder(projectIds, state) {
  const maxed = new Set();
  const roundCapped = new Set();
  for (const id of projectIds) {
    const level = state.openSourceProjects?.[id]?.level ?? 0;
    const levelCount = BALANCE.openSource[id]?.levels?.length ?? 0;
    if (levelCount > 0 && level >= levelCount) maxed.add(id);
    else if (
      level > 0 &&
      openSourceNextLevelNeedsRound(
        id,
        level,
        state.permanentStoreRanks,
        state.openSourceProjects
      )
    ) {
      roundCapped.add(id);
    }
  }
  const favorites = new Set(state.favoriteOpenSourceProjects ?? []);
  const active = projectIds.filter((id) => !maxed.has(id) && !roundCapped.has(id));
  return [
    ...active.filter((id) => favorites.has(id)),
    ...active.filter((id) => !favorites.has(id)),
    ...projectIds.filter((id) => roundCapped.has(id)),
    ...projectIds.filter((id) => maxed.has(id)),
  ];
}

/** Deterministic PRNG so the sweep is reproducible. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function stateWith(levels, { favorites = [], round = 0 } = {}) {
  const state = initialSaveState();
  return {
    openSourceProjects: Object.fromEntries(
      OPEN_SOURCE_IDS.map((id) => [id, { level: levels[id] ?? 0 }])
    ),
    favoriteOpenSourceProjects: favorites,
    permanentStoreRanks: { ...state.permanentStoreRanks, fundingRounds: round },
  };
}

function randomState(rand) {
  const levels = {};
  for (const id of OPEN_SOURCE_IDS) {
    const count = BALANCE.openSource[id].levels.length;
    // Bias toward the interesting edges: 0, maxed, and in between.
    const roll = rand();
    levels[id] = roll < 0.25 ? 0 : roll < 0.4 ? count : Math.floor(rand() * (count + 1));
  }
  const favorites = OPEN_SOURCE_IDS.filter(() => rand() < 0.3);
  const round = Math.floor(rand() * (storeMaxRank("fundingRounds") + 1));
  return stateWith(levels, { favorites, round });
}

const levelOf = (state, id) => state.openSourceProjects[id].level;
const storeRankOf = (state) => state.permanentStoreRanks.fundingRounds;
const isMaxed = (state, id) => levelOf(state, id) >= BALANCE.openSource[id].levels.length;
const isRoundCapped = (state, id) =>
  !isMaxed(state, id) &&
  levelOf(state, id) > 0 &&
  openSourceNextLevelNeedsRound(
    id,
    levelOf(state, id),
    state.permanentStoreRanks,
    state.openSourceProjects
  );
const costOf = (state, id) =>
  openSourceNextLevelCost(id, levelOf(state, id), state.permanentStoreRanks);

// --- The shared ordering helper ---

test("sortIdsByCost: ascending, stable ties, non-finite costs sink (stable)", () => {
  const costs = { a: 5, b: 1, c: 5, d: NaN, e: 1, f: undefined, g: 0 };
  assert.deepEqual(
    sortIdsByCost(Object.keys(costs), (id) => costs[id]),
    ["g", "b", "e", "a", "c", "d", "f"]
  );
  assert.deepEqual(sortIdsByCost([], () => 1), []);
  // Does not mutate its input.
  const ids = ["a", "b"];
  sortIdsByCost(ids, (id) => (id === "a" ? 2 : 1));
  assert.deepEqual(ids, ["a", "b"]);
});

test("openSourceNextLevelCost: level 0 is level 1's cost; maxed, stale or unknown is null", () => {
  // With no ranks passed the Bridge Round reads its Bootstrapped price,
  // which is its level 1 cost, so every id follows the same rule here.
  for (const id of OPEN_SOURCE_IDS) {
    const levels = BALANCE.openSource[id].levels;
    assert.equal(openSourceNextLevelCost(id, 0), levels[0].locCost);
    for (let level = 0; level < levels.length; level += 1) {
      assert.equal(openSourceNextLevelCost(id, level), levels[level].locCost);
    }
    assert.equal(openSourceNextLevelCost(id, levels.length), null);
    assert.equal(openSourceNextLevelCost(id, levels.length + 3), null);
  }
  assert.equal(openSourceNextLevelCost("constellation", undefined), 1000);
  assert.equal(openSourceNextLevelCost("notAProject", 0), null);
});

// --- Default: today's order, exactly ---

test("Default mode reproduces the pre-#180 order exactly (sweep of 500 states)", () => {
  const rand = rng(180);
  for (let i = 0; i < 500; i += 1) {
    const state = randomState(rand);
    const expected = legacyOrder([...OPEN_SOURCE_IDS], state);
    assert.deepEqual(sortOpenSourceProjectIds([...OPEN_SOURCE_IDS], state), expected);
    assert.deepEqual(sortOpenSourceProjectIds([...OPEN_SOURCE_IDS], state, "default"), expected);
  }
});

// --- Cheapest ---

test("Cheapest: buyable by cost ascending, then round-capped by cost, then maxed in config order (sweep)", () => {
  const rand = rng(1800);
  for (let i = 0; i < 500; i += 1) {
    const state = randomState(rand);
    const sorted = sortOpenSourceProjectIds([...OPEN_SOURCE_IDS], state, "cheapest");
    assert.deepEqual([...sorted].sort(), [...OPEN_SOURCE_IDS].sort(), "same ids");
    const buyable = sorted.filter((id) => !isMaxed(state, id) && !isRoundCapped(state, id));
    const capped = sorted.filter((id) => isRoundCapped(state, id));
    const maxed = sorted.filter((id) => isMaxed(state, id));
    assert.deepEqual(sorted, [...buyable, ...capped, ...maxed], "groups in order");
    for (const all of [buyable, capped]) {
      // A next level with no price sinks to the end of its group, the
      // sortIdsByCost rule. The only one: a Bridge Round from Series B
      // on (issue #192), where none is offered and the tab hides it.
      const priced = (id) => Number.isFinite(costOf(state, id));
      const firstUnpriced = all.findIndex((id) => !priced(id));
      const group = firstUnpriced === -1 ? all : all.slice(0, firstUnpriced);
      assert.ok(all.slice(group.length).every((id) => !priced(id)), "unpriced sink last");
      for (const id of all.slice(group.length)) {
        assert.equal(id, "bridgeRound");
        assert.ok(storeRankOf(state) >= 3);
      }
      for (let j = 1; j < group.length; j += 1) {
        const prev = costOf(state, group[j - 1]);
        const cur = costOf(state, group[j]);
        assert.ok(prev <= cur, `cost ascending: ${group[j - 1]} ${prev} > ${group[j]} ${cur}`);
        if (prev === cur) {
          assert.ok(
            OPEN_SOURCE_IDS.indexOf(group[j - 1]) < OPEN_SOURCE_IDS.indexOf(group[j]),
            "ties keep config order"
          );
        }
      }
    }
    assert.deepEqual(maxed, OPEN_SOURCE_IDS.filter((id) => isMaxed(state, id)), "maxed untouched");
  }
});

test("Cheapest: a fresh company (all locked teasers) orders by level 1 cost, ties in config order", () => {
  const state = stateWith({});
  const sorted = sortOpenSourceProjectIds([...OPEN_SOURCE_IDS], state, "cheapest");
  assert.deepEqual(sorted.slice(0, 6), [
    "overReactFramework", // 100
    "constellation", // 1,000
    "blocker", // 2,000
    "starBroker", // 10,000 (tie with Launch Pad: config order)
    "launchPad", // 10,000
    "moonshot", // 20,000
  ]);
  assert.equal(openSourceNextLevelCost("starBroker", 0), openSourceNextLevelCost("launchPad", 0));
});

test("Cheapest: buying raises the next cost, so the card sinks live", () => {
  const before = sortOpenSourceProjectIds([...OPEN_SOURCE_IDS], stateWith({}), "cheapest");
  assert.equal(before[0], "overReactFramework");
  // OverReact at L3: next is 6,100, now above Constellation's 1,000 and Blocker's 2,000.
  const after = sortOpenSourceProjectIds(
    [...OPEN_SOURCE_IDS],
    stateWith({ overReactFramework: 3 }),
    "cheapest"
  );
  assert.deepEqual(after.slice(0, 3), ["constellation", "blocker", "overReactFramework"]);
});

test("Cheapest does not pin favorites; Default still does", () => {
  const state = stateWith({}, { favorites: ["shipHappens"] });
  assert.equal(sortOpenSourceProjectIds([...OPEN_SOURCE_IDS], state)[0], "shipHappens");
  const cheapest = sortOpenSourceProjectIds([...OPEN_SOURCE_IDS], state, "cheapest");
  assert.notEqual(cheapest[0], "shipHappens");
  assert.equal(cheapest[0], "overReactFramework");
});

test("Cheapest: round-capped tracks group after buyable ones, by cost; maxed stay last", () => {
  // Bootstrapped (round 0): Senior Moment at L6 and CoffeeScript at L6
  // are at their cap. Blocker is maxed (5 levels).
  const state = stateWith({
    seniorMoment: 6,
    coffeeScript: 6,
    blocker: 5,
    overReactFramework: 9,
    // The Bridge Round (issue #192) at level 0: buyable at 1B, far
    // pricier than CoffeeScript's gated L7. (Ship Happens is gated too
    // since #192, so it no longer serves as the pricey buyable card.)
  });
  assert.ok(isRoundCapped(state, "seniorMoment") && isRoundCapped(state, "coffeeScript"));
  const sorted = sortOpenSourceProjectIds([...OPEN_SOURCE_IDS], state, "cheapest");
  const tail = sorted.slice(-3);
  // CoffeeScript L7 (24.4M) is cheaper than Senior Moment L7 (122M),
  // so it comes first even though Senior Moment's cap is the same.
  assert.ok(costOf(state, "coffeeScript") < costOf(state, "seniorMoment"));
  assert.deepEqual(tail, ["coffeeScript", "seniorMoment", "blocker"]);
  // The round-capped pair sits below every buyable card, even pricier ones.
  assert.ok(!isRoundCapped(state, "bridgeRound") && !isMaxed(state, "bridgeRound"));
  assert.ok(costOf(state, "bridgeRound") > costOf(state, "coffeeScript"));
  assert.ok(sorted.indexOf("bridgeRound") < sorted.indexOf("coffeeScript"));
});

test("an unknown mode falls back to Default", () => {
  const state = randomState(rng(7));
  assert.deepEqual(
    sortOpenSourceProjectIds([...OPEN_SOURCE_IDS], state, "bogus"),
    legacyOrder([...OPEN_SOURCE_IDS], state)
  );
});

// --- The device preference ---

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

test("sort mode preference: Default by default, per tab, persisted under grq:sortMode:<tab>", () => {
  assert.deepEqual(SORT_MODES.map((mode) => mode.id), ["default", "cheapest"]);
  assert.equal(DEFAULT_SORT_MODE, "default");
  assert.ok(SORT_TABS.includes("openSource"));
  const storage = fakeStorage();
  assert.equal(readSortMode("openSource", storage), "default");
  let notified = 0;
  const unsubscribe = subscribeSortModes(() => (notified += 1));
  setSortMode("openSource", "cheapest", storage);
  assert.equal(storage.map.get(sortModeStorageKey("openSource")), "cheapest");
  assert.equal(sortModeStorageKey("openSource"), "grq:sortMode:openSource");
  assert.equal(readSortMode("openSource", storage), "cheapest");
  assert.equal(notified, 1);
  // Junk values and unknown modes are ignored.
  setSortMode("openSource", "priciest", storage);
  assert.equal(readSortMode("openSource", storage), "cheapest");
  storage.setItem(sortModeStorageKey("openSource"), "garbage");
  assert.equal(readSortMode("openSource", storage), "cheapest", "falls back to the session value");
  setSortMode("openSource", "default", storage);
  assert.equal(readSortMode("openSource", storage), "default");
  // Unknown tabs read Default and never write.
  setSortMode("notATab", "cheapest", storage);
  assert.equal(storage.map.has(sortModeStorageKey("notATab")), false);
  assert.equal(readSortMode("notATab", storage), "default");
  unsubscribe();
});

test("sort mode preference survives a storage that throws (session memory)", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  setSortMode("openSource", "cheapest", broken);
  assert.equal(readSortMode("openSource", broken), "cheapest");
  setSortMode("openSource", "default", broken);
  assert.equal(readSortMode("openSource", broken), "default");
});

test("the sort mode is not save data", () => {
  const save = JSON.stringify(initialSaveState());
  assert.ok(!/sortMode/i.test(save));
  assert.ok(!/sortMode/i.test(src("save/serialize.js")));
});

// --- Wiring (source checks: the components import React) ---

test("Open Source renders the shared SortControl and sorts by its mode, costs from one helper", () => {
  const os = src("components/OpenSource.jsx");
  assert.match(os, /import \{ SortControl \} from "\.\/SortControl\.jsx"/);
  assert.match(os, /<SortControl tab="openSource" \/>/);
  assert.match(os, /useSortMode\("openSource"\)/);
  assert.match(os, /sortOpenSourceProjectIds\(\s*Object\.keys\(OPEN_SOURCE_PROJECTS_CONFIG\),\s*state,\s*sortMode\s*\)/);
  // The card's cost, the locked teaser's cost and the reducer's charge
  // all come from openSourceNextLevelCost.
  // The Bridge Round (issue #192) is priced by round, so the ranks go in.
  assert.match(
    os,
    /locCost=\{openSourceNextLevelCost\(\s*id,\s*0,\s*state\.permanentStoreRanks\s*\)\}/
  );
  // The unlocked card's cost comes from its model (issue #179).
  assert.match(os, /openSourceCardModel\(id, state\)/);
  assert.match(
    src("utils/openSourceCard.js"),
    /openSourceNextLevelCost\(projectId, currentLevel, state\.permanentStoreRanks\)/
  );
  assert.ok(!/\.locCost\b/.test(os), "no hand-read level cost in the tab");
  const context = src("context/GameContext.jsx");
  assert.match(
    context,
    /const cost = shared\.openSourceNextLevelCost\(\s*projectId,\s*projectState\.level,\s*state\.permanentStoreRanks\s*\)/
  );
  // The control is the shared Button toggle group, reading the shared hook.
  const control = src("components/SortControl.jsx");
  assert.match(control, /useSortMode\(tab\)/);
  assert.match(control, /SORT_MODES\.map/);
  assert.match(control, /<Button/);
  assert.match(control, /ariaPressed=\{mode === option\.id\}/);
  assert.ok(!control.includes("—"));
});

// --- The Open Source description ---

test("the Open Source description explains the tab, in voice, with no em dashes", () => {
  const config = src("context/gameConfig.js");
  const block = config.slice(config.indexOf("  openSource: {"), config.indexOf("  farm: {"));
  const text = block.match(/description:\s*"([^"]+)"/)[1];
  assert.ok(!text.includes("Contribute your LOC to open-source projects to unlock"), "stub gone");
  assert.ok(!text.includes("—") && !text.includes("–"), "no em or en dash");
  assert.match(text, /Every level costs LOC/);
  assert.match(text, /last as long as this company does/);
  assert.match(text, /selling the company resets them/);
  assert.match(text, /make one kind of employee wildly more productive/);
  assert.match(text, /clicking/);
  assert.match(text, /Constellation is where the golden stars come from, with StarBroker, Moonshot/);
  assert.match(text, /Funding Rounds, which you buy with Equity after a sale/);
  assert.match(text, /Star a project to favorite it and pin it to the top/);
  assert.match(text, /Maxed Out at the bottom/);
});
