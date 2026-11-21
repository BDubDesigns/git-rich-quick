/**
 * Tests for issue #218 (Slice 6 of the #210 game-feel pass): new hire
 * on the farm. A breed result pops each stall it placed a kid in (the
 * llama scales 0.4 to 1.1 to 1, a pink +1 chip rises 24px and fades), a
 * brand-new type gets a one-time gold stall outline, and off the Farm
 * the #204 birth badge bumps each time its count actually rises.
 * Presentation only: breeding, odds and prices are untouched.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FARM_CONFIG, applyFarmBirths } from "../../shared/game-balance.js";
import {
  BIRTH_CHIP_RISE_PX,
  LLAMA_BIRTH_FRESH_MS,
  LLAMA_BIRTH_MS,
  badgeBumpAfter,
  birthRecord,
  birthsFreshOnMount,
  stallBirth,
} from "../../client/src/utils/llamaBirths.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/LlamaBirth.css");

function rule(selector, from = css) {
  const start = from.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return from.slice(start, from.indexOf("\n}", start + 1));
}
function keyframes(name) {
  const start = css.indexOf(`@keyframes ${name} {`);
  assert.ok(start >= 0, `@keyframes ${name}`);
  return css.slice(start, css.indexOf("\n}", start));
}

/** An owned barn from a 9-stall layout, with the discovered types. */
function barn(layout, unlockedTypes, unseenBirths = 0) {
  return {
    owned: true,
    stalls: layout.map((llama) => ({ llama, lighting: "warm" })),
    unlockedTypes,
    unseenBirths,
  };
}
const NEST = ["classic", null, "drama", null, "classic", null, "drama", null, "classic"];

test("the Commit float's behavior is unchanged: its files have no diff", () => {
  assertCommitFloatLocked();
});

test("per placed stall: every stall a kid was placed in pops; nothing else does", () => {
  assert.equal(NEST.length, FARM_CONFIG.stallCount);
  const before = barn(NEST, ["classic", "drama"]);
  const after = applyFarmBirths(before, [
    { stallIndex: 1, type: "classic" },
    { stallIndex: 3, type: "spaghetti" },
    { stallIndex: 0, type: "classic" }, // occupied: not placed
  ]);
  const record = birthRecord(before, after, null, 1000);
  assert.deepEqual(record.stalls, [1, 3]);
  assert.equal(record.seq, 1);
  assert.deepEqual(stallBirth(record, 1), { pop: true, newType: false });
  assert.deepEqual(stallBirth(record, 3), { pop: true, newType: true });
  for (const i of [0, 2, 4, 5, 6, 7, 8]) assert.equal(stallBirth(record, i), null, `stall ${i}`);
  // A result that placed nothing keeps the last record (no new pop).
  assert.equal(birthRecord(after, applyFarmBirths(after, []), record, 2000), record);
  assert.equal(birthRecord(before, before, null, 0), null);
});

test("a brand-new type outlines its first stall once; a known type, or a second kid of it, does not", () => {
  const before = barn(NEST, ["classic", "drama"]);
  const after = applyFarmBirths(before, [
    { stallIndex: 1, type: "spaghetti" },
    { stallIndex: 3, type: "spaghetti" },
    { stallIndex: 5, type: "drama" },
  ]);
  const record = birthRecord(before, after, null, 1000);
  assert.deepEqual(record.newTypeStalls, [1], "one outline per new type");
  // The next result: spaghetti is known now, so no outline.
  const later = applyFarmBirths({ ...after, stalls: after.stalls.map((s, i) => (i === 7 ? { ...s, llama: null } : s)) }, [{ stallIndex: 7, type: "spaghetti" }]);
  const next = birthRecord({ ...after, stalls: after.stalls.map((s, i) => (i === 7 ? { ...s, llama: null } : s)) }, later, record, 2000);
  assert.deepEqual(next.newTypeStalls, []);
  assert.equal(next.seq, 2);
});

test("the badge bumps only when the count actually rises; births watched on the Farm never bump a hidden badge", () => {
  const before = barn(NEST, ["classic", "drama"], 2);
  // Off the Farm: the kids count (2 to 4), so the badge bumps.
  const off = applyFarmBirths(before, [{ stallIndex: 1, type: "classic" }, { stallIndex: 3, type: "drama" }], { watching: false });
  const offRecord = birthRecord(before, off, null, 1000);
  assert.equal(off.unseenBirths, 4);
  assert.equal(offRecord.badgeRose, true);
  assert.equal(badgeBumpAfter(0, offRecord), 1);
  // On the Farm (watching): the kids pop, the count stays, no bump.
  const watched = applyFarmBirths(barn(NEST, ["classic", "drama"], 0), [{ stallIndex: 1, type: "classic" }], { watching: true });
  const watchedRecord = birthRecord(barn(NEST, ["classic", "drama"], 0), watched, null, 1000);
  assert.equal(watched.unseenBirths, 0);
  assert.deepEqual(watchedRecord.stalls, [1], "the stall still pops on the Farm");
  assert.equal(watchedRecord.badgeRose, false);
  assert.equal(badgeBumpAfter(7, watchedRecord), 7, "the hidden badge keeps its key");
  // No record, no bump.
  assert.equal(badgeBumpAfter(3, null), 3);
  // Wiring: the bump comes from the breed record, never from the count
  // on screen, so a load (the count appearing) never bumps.
  assert.match(src("hooks/useLlamaBirths.js"), /return useOnNewRecord\(record, 0, badgeBumpAfter\);/);
  const nav = src("components/NavBar.jsx");
  assert.match(nav, /const farmBadgeBump = useBadgeBump\(state\.lastBirths\);/);
  assert.match(nav, /badgeBumpKey=\{id === "farm" \? farmBadgeBump : 0\}/);
  const button = src("components/NavButton.jsx");
  assert.match(button, /key=\{badgeBumpKey\}/);
  assert.match(button, /\$\{badgeBumpKey \? " nav-badge-bump" : ""\}/);
});

