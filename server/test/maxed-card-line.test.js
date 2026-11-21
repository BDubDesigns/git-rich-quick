/**
 * Tests for issue #191: a maxed Open Source card offers no next version,
 * and the card's copy has no en or em dashes.
 *
 * - Maxed (e.g. Constellation at v7): the "N LOC needed for v.N.0" row is
 *   not rendered (it read "0 LOC needed for v.8.0", a version that does
 *   not exist). The card already reads MAXED OUT.
 * - Round-capped (at a Funding Round cap, not maxed): the row still
 *   points at the gated level with its real cost, as before.
 * - The Constellation interval reads "Stars every 30 to 60s".
 *
 * Display only: the card model from PR #184 is the source for the level
 * and maxed state (openSourceCardModel), not re-derived here.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BALANCE,
  OPEN_SOURCE_IDS,
  openSourceNextLevelCost,
} from "../../shared/game-balance.js";
import { openSourceCardModel } from "../../client/src/utils/openSourceCard.js";

const card = readFileSync(
  new URL("../../client/src/components/OpenSourceCard.jsx", import.meta.url),
  "utf8"
);

function stateAt(levels, rank) {
  return {
    linesOfCode: 1e15,
    openSourceProjects: Object.fromEntries(
      OPEN_SOURCE_IDS.map((id) => [id, { level: levels[id] ?? 0 }])
    ),
    permanentStoreRanks: { fundingRounds: rank },
  };
}

test("a maxed card renders no 'needed for v.' line: the row is gated on the model's isMaxed", () => {
  // Exactly one row offers a next version, and it renders only when not maxed.
  assert.equal((card.match(/LOC needed for v\./g) ?? []).length, 1);
  const row = card.match(/\{!isMaxed && \(\s*<JsDocLine\s*tag="@param"\s*type="LOC"\s*value=\{`\$\{formatNumber\(locCost\)\} LOC needed for v\.\$\{currentLevel \+ 1\}\.0`\}\s*\/>\s*\)\}/);
  assert.ok(row, "the LOC row is wrapped in {!isMaxed && (...)}");
  // isMaxed comes from the shared card model, not re-derived in the card.
  assert.match(card, /\n\s*isMaxed,\n/);
  assert.ok(!/isMaxed\s*=/.test(card), "the card does not compute isMaxed itself");
});

test("the model: every project at its last level is maxed (so the row is dropped), Constellation v7 included", () => {
  for (const id of OPEN_SOURCE_IDS) {
    const top = BALANCE.openSource[id].levels.length;
    const model = openSourceCardModel(id, stateAt({ [id]: top }, 5));
    assert.equal(model.isMaxed, true, id);
    assert.equal(model.locCost, undefined, `${id}: nothing to price`);
  }
  const constellation = openSourceCardModel("constellation", stateAt({ constellation: 7 }, 0));
  assert.equal(BALANCE.openSource.constellation.levels.length, 7);
  assert.equal(constellation.isMaxed, true);
});

test("the model: a round-capped card is not maxed, so its row still points at the gated level", () => {
  // Bootstrapped CoffeeScript at its cap of 6: v.7.0 needs Seed.
  const capped = openSourceCardModel("coffeeScript", stateAt({ coffeeScript: 6 }, 0));
  assert.equal(capped.isMaxed, false);
  assert.equal(capped.currentLevel, 6);
  assert.equal(capped.lockedRoundName, "Seed");
  assert.equal(capped.locCost, openSourceNextLevelCost("coffeeScript", 6));
  assert.ok(capped.locCost > 0);
  // Ship Happens at its Bootstrapped cap of 1, the same way.
  const ship = openSourceCardModel("shipHappens", stateAt({ shipHappens: 1 }, 0));
  assert.equal(ship.isMaxed, false);
  assert.equal(ship.lockedRoundName, "Seed");
  assert.equal(ship.locCost, openSourceNextLevelCost("shipHappens", 1));
});

test("no en or em dashes anywhere in the card; the Constellation interval reads 'X to Ys'", () => {
  assert.ok(!card.includes("–"), "no en dash");
  assert.ok(!card.includes("—"), "no em dash");
  assert.match(card, /`Stars every \$\{starInfo\.interval\.min\} to \$\{starInfo\.interval\.max\}s · /);
  assert.match(card, /`Stars spawn faster \(every \$\{starNext\.nextInterval\.min\} to \$\{starNext\.nextInterval\.max\}s\)`/);
});
