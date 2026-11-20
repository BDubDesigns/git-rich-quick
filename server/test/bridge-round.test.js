/**
 * Tests for Bridge Rounds and the Ship Happens gate (issue #192,
 * design in #187, folds in #186).
 *
 * - Bridge Round: one Open Source level, bought with LOC, priced
 *   1B / 14B / 200B at Funding Rounds rank 0 / 1 / 2 and not offered
 *   from Series B on. Owning it lifts every gated track's cap to the
 *   next round's for this company. It resets on sale.
 * - Ship Happens: gated at 1 / 3 / 6 / 8 / 9 / 10 by rank, bridged to
 *   3 / 6 / 8 at ranks 0 / 1 / 2. Power unchanged (2x ships per level).
 * - One helper (openSourceLevelCap) gives the reducer, the card and the
 *   validator the same effective cap, so they are pinned here through
 *   the helper and the validator, and the reducer's wiring by source.
 *
 * The click invariant at the bridged plateaus lives in
 * click-balance.test.js; the schema 3 wipe in save-wipe-email.test.js
 * and funding-rounds.test.js.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { validateSave } from "../src/validate.js";
import {
  BALANCE,
  BRIDGE_ROUND_PROJECT_ID,
  BRIDGE_ROUND_UNLOCK_TOTAL_LOC,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  FUNDING_ROUNDS_CONFIG,
  OPEN_SOURCE_DISPLAY_NAMES,
  OPEN_SOURCE_IDS,
  applyPrestigeSale,
  bridgeRoundAvailable,
  bridgeRoundOwned,
  bridgeRoundPrice,
  effectiveFundingRoundRank,
  equityThresholdLoc,
  initialSaveState,
  isRoundGatedProject,
  normalizeSaveState,
  openSourceLevelCap,
  openSourceLevelCosts,
  openSourceNextLevelCost,
  openSourceNextLevelNeedsRound,
  openSourceUnlockConditionsMet,
  releaseManagerShipsPerInterval,
} from "../../shared/game-balance.js";
import { openSourceCardModel } from "../../client/src/utils/openSourceCard.js";
import {
  bridgeRoundCapsText,
  bridgeRoundFloatText,
  bridgeRoundOfferText,
  bridgeRoundOwnedText,
  bridgeRoundTargetName,
} from "../../client/src/utils/bridgeRound.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
const RANKS = [0, 1, 2, 3, 4, 5];
const GATED = Object.keys(FUNDING_ROUNDS_CONFIG.levelCaps);
const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const ranksAt = (rank) => ({ ...initialSaveState().permanentStoreRanks, fundingRounds: rank });

function zeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function zeroActions() {
  return {
    clicks: 0,
    employeesBought: zeroCounts(EMPLOYEE_TYPES),
    projectsCompleted: zeroCounts(FREELANCE_PROJECT_KEYS),
    autoShips: zeroCounts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: zeroCounts(OPEN_SOURCE_IDS),
  };
}

/** A save at a Funding Rounds rank with some Open Source levels. */
function saveAt(rank, levels = {}) {
  const state = initialSaveState();
  state.permanentStoreRanks = ranksAt(rank);
  state.openSourceProjects = { ...state.openSourceProjects, ...levels };
  return state;
}

/** Validate a save at `rank` holding `levels`, against the same rank with nothing bought. */
function validateAt(rank, levels) {
  return validateSave(
    { state: saveAt(rank), savedAtMs: T0 },
    { playerId: PLAYER_ID, state: saveAt(rank, levels), actionsSinceLastSave: zeroActions() },
    T0 + 60_000
  );
}

// --- Config ---

