/**
 * Tests for issue #238: the Farm explains breeding and type discovery
 * in game. Brandon, Nov 21: "I don't see how to breed different kinds.
 * There should be a wiki or at least a popup." The guide is a popup on
 * the Farm tab, and the herd book shows undiscovered bred types as ???.
 *
 * Two kinds of pin: every number in the guide is read from the shared
 * balance file (so a retune cannot leave the guide stale), and every
 * rule the guide states is checked against the real breeding functions.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BREEDING_GUIDE_HERD_BOOK_LINE,
  BREEDING_GUIDE_LIGHTING_INTRO,
  bestDiscoveryLighting,
  breedingGuideLightingRows,
  breedingGuideSections,
  guidePercent,
  herdBookHiddenHint,
} from "../../client/src/utils/breedingGuide.js";
import {
  FARM_CONFIG,
  FARM_LIGHTING,
  FARM_LIGHTING_COLORS,
  LLAMA_BASE_TYPES,
  LLAMA_ECONOMY,
  LLAMA_TYPES,
  applyFarmBreedKids,
  emptyFarmState,
  farmEligibleBreedingStalls,
  farmKidChance,
  initialFarmState,
  rollFarmKid,
} from "../../shared/game-balance.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const farmCard = src("components/Farm.jsx");
const guideCard = src("components/BreedingGuide.jsx");
const guideUtil = src("utils/breedingGuide.js");

const allText = () =>
  [
    ...breedingGuideSections().flatMap((s) => [s.heading, ...s.lines]),
    BREEDING_GUIDE_LIGHTING_INTRO,
    BREEDING_GUIDE_HERD_BOOK_LINE,
    herdBookHiddenHint(),
  ].join("\n");

/** A 3x3 barn with the given llamas ({ index: type }) and lights. */
function barn(llamas = {}, lights = {}) {
  return Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
    llama: llamas[i] ?? null,
    lighting: lights[i] ?? "warm",
    locked: false,
  }));
}

