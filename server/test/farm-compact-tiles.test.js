/**
 * Compact stall tiles (Brandon, Nov 21: "Can we shrink the panels down
 * without losing info? I want to see all 9 at once on my giant phone.").
 *
 * The tile drops the redundant words and keeps every fact: the short
 * type name, the price as a number, a lighting dot over the tinted
 * background, "Empty" plus "can breed", and a door plus "Open $X" for a
 * closed corner. The full sentence stays in the aria-label, the chip
 * and the Mood lighting legend. Source-text pins, like the other Farm
 * card tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LLAMA_TYPE_NAMES, LLAMA_TYPES } from "../../shared/game-balance.js";

const farm = readFileSync(
  new URL("../../client/src/components/Farm.jsx", import.meta.url),
  "utf8"
);
const start = farm.indexOf('aria-label="Barn stalls"');
const tile = farm.slice(start, farm.indexOf("{index === chipAfterIndex && (", start));

test("the tile is compact: a 64px minimum (above the 44px tap target) in a tighter grid", () => {
  assert.match(tile, /className=\{`stall relative flex flex-col items-center justify-center gap-0\.5 px-1\.5 py-1 min-h-\[64px\] cursor-pointer/);
  assert.match(farm, /className="grid grid-cols-3 gap-1\.5"\s*role="group"\s*aria-label="Barn stalls"/);
});

test("the type shows its short name; every type name ends in ' Llama'", () => {
  assert.match(farm, /function llamaShortName\(type\) \{\s*return LLAMA_TYPE_NAMES\[type\]\.replace\(\/ Llama\$\/, ""\);/);
  assert.match(tile, /\{stall\.llama \? llamaShortName\(stall\.llama\) : "Empty"\}/);
  assert.doesNotMatch(tile, /"Empty stall"/);
  for (const type of LLAMA_TYPES) {
    assert.match(LLAMA_TYPE_NAMES[type], / Llama$/, type);
    assert.ok(LLAMA_TYPE_NAMES[type].replace(/ Llama$/, "").length > 0, type);
  }
});

test("the price is the number only; 'sells for' stays in the aria-label", () => {
  assert.match(tile, /tabular-nums">\s*\{formatMoney\(llamaSellPriceCents\(stall\.llama, pricingRate\)\)\}/);
  assert.doesNotMatch(tile, /Sells for/);
  assert.match(tile, /`Stall \$\{index \+ 1\}: \$\{LLAMA_TYPE_NAMES\[stall\.llama\]\}, sells for \$\{formatMoney\(/);
});

test("lighting is a dot over the tint; the full name stays in the aria-label and the title", () => {
  assert.match(tile, /style=\{isClosed \? undefined : \{ "--stall-light": lighting\.color \}\}/);
  assert.match(tile, /\{!isClosed && \(\s*<span\s+className="absolute top-1 left-1\.5 text-\[10px\] leading-none"\s+style=\{\{ color: lighting\.color \}\}\s+aria-hidden="true"\s*>\s*●\s*<\/span>/);
  assert.doesNotMatch(tile, /\{lighting\.label\}\s*\{isEligible/);
  assert.match(tile, /, \$\{lighting\.label\} lighting\$\{stall\.locked \? ", locked" : ""\}/);
  assert.match(tile, /`\$\{lighting\.label\}: \$\{lighting\.description\} Click to select this stall\.`/);
});

test("empty stalls read 'Empty' with a 'can breed' marker; move targets say 'move here'", () => {
  assert.match(tile, /\{isEligible && \(\s*<span className="text-xs leading-tight" style=\{\{ color: lighting\.color \}\}>\s*can breed\s*<\/span>/);
  assert.match(tile, /\{isMoveTarget && \(\s*<span className="text-xs leading-tight">move here<\/span>/);
  assert.match(tile, /`Stall \$\{index \+ 1\}: empty, \$\{lighting\.label\} lighting\$\{\s*isEligible \? ", can breed" : ""/);
});

test("the lock, the selected and breeding outlines and the births pop are unchanged", () => {
  assert.match(tile, /\{stall\.llama && stall\.locked && \(\s*<FaLock\s+className="absolute top-1 right-1 text-xs text-yellow-300"/);
  assert.match(tile, /" stall--selected"/);
  assert.match(tile, /" stall--eligible"/);
  assert.match(tile, /aria-expanded=\{isSelected\}/);
  assert.match(tile, /key=\{birth \? `pop-\$\{births\.seq\}` : "llama"\}/);
});

test("no em or en dashes in the tile", () => {
  assert.ok(!tile.includes("—") && !tile.includes("–"));
});