test("config: one level, the locked prices, a late id that defaults to 0", () => {
  assert.equal(BRIDGE_ROUND_PROJECT_ID, "bridgeRound");
  assert.ok(OPEN_SOURCE_IDS.includes("bridgeRound"));
  assert.equal(OPEN_SOURCE_DISPLAY_NAMES.bridgeRound, "Bridge Round");
  assert.deepEqual(
    [...FUNDING_ROUNDS_CONFIG.bridgeRoundPrices],
    [1_000_000_000, 14_000_000_000, 200_000_000_000]
  );
  const levels = BALANCE.openSource.bridgeRound.levels;
  assert.equal(levels.length, 1);
  assert.deepEqual({ ...levels[0].bonus }, { type: "BRIDGE", value: 0 });
  // Not a gated track itself, and no LOC formula reads it.
  assert.equal(isRoundGatedProject("bridgeRound"), false);
  assert.equal(releaseManagerShipsPerInterval({ bridgeRound: 1 }), 1);
  // Each price is about 40% of the tier it opens, rounded clean.
  RANKS.slice(0, 3).forEach((rank) => {
    let tier = 0;
    for (const id of GATED.filter((x) => x !== "shipHappens")) {
      const caps = FUNDING_ROUNDS_CONFIG.levelCaps[id];
      tier += openSourceLevelCosts(id, caps[rank], caps[rank + 1]);
    }
    const ratio = FUNDING_ROUNDS_CONFIG.bridgeRoundPrices[rank] / tier;
    assert.ok(ratio > 0.38 && ratio < 0.41, `rank ${rank}: ${ratio.toFixed(3)}`);
  });
});

test("unlock: 100M lifetime LOC, and a fresh save starts locked at level 0", () => {
  assert.equal(BRIDGE_ROUND_UNLOCK_TOTAL_LOC, 100_000_000);
  const fresh = initialSaveState();
  assert.equal(fresh.openSourceProjects.bridgeRound, 0);
  assert.equal(fresh.unlockedOpenSourceProjects.bridgeRound, false);
  assert.equal(openSourceUnlockConditionsMet("bridgeRound", { totalLinesOfCode: 99_999_999, employees: {} }), false);
  assert.equal(openSourceUnlockConditionsMet("bridgeRound", { totalLinesOfCode: 100_000_000, employees: {} }), true);
});

test("an old save with no bridgeRound key normalizes to 0 and validates (the Moonshot pattern)", () => {
  const old = initialSaveState();
  delete old.openSourceProjects.bridgeRound;
  delete old.unlockedOpenSourceProjects.bridgeRound;
  const normalized = normalizeSaveState(old);
  assert.equal(normalized.openSourceProjects.bridgeRound, 0);
  assert.equal(normalized.unlockedOpenSourceProjects.bridgeRound, false);
  const r = validateSave(
    { state: initialSaveState(), savedAtMs: T0 },
    { playerId: PLAYER_ID, state: old, actionsSinceLastSave: zeroActions() },
    T0 + 60_000
  );
  assert.equal(r.ok, true, JSON.stringify(r));
});

// --- Price and the rank gate ---

test("price by rank: 1B / 14B / 200B, none from Series B on, and no second level", () => {
  const expected = [1_000_000_000, 14_000_000_000, 200_000_000_000, null, null, null];
  RANKS.forEach((rank) => {
    const ranks = ranksAt(rank);
    assert.equal(bridgeRoundAvailable(ranks), rank < 3, `rank ${rank}`);
    assert.equal(bridgeRoundPrice(ranks), expected[rank], `rank ${rank}`);
    assert.equal(openSourceNextLevelCost("bridgeRound", 0, ranks), expected[rank], `rank ${rank}`);
    // Once per company: an owned bridge has no next level at any rank.
    assert.equal(openSourceNextLevelCost("bridgeRound", 1, ranks), null);
  });
  // No ranks passed reads Bootstrapped.
  assert.equal(openSourceNextLevelCost("bridgeRound", 0), 1_000_000_000);
  assert.equal(bridgeRoundPrice({ fundingRounds: Number.NaN }), 1_000_000_000);
});

test("the Bridge Round's own cap: 1 at Bootstrapped, Seed and Series A, 0 from Series B on", () => {
  assert.deepEqual(
    RANKS.map((rank) => openSourceLevelCap("bridgeRound", ranksAt(rank))),
    [1, 1, 1, 0, 0, 0]
  );
  // It is never "round-locked": past Series A it is simply not offered.
  for (const rank of RANKS) {
    assert.equal(openSourceNextLevelNeedsRound("bridgeRound", 0, ranksAt(rank)), false);
  }
});

// --- The effect: next round's caps ---