/** An rng that returns the given values in order (then the last one). */
function seq(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test("the lighting table reads every light's odds from the balance file", () => {
  const rows = breedingGuideLightingRows();
  assert.deepEqual(rows.map((r) => r.id), [...FARM_LIGHTING_COLORS]);
  for (const row of rows) {
    const lighting = FARM_LIGHTING[row.id];
    assert.equal(row.label, lighting.label);
    assert.equal(row.color, lighting.color);
    assert.equal(row.kid, `${Math.round(lighting.kidChance * 100)}%`);
    assert.equal(row.newKind, `${Math.round(lighting.newTypeChance * 100)}%`);
    const boosted = Math.min(
      LLAMA_ECONOMY.maxKidChance,
      lighting.kidChance * LLAMA_ECONOMY.mamaKidChanceMultiplier
    );
    assert.equal(row.kidWithMama, `${Math.round(boosted * 100)}%`);
  }
  // Today's numbers, as the issue lists them (fails loudly on a retune,
  // which is the point: re-read the guide when the odds move).
  assert.deepEqual(
    rows.map((r) => [r.id, r.kid, r.kidWithMama, r.newKind]),
    [
      ["warm", "15%", "45%", "15%"],
      ["red", "30%", "90%", "5%"],
      ["blue", "8%", "24%", "40%"],
      ["green", "20%", "60%", "25%"],
    ]
  );
});

test("the guide's copy carries the tick, the Mama multiplier and the cap from the constants", () => {
  const text = allText();
  assert.ok(text.includes(`Every ${FARM_CONFIG.breedingTickSeconds} seconds`));
  assert.ok(text.includes(`${LLAMA_ECONOMY.mamaKidChanceMultiplier}x as often`));
  assert.ok(text.includes(`up to ${guidePercent(LLAMA_ECONOMY.maxKidChance)} a check`));
  // No second copy of a number: the util has no literal percentages or
  // tick length, it interpolates them.
  assert.doesNotMatch(guideUtil, /\d+%/);
  assert.doesNotMatch(guideUtil, /\b60 seconds\b/);
});

test("rule: a kid needs an empty stall with 2 or more llamas beside it, corners do not count", () => {
  // Stall 4 is the middle. One neighbour is not enough.
  assert.ok(!farmEligibleBreedingStalls(barn({ 1: "classic" })).includes(4));
  // Two orthogonal neighbours are.
  assert.ok(farmEligibleBreedingStalls(barn({ 1: "classic", 3: "drama" })).includes(4));
  // Corners (diagonals) do not count.
  assert.ok(!farmEligibleBreedingStalls(barn({ 0: "classic", 2: "drama", 6: "classic", 8: "drama" })).includes(4));
  // An occupied stall never breeds.
  assert.ok(!farmEligibleBreedingStalls(barn({ 1: "classic", 3: "drama", 4: "classic" })).includes(4));
});

test("rule: the EMPTY stall's light sets the odds, not the parents' lights", () => {
  // Parents under blue (8%), the empty stall under warm (15%): a 0.1
  // roll makes a kid, so the empty stall's warm light decided it.
  const stalls = barn({ 1: "classic", 3: "classic" }, { 1: "blue", 3: "blue", 4: "warm" });
  assert.equal(rollFarmKid(4, stalls, ["classic"], seq(0.1, 0.99, 0)), "classic");
  // The same parents with the empty stall under blue: no kid.
  const blue = barn({ 1: "classic", 3: "classic" }, { 4: "blue" });
  assert.equal(rollFarmKid(4, blue, ["classic"], seq(0.1)), null);
});

test("rule: a new kind is random among the kinds not met yet, never a Mama, whatever the parents", () => {
  const stalls = barn({ 1: "classic", 3: "classic" }, { 4: "blue" });
  const met = ["classic", "mama"];
  const unmet = LLAMA_TYPES.filter((t) => t !== "mama" && !met.includes(t));
  // Roll a kid (0), take the new-kind branch (0), then pick each slot.
  unmet.forEach((type, i) => {
    const pick = (i + 0.5) / unmet.length;
    assert.equal(rollFarmKid(4, stalls, met, seq(0, 0, pick)), type);
  });
  // Even with nothing met at all, the Mama is never the new kind.
  for (let i = 0; i < 20; i++) {
    const kid = rollFarmKid(4, stalls, [], seq(0, 0, i / 20));
    assert.notEqual(kid, "mama");
  }
});

test("rule: with every kind found, kids just copy their parents", () => {
  const stalls = barn({ 1: "drama", 3: "drama" }, { 4: "blue" });
  for (let i = 0; i < 10; i++) {
    assert.equal(rollFarmKid(4, stalls, [...LLAMA_TYPES], seq(0, 0, i / 10)), "drama");
  }
});

test("rule: a Mama next door triples the kid odds up to the cap, two do not stack, her kids copy the other parent, and an all-Mama nest makes nothing", () => {
  for (const id of FARM_LIGHTING_COLORS) {
    assert.equal(farmKidChance(id, ["mama", "mama"]), farmKidChance(id, ["mama"]));
    assert.ok(farmKidChance(id, ["mama"]) <= LLAMA_ECONOMY.maxKidChance);
  }
  // Mama + Classic, no new kind (0.99): the kid is a Classic.
  const mixed = barn({ 1: "mama", 3: "classic" });
  for (let i = 0; i < 5; i++) {
    assert.equal(rollFarmKid(4, mixed, [...LLAMA_TYPES], seq(0, 0.99, i / 5)), "classic");
  }
  // Nothing but Mamas around it: no kid (Brandon, Nov 21: Mamas are never bred).
  const mamas = barn({ 1: "mama", 3: "mama" });
  assert.equal(rollFarmKid(4, mamas, [...LLAMA_TYPES], seq(0, 0.99, 0)), null);
  // Shop-only: she is a base (shop) type from the start.
  assert.ok(LLAMA_BASE_TYPES.includes("mama"));
});

test("rule: the first kid of a kind is a discovery, and it survives a company sale", () => {
  const farm = initialFarmState(["classic"]);
  const after = applyFarmBreedKids(farm, [{ stallIndex: 4, type: "quantum" }]);
  assert.ok(after.unlockedTypes.includes("quantum"));
  assert.ok(emptyFarmState(after.unlockedTypes).unlockedTypes.includes("quantum"));
  assert.ok(initialFarmState(after.unlockedTypes).unlockedTypes.includes("quantum"));
});

test("the discovery light is the one with the best new-kind odds, and the herd book hint names it", () => {
  const best = bestDiscoveryLighting();
  for (const id of FARM_LIGHTING_COLORS) {
    assert.ok(FARM_LIGHTING[best].newTypeChance >= FARM_LIGHTING[id].newTypeChance);
  }
  assert.equal(best, "blue");
  assert.ok(herdBookHiddenHint().includes(FARM_LIGHTING[best].label));
});

test("the herd book shows found kinds in full, shop kinds by name, and unfound bred kinds as ???", () => {
  const book = farmCard.slice(farmCard.indexOf("Herd book ("));
  // A kind is named when it is discovered or in the shop (the base
  // kinds always are); anything else is ???.
  assert.match(book, /const forSale = llamaShopTypes\(farm\.unlockedTypes\)\.includes\(type\);/);
  // Brandon, Nov 21: a ??? row shows only its label and the hint, no prices.
  assert.match(book, /if \(!forSale\) \{[\s\S]*?<strong>\?\?\? \(undiscovered\)<\/strong>\. Breed one to find it\.[\s\S]*?\}/);
  assert.match(book, /<strong>\{LLAMA_TYPE_NAMES\[type\]\}<\/strong>/);
  assert.match(book, /herdBookHiddenHint\(\)/);
  // Only a discovered kind shows its description.
  assert.match(book, /discovered \? \(\s*<>: \{LLAMA_TYPE_DESCRIPTIONS\[type\]\}<\/>/);
});

test("the guide is a real dialog: opened from the Farm, Escape and a Close button close it, focus is managed", () => {
  // Reachable from the owned Farm's top panel.
  assert.match(farmCard, /setGuideOpen\(true\)\}>How breeding works</);
  assert.match(farmCard, /<BreedingGuide open=\{guideOpen\} onClose=\{\(\) => setGuideOpen\(false\)\} \/>/);
  // A native modal dialog: dialog role, focus kept inside, Escape closes.
  assert.match(guideCard, /<dialog\b/);
  assert.match(guideCard, /showModal/);
  assert.match(guideCard, /aria-labelledby="breeding-guide-title"/);
  assert.match(guideCard, /id="breeding-guide-title"/);
  assert.match(guideCard, /onClose=\{handleClose\}/);
  // Close button, focused on open; focus returns to the opener.
  assert.match(guideCard, /ref=\{closeRef\}[\s\S]*?>\s*Close\s*</);
  assert.match(guideCard, /closeRef\.current\?\.focus\(\)/);
  assert.match(guideCard, /returnFocusRef\.current = document\.activeElement/);
  assert.match(guideCard, /opener\.focus\(\)/);
  // The lighting table has both odds per light.
  assert.match(guideCard, /Kid per check/);
  assert.match(guideCard, /With a Mama/);
  assert.match(guideCard, /New kind/);
});

test("no browser popups, no animation, no em or en dashes", () => {
  for (const file of [guideCard, guideUtil, farmCard]) {
    assert.doesNotMatch(file, /window\.(alert|confirm|prompt)/);
    assert.doesNotMatch(file, /[–—]/);
  }
  assert.doesNotMatch(allText(), /[–—]/);
  assert.doesNotMatch(guideCard, /animate-|transition|@keyframes/);
});

test("the Commit float's behavior is unchanged: its files have no diff", () => {
  assertCommitFloatLocked();
});
