/**
 * Tests for Bridge Rounds and the Ship Happens gate (issue #192,
 * design in #187, folds in #186).
 *
 * - Bridge Round: one Open Source level, bought with LOC, priced
 *   1B / 14B / 200B / 3T / 49T at Funding Rounds rank 0 to 4 (issue
 *   #226 extended it to Series B and Series C) and not offered at IPO
 *   (rank 5), where the card shows closed: there is no next round.
 *   Owning it lifts every gated track's cap to the next round's for
 *   this company. It resets on sale.
 * - Ship Happens: gated at 1 / 3 / 6 / 8 / 9 / 10 by rank, bridged to
 *   3 / 6 / 8 / 9 / 10 at ranks 0 to 4. Power unchanged (2x ships per
 *   level).
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
  fundingRoundName,
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
  bridgeRoundClosed,
  bridgeRoundClosedText,
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
    [1_000_000_000, 14_000_000_000, 200_000_000_000, 3_000_000_000_000, 49_000_000_000_000]
  );
  const levels = BALANCE.openSource.bridgeRound.levels;
  assert.equal(levels.length, 1);
  assert.deepEqual({ ...levels[0].bonus }, { type: "BRIDGE", value: 0 });
  // Not a gated track itself, and no LOC formula reads it.
  assert.equal(isRoundGatedProject("bridgeRound"), false);
  assert.equal(releaseManagerShipsPerInterval({ bridgeRound: 1 }), 1);
  // Each price is about 40% of the tier it opens, rounded clean
  // (Series B to C: 7.865T, so 3T; Series C to IPO: 121.66T, so 49T).
  RANKS.slice(0, 5).forEach((rank) => {
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

test("price by rank: 1B / 14B / 200B / 3T / 49T, none at IPO, and no second level", () => {
  const expected = [1_000_000_000, 14_000_000_000, 200_000_000_000, 3_000_000_000_000, 49_000_000_000_000, null];
  RANKS.forEach((rank) => {
    const ranks = ranksAt(rank);
    assert.equal(bridgeRoundAvailable(ranks), rank < 5, `rank ${rank}`);
    assert.equal(bridgeRoundPrice(ranks), expected[rank], `rank ${rank}`);
    assert.equal(openSourceNextLevelCost("bridgeRound", 0, ranks), expected[rank], `rank ${rank}`);
    // Once per company: an owned bridge has no next level at any rank.
    assert.equal(openSourceNextLevelCost("bridgeRound", 1, ranks), null);
  });
  // No ranks passed reads Bootstrapped.
  assert.equal(openSourceNextLevelCost("bridgeRound", 0), 1_000_000_000);
  assert.equal(bridgeRoundPrice({ fundingRounds: Number.NaN }), 1_000_000_000);
});

test("the Bridge Round's own cap: 1 at every round through Series C, 0 at IPO", () => {
  assert.deepEqual(
    RANKS.map((rank) => openSourceLevelCap("bridgeRound", ranksAt(rank))),
    [1, 1, 1, 1, 1, 0]
  );
  // It is never "round-locked": at IPO it is simply not offered.
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
      // level at IPO never reaches past the last round.
      const bridged = rank < 5 ? caps[rank + 1] : caps[rank];
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
    [1, 2, 3, 4, 5, 5]
  );
  assert.deepEqual(RANKS.map((rank) => effectiveFundingRoundRank(ranksAt(rank))), RANKS);
});

test("Ship Happens caps at every rank (1 / 3 / 6 / 8 / 9 / 10) and bridged (3 / 6 / 8 / 9 / 10)", () => {
  assert.ok(isRoundGatedProject("shipHappens"));
  assert.equal(BALANCE.openSource.shipHappens.levels.length, 10);
  assert.deepEqual(
    RANKS.map((rank) => openSourceLevelCap("shipHappens", ranksAt(rank))),
    [1, 3, 6, 8, 9, 10]
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((rank) => openSourceLevelCap("shipHappens", ranksAt(rank), { bridgeRound: 1 })),
    [3, 6, 8, 9, 10]
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
  for (const rank of [0, 1, 2, 3, 4]) {
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
  // Bought at any round through Series C.
  for (const rank of [0, 1, 2, 3, 4]) {
    assert.equal(validateAt(rank, { bridgeRound: 1 }).ok, true, `rank ${rank}`);
    const twice = validateAt(rank, { bridgeRound: 2 });
    assert.equal(twice.ok, false);
    assert.equal(twice.rule, "SHAPE");
  }
  // Never at IPO: there is no next round.
  const ipo = validateAt(5, { bridgeRound: 1 });
  assert.equal(ipo.ok, false);
  assert.equal(ipo.rule, "SHAPE");
  assert.match(ipo.detail, /0-0/);
  // Series B and Series C reach the next round's caps only with the
  // bridge: without it, a level past their own cap is out of reach.
  for (const [rank, coffee] of [[3, 18], [4, 21]]) {
    const unbridged = validateAt(rank, { coffeeScript: coffee });
    assert.equal(unbridged.ok, false, `rank ${rank} unbridged`);
    assert.equal(unbridged.rule, "SHAPE");
    assert.equal(validateAt(rank, { bridgeRound: 1, coffeeScript: coffee }).ok, true, `rank ${rank} bridged`);
  }
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

test("issue #226: buying at Series B and Series C lifts the caps to the next round's row, and resets on sale", () => {
  // Series B + bridge: engineers 18, Scrum 17, Commitment Issues 14,
  // Ship Happens 9. Series C + bridge: 21, 20, 16, 10 (the IPO row).
  const rows = {
    3: { price: 3_000_000_000_000, caps: { coffeeScript: 18, juniorAchievement: 18, seniorMoment: 18, scrumMaster: 17, commitmentIssues: 14, shipHappens: 9 } },
    4: { price: 49_000_000_000_000, caps: { coffeeScript: 21, juniorAchievement: 21, seniorMoment: 21, scrumMaster: 20, commitmentIssues: 16, shipHappens: 10 } },
  };
  for (const [rankText, { price, caps }] of Object.entries(rows)) {
    const rank = Number(rankText);
    // The purchase: the card prices it, and owning it opens each track
    // past its own round's cap (the next level becomes buyable).
    const offer = openSourceCardModel("bridgeRound", clientState(rank));
    assert.equal(offer.locCost, price);
    assert.equal(offer.canContribute, true);
    const owned = clientState(rank, { bridgeRound: 1 });
    for (const [id, cap] of Object.entries(caps)) {
      assert.equal(openSourceLevelCap(id, ranksAt(rank), owned.openSourceProjects), cap, `${id} rank ${rank}`);
      assert.deepEqual(cap, FUNDING_ROUNDS_CONFIG.levelCaps[id][rank + 1]);
      const own = FUNDING_ROUNDS_CONFIG.levelCaps[id][rank];
      const before = openSourceCardModel(id, clientState(rank, { [id]: own }));
      assert.equal(before.canContribute, false, `${id} held at its own cap`);
      const after = openSourceCardModel(id, clientState(rank, { [id]: own, bridgeRound: 1 }));
      assert.equal(after.canContribute, true, `${id} opened by the bridge`);
    }
    // The sale resets it: the next company holds its own caps again and
    // is offered the bridge again at the same price.
    const pre = initialSaveState();
    pre.totalLinesOfCode = equityThresholdLoc(200);
    pre.lifetimeEquityEarned = 150;
    pre.permanentStoreRanks = ranksAt(rank);
    pre.openSourceProjects = { ...pre.openSourceProjects, bridgeRound: 1, coffeeScript: caps.coffeeScript, shipHappens: caps.shipHappens };
    const post = applyPrestigeSale(pre, randomUUID());
    assert.equal(post.openSourceProjects.bridgeRound, 0);
    assert.equal(post.openSourceProjects.coffeeScript, 0);
    assert.equal(post.permanentStoreRanks.fundingRounds, rank);
    assert.equal(openSourceLevelCap("coffeeScript", post.permanentStoreRanks, post.openSourceProjects), FUNDING_ROUNDS_CONFIG.levelCaps.coffeeScript[rank]);
    assert.equal(openSourceNextLevelCost("bridgeRound", 0, post.permanentStoreRanks), price);
  }
});

test("issue #226: the structural stop at IPO: no bridge, because there is no rank 6 caps row", () => {
  // IPO is the last round: rank 5 is the top of every caps row, so there
  // is nothing to rent, and bridgeRoundAvailable says so.
  assert.equal(FUNDING_ROUNDS_CONFIG.roundNames.length, 5);
  assert.equal(fundingRoundName(5), "IPO");
  for (const id of GATED) {
    assert.equal(FUNDING_ROUNDS_CONFIG.levelCaps[id].length, 6, `${id}: ranks 0 to 5, no rank 6`);
    assert.equal(FUNDING_ROUNDS_CONFIG.levelCaps[id][6], undefined);
  }
  assert.equal(FUNDING_ROUNDS_CONFIG.bridgeRoundPrices.length, 5, "one price per round with a next round");
  assert.equal(bridgeRoundAvailable(ranksAt(5)), false);
  assert.equal(bridgeRoundPrice(ranksAt(5)), null);
  // The rank never reads past IPO, so the stop cannot be skipped.
  assert.equal(bridgeRoundAvailable({ fundingRounds: 9 }), false);
  assert.equal(effectiveFundingRoundRank(ranksAt(5), { bridgeRound: 1 }), 5);
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

test("issue #226: at IPO the card shows closed in Maxed Out, and its one line says why", () => {
  // The model: closed reads as maxed (the tab puts it under Maxed Out),
  // with nothing to buy or price. One round earlier it is on offer.
  const closed = openSourceCardModel("bridgeRound", clientState(5));
  assert.equal(closed.isMaxed, true);
  assert.equal(closed.canContribute, false);
  assert.equal(closed.locCost, undefined);
  assert.equal(closed.lockedRoundName, null);
  assert.equal(openSourceCardModel("bridgeRound", clientState(4)).isMaxed, false);
  assert.deepEqual(RANKS.map((rank) => bridgeRoundClosed(ranksAt(rank))), [false, false, false, false, false, true]);
  // The line: the final round is owned, and the line is complete
  // because there is no next round to rent. Null while a bridge is offered.
  const line = bridgeRoundClosedText(ranksAt(5));
  assert.equal(line, "You own IPO, the final round. The bridge line is complete: there is no next round left to rent.");
  assert.match(line, /You own IPO, the final round/);
  assert.match(line, /bridge line is complete/);
  assert.match(line, /no next round left to rent/);
  assert.ok(!/[—–]/.test(line));
  for (const rank of [0, 1, 2, 3, 4]) assert.equal(bridgeRoundClosedText(ranksAt(rank)), null);
  // The card: the closed line, the comment and the button label; no buy.
  const card = src("components/OpenSourceCard.jsx");
  assert.match(card, /const isBridgeClosed = isBridge && bridgeRoundClosed\(storeRanks\);/);
  assert.match(card, /type="CLOSED"\s*value=\{bridgeRoundClosedText\(storeRanks\)\}/);
  assert.match(card, /\? "\/\/ LINE COMPLETE"/);
  assert.match(card, /isBridgeClosed \? "Closed" : isBridge \? "Bridged" : "Maxed Out"/);
  assert.match(card, /disabled=\{!canContribute \|\| isMaxed \|\| isRoundLocked \|\| confirming\}/);
  assert.match(src("utils/openSourceCard.js"), /const isMaxed = bridgeClosed \|\| currentLevel >= levels\.length;/);
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
  assert.equal(bridgeRoundTargetName(ranksAt(3)), "Series C");
  assert.equal(bridgeRoundTargetName(ranksAt(4)), "IPO");
  assert.equal(bridgeRoundTargetName(ranksAt(5)), null);
  assert.equal(
    bridgeRoundCapsText(ranksAt(0)),
    "CoffeeScript, Junior Achievement and Senior Moment to v.9.0, Scrum Master to v.8.0, Commitment Issues to v.8.0, Ship Happens to v.3.0"
  );
  assert.equal(
    bridgeRoundCapsText(ranksAt(2)),
    "CoffeeScript, Junior Achievement and Senior Moment to v.15.0, Scrum Master to v.14.0, Commitment Issues to v.12.0, Ship Happens to v.8.0"
  );
  assert.equal(
    bridgeRoundCapsText(ranksAt(3)),
    "CoffeeScript, Junior Achievement and Senior Moment to v.18.0, Scrum Master to v.17.0, Commitment Issues to v.14.0, Ship Happens to v.9.0"
  );
  assert.equal(
    bridgeRoundCapsText(ranksAt(4)),
    "CoffeeScript, Junior Achievement and Senior Moment to v.21.0, Scrum Master to v.20.0, Commitment Issues to v.16.0, Ship Happens to v.10.0"
  );
  assert.match(bridgeRoundOfferText(ranksAt(1)), /^Rents Series A caps for this company: /);
  assert.match(bridgeRoundOfferText(ranksAt(3)), /^Rents Series C caps for this company: /);
  assert.match(bridgeRoundOfferText(ranksAt(4)), /^Rents IPO caps for this company: /);
  assert.equal(bridgeRoundOfferText(ranksAt(5)), null);
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
      bridgeRoundClosedText(ranksAt(rank)),
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
  // Issue #226: never hidden any more (at IPO it shows closed).
  assert.ok(!/bridgeRoundAvailable|BRIDGE_ROUND_PROJECT_ID/.test(tab), "the tab no longer hides the bridge");
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