test("bridged, every gated track reads the next round's cap; unbridged, its own", () => {
  for (const id of GATED) {
    const caps = FUNDING_ROUNDS_CONFIG.levelCaps[id];
    for (const rank of RANKS) {
      const ranks = ranksAt(rank);
      assert.equal(openSourceLevelCap(id, ranks), caps[rank], `${id} rank ${rank}`);
      assert.equal(openSourceLevelCap(id, ranks, { bridgeRound: 0 }), caps[rank], `${id} rank ${rank}`);
      // A bridge lifts one round, only where one is offered: a stray
      // level from Series B on never reaches past the owned round.
      const bridged = rank < 3 ? caps[rank + 1] : caps[rank];
      assert.equal(openSourceLevelCap(id, ranks, { bridgeRound: 1 }), bridged, `${id} rank ${rank} bridged`);
    }
  }
  // Ungated projects are unaffected.
  for (const id of ["overReactFramework", "blocker", "constellation", "starBroker", "moonshot", "launchPad"]) {
    assert.equal(
      openSourceLevelCap(id, ranksAt(0), { bridgeRound: 1 }),
      BALANCE.openSource[id].levels.length
    );
  }
});

test("effective rank and ownership read both level shapes and junk safely", () => {
  assert.equal(bridgeRoundOwned({ bridgeRound: 1 }), true);
  assert.equal(bridgeRoundOwned({ bridgeRound: { level: 1 } }), true);
  for (const junk of [{}, { bridgeRound: 0 }, { bridgeRound: { level: 0 } }, { bridgeRound: Number.NaN }, { bridgeRound: -1 }, { bridgeRound: null }, null, undefined]) {
    assert.equal(bridgeRoundOwned(junk), false, JSON.stringify(junk));
  }
  assert.deepEqual(
    RANKS.map((rank) => effectiveFundingRoundRank(ranksAt(rank), { bridgeRound: { level: 1 } })),
    [1, 2, 3, 3, 4, 5]
  );
  assert.deepEqual(RANKS.map((rank) => effectiveFundingRoundRank(ranksAt(rank))), RANKS);
});

test("Ship Happens caps at every rank (1 / 3 / 6 / 8 / 9 / 10) and bridged (3 / 6 / 8)", () => {
  assert.ok(isRoundGatedProject("shipHappens"));
  assert.equal(BALANCE.openSource.shipHappens.levels.length, 10);
  assert.deepEqual(
    RANKS.map((rank) => openSourceLevelCap("shipHappens", ranksAt(rank))),
    [1, 3, 6, 8, 9, 10]
  );
  assert.deepEqual(
    [0, 1, 2].map((rank) => openSourceLevelCap("shipHappens", ranksAt(rank), { bridgeRound: 1 })),
    [3, 6, 8]
  );
  // Power unchanged: 2x whole ships per level.
  assert.deepEqual(
    [1, 3, 6, 8, 9, 10].map((level) => releaseManagerShipsPerInterval({ shipHappens: level })),
    [2, 8, 64, 256, 512, 1024]
  );
  for (const level of BALANCE.openSource.shipHappens.levels) {
    assert.deepEqual({ ...level.bonus }, { type: "MULTIPLY", value: 2 });
  }
});

// --- The validator ---

test("validator: levels up to the bridged cap pass, one above is a SHAPE rejection", () => {
  for (const rank of [0, 1, 2]) {
    for (const id of GATED) {
      const caps = FUNDING_ROUNDS_CONFIG.levelCaps[id];
      const top = caps[rank + 1];
      const ok = validateAt(rank, { bridgeRound: 1, [id]: top });
      assert.equal(ok.ok, true, `${id} rank ${rank}: ${JSON.stringify(ok)}`);
      if (top < BALANCE.openSource[id].levels.length) {
        const over = validateAt(rank, { bridgeRound: 1, [id]: top + 1 });
        assert.equal(over.ok, false, `${id} rank ${rank} over`);
        assert.equal(over.rule, "SHAPE");
        assert.match(over.detail, new RegExp(`0-${top}\\b`));
      }
      // Without the bridge, the next round's cap is still out of reach.
      if (top > caps[rank]) {
        const unbridged = validateAt(rank, { [id]: top });
        assert.equal(unbridged.ok, false, `${id} rank ${rank} unbridged`);
        assert.equal(unbridged.rule, "SHAPE");
      }
    }
  }
});