test("the reducer records the births on FARM_BREED_RESULT; a restore clears them; never saved", () => {
  const context = src("context/GameContext.jsx");
  const breed = context.slice(context.indexOf('case "FARM_BREED_RESULT": {'), context.indexOf('case "COMPLETE_PROJECT": {'));
  assert.match(breed, /lastBirths: birthRecord\(farm, bred\.farm, state\.lastBirths, Date\.now\(\)\),/);
  // Breeding itself is the unchanged shared helper (its #204 pin passes untouched).
  assert.match(breed, /farm: shared\.applyFarmBirths\(farm, action\.payload\?\.kids, \{\s*watching: isSectionOnScreen\(state, "farm"\),\s*\}\),/);
  const restore = context.slice(context.indexOf('case "RESTORE_SAVE": {'), context.indexOf("// if action type doesn't make sense"));
  assert.match(restore, /lastBirths: null,/);
  assert.ok(!src("save/serialize.js").includes("lastBirths"));
  // The Farm pops a fresh record on mount, never an old one.
  assert.equal(LLAMA_BIRTH_FRESH_MS, 1000);
  assert.equal(birthsFreshOnMount({ atMs: 1000 }, 1500), true);
  assert.equal(birthsFreshOnMount({ atMs: 1000 }, 2001), false);
  assert.equal(birthsFreshOnMount(null, 0), false);
  const farm = src("components/Farm.jsx");
  assert.match(farm, /const births = useBirthPops\(state\.lastBirths\);/);
  assert.match(farm, /const birth = stallBirth\(births, index\);/);
  assert.match(farm, /key=\{birth \? `pop-\$\{births\.seq\}` : "llama"\}/);
});

test("the look: the pop, the pink +1 rising 24px, the gold outline, the 1.25 badge bump, 500ms", () => {
  assert.equal(LLAMA_BIRTH_MS, 500);
  assert.equal(BIRTH_CHIP_RISE_PX, 24);
  assert.match(keyframes("llama-pop"), /0% \{\s*transform: scale\(0\.4\);\s*\}\s*60% \{\s*transform: scale\(1\.1\);\s*\}\s*100% \{\s*transform: scale\(1\);/);
  const chip = rule(".birth-chip");
  for (const decl of ["color: #f9a8d4;", "pointer-events: none;", "animation: birth-chip 500ms cubic-bezier(0.16, 1, 0.3, 1) forwards;"]) assert.ok(chip.includes(decl), decl);
  assert.match(keyframes("birth-chip"), /100% \{\s*transform: translateY\(-24px\);\s*opacity: 0;/);
  const outline = rule(".birth-new-type");
  for (const decl of ["border: 2px solid #ffd700;", "border-radius: inherit;", "pointer-events: none;", "animation: birth-new-type 500ms ease-out forwards;"]) assert.ok(outline.includes(decl), decl);
  assert.match(keyframes("nav-badge-bump"), /40% \{\s*transform: scale\(1\.25\);/);
  assert.ok(rule(".nav-badge-bump").includes("animation: nav-badge-bump 500ms"));
  assert.match(src("components/Farm.jsx"), />\s*\+1\s*<\/span>/);
});

test("shared rules: transform and opacity only, pointer-events none, inside the stall or the badge", () => {
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) {
    for (const prop of m[2].matchAll(/([a-z-]+):/g)) {
      assert.ok(["transform", "opacity"].includes(prop[1]), `${m[1]} animates ${prop[1]}`);
    }
  }
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/z-index|transition/.test(code));
  assert.match(src("components/Farm.jsx"), /className=\{`stall relative flex/);
});

test("reduced motion: no pop, rise or bump; the chip, the outline and a badge ring show whole for 500ms", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
  assert.match(reduced, /\.llama-pop,\s*\.nav-badge-bump \{\s*animation: none;/);
  assert.match(reduced, /\.birth-chip \{\s*animation: birth-still 500ms steps\(1, end\) forwards;/);
  assert.match(reduced, /\.birth-new-type \{\s*animation: birth-still 500ms steps\(1, end\) forwards;/);
  assert.match(reduced, /\.nav-badge-bump::after \{[^}]*border: 2px solid #f9a8d4;[^}]*animation: birth-still 500ms steps\(1, end\) forwards;/);
  assert.ok(!/transform/.test(keyframes("birth-still")));
});

test("no dashes in the new copy", () => {
  for (const file of [css, src("utils/llamaBirths.js"), src("hooks/useLlamaBirths.js")]) assert.ok(!/[—–]/.test(file));
});