test("validator: once per company and the rank gate", () => {
  // Bought at Bootstrapped, Seed or Series A.
  for (const rank of [0, 1, 2]) {
    assert.equal(validateAt(rank, { bridgeRound: 1 }).ok, true, `rank ${rank}`);
    const twice = validateAt(rank, { bridgeRound: 2 });
    assert.equal(twice.ok, false);
    assert.equal(twice.rule, "SHAPE");
  }
  // Never from Series B on.
  for (const rank of [3, 4, 5]) {
    const r = validateAt(rank, { bridgeRound: 1 });
    assert.equal(r.ok, false, `rank ${rank}`);
    assert.equal(r.rule, "SHAPE");
    assert.match(r.detail, /0-0/);
  }
  // So a Series B company holds its own caps: a Series C level is out
  // of reach (and a stray bridge level lifts nothing, pinned above in
  // the cap helper test).
  const seriesB = validateAt(3, { coffeeScript: 18 });
  assert.equal(seriesB.ok, false);
  assert.equal(seriesB.rule, "SHAPE");
});

test("validator: the bridge cannot be un-bought within a company", () => {
  const r = validateSave(
    { state: saveAt(0, { bridgeRound: 1 }), savedAtMs: T0 },
    { playerId: PLAYER_ID, state: saveAt(0), actionsSinceLastSave: zeroActions() },
    T0 + 60_000
  );
  assert.equal(r.ok, false);
  assert.equal(r.rule, "MONOTONIC");
});

// --- The sale ---

test("resets on sale: the bridge and the bridged levels go back to 0, the rank stays", () => {
  const pre = initialSaveState();
  pre.totalLinesOfCode = equityThresholdLoc(26);
  pre.lifetimeEquityEarned = 7;
  pre.equitySpent = 5;
  pre.permanentStoreRanks = ranksAt(1);
  pre.openSourceProjects = {
    ...pre.openSourceProjects,
    bridgeRound: 1,
    coffeeScript: 12,
    commitmentIssues: 10,
    shipHappens: 6,
  };
  const post = applyPrestigeSale(pre, randomUUID());
  assert.equal(post.openSourceProjects.bridgeRound, 0);
  assert.equal(post.openSourceProjects.coffeeScript, 0);
  assert.equal(post.openSourceProjects.shipHappens, 0);
  assert.equal(post.permanentStoreRanks.fundingRounds, 1);
  // The new company reads Seed caps until it buys a bridge again.
  assert.equal(openSourceLevelCap("coffeeScript", post.permanentStoreRanks, post.openSourceProjects), 9);
  assert.equal(openSourceNextLevelCost("bridgeRound", post.openSourceProjects.bridgeRound, post.permanentStoreRanks), 14_000_000_000);
});

// --- The card ---

/** The client reducer's state shape: levels as { level }. */
function clientState(rank, levels = {}, linesOfCode = 1e15) {
  return {
    linesOfCode,
    openSourceProjects: Object.fromEntries(
      OPEN_SOURCE_IDS.map((id) => [id, { level: levels[id] ?? 0 }])
    ),
    permanentStoreRanks: ranksAt(rank),
  };
}

test("card model: priced by rank, affordable or not, then rented until the sale", () => {
  const offer = openSourceCardModel("bridgeRound", clientState(1));
  assert.equal(offer.locCost, 14_000_000_000);
  assert.equal(offer.canContribute, true);
  assert.equal(offer.lockedRoundName, null);
  const short = openSourceCardModel("bridgeRound", clientState(1, {}, 13_999_999_999));
  assert.equal(short.canContribute, false);
  const owned = openSourceCardModel("bridgeRound", clientState(1, { bridgeRound: 1 }));
  assert.equal(owned.isMaxed, true);
  assert.equal(owned.canContribute, false);
});

test("card model: a bridged track opens to the next cap, then names the real round it needs", () => {
  const unbridged = openSourceCardModel("seniorMoment", clientState(0, { seniorMoment: 6 }));
  assert.equal(unbridged.canContribute, false);
  assert.equal(unbridged.lockedRoundName, "Seed");
  const bridged = openSourceCardModel("seniorMoment", clientState(0, { seniorMoment: 6, bridgeRound: 1 }));
  assert.equal(bridged.canContribute, true);
  assert.equal(bridged.lockedRoundName, null);
  const top = openSourceCardModel("seniorMoment", clientState(0, { seniorMoment: 9, bridgeRound: 1 }));
  assert.equal(top.canContribute, false);
  assert.equal(top.lockedRoundName, "Series A");
  const ship = openSourceCardModel("shipHappens", clientState(0, { shipHappens: 1 }));
  assert.equal(ship.lockedRoundName, "Seed");
});

test("card copy: what it rents, at each rank, from the shared caps", () => {
  assert.equal(bridgeRoundTargetName(ranksAt(0)), "Seed");
  assert.equal(bridgeRoundTargetName(ranksAt(1)), "Series A");
  assert.equal(bridgeRoundTargetName(ranksAt(2)), "Series B");
  assert.equal(bridgeRoundTargetName(ranksAt(3)), null);
  assert.equal(
    bridgeRoundCapsText(ranksAt(0)),
    "CoffeeScript, Junior Achievement and Senior Moment to v.9.0, Scrum Master to v.8.0, Commitment Issues to v.8.0, Ship Happens to v.3.0"
  );
  assert.equal(
    bridgeRoundCapsText(ranksAt(2)),
    "CoffeeScript, Junior Achievement and Senior Moment to v.15.0, Scrum Master to v.14.0, Commitment Issues to v.12.0, Ship Happens to v.8.0"
  );
  assert.match(bridgeRoundOfferText(ranksAt(1)), /^Rents Series A caps for this company: /);
  assert.equal(bridgeRoundOfferText(ranksAt(4)), null);
  assert.match(bridgeRoundOwnedText(ranksAt(0)), /until you sell/);
  assert.equal(bridgeRoundFloatText(ranksAt(0)), "Bridged to Seed!");
});

test("card copy: the description says plainly what it does, with zero em or en dashes", () => {
  const config = src("context/gameConfig.js");
  const start = config.indexOf("bridgeRound: {");
  assert.ok(start > 0);
  const block = config.slice(start, config.indexOf("},", start));
  const description = block.match(/description:\s*"([^"]+)"/)[1];
  // Rent the next round's caps, this company only, normal level prices,
  // resets on sale, and the real round makes them permanent and free.
  assert.match(description, /next round's level caps/);
  assert.match(description, /this company only/);
  assert.match(description, /normal price/);
  assert.match(description, /resets when you sell/);
  assert.match(description, /permanent and free/);
  const copy = [
    description,
    ...RANKS.flatMap((rank) => [
      bridgeRoundOfferText(ranksAt(rank)),
      bridgeRoundOwnedText(ranksAt(rank)),
      bridgeRoundFloatText(ranksAt(rank)),
    ]).filter(Boolean),
  ];
  for (const text of copy) {
    assert.ok(!text.includes("—"), `no em dash: ${text}`);
    assert.ok(!text.includes("–"), `no en dash: ${text}`);
  }
  // The card copy branch itself has no dashes either.
  const helper = src("utils/bridgeRound.js");
  assert.ok(!helper.includes("—") && !helper.includes("–"));
});

// --- Wiring (source checks: these files import React) ---

test("the reducer, the tab and the card read the one cap helper and the ranked price", () => {
  const context = src("context/GameContext.jsx");
  assert.match(
    context,
    /shared\.openSourceLevelCap\(\s*projectId,\s*state\.permanentStoreRanks,\s*state\.openSourceProjects\s*\)/
  );
  assert.match(
    context,
    /shared\.openSourceNextLevelCost\(\s*projectId,\s*projectState\.level,\s*state\.permanentStoreRanks\s*\)/
  );
  const tab = src("components/OpenSource.jsx");
  // Not shown from Series B on.
  assert.match(tab, /id === BRIDGE_ROUND_PROJECT_ID &&\s*!bridgeRoundAvailable\(state\.permanentStoreRanks\)/);
  const card = src("components/OpenSourceCard.jsx");
  assert.match(card, /<Panel /);
  assert.match(card, /bridgeRoundOfferText\(storeRanks\)/);
  assert.match(src("components/LockedOpenSourceCard.jsx"), /bridgeRoundOfferText\(storeRanks\)/);
  const validate = readFileSync(new URL("../src/validate.js", import.meta.url), "utf8");
  assert.match(
    validate,
    /openSourceLevelCap\(\s*projectId,\s*state\.permanentStoreRanks,\s*state\.openSourceProjects\s*\)/
  );
});
