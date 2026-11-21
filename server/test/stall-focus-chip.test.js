/**
 * Tests for issue #230: the Farm's stall controls open at the stall.
 * Brandon, Nov 21: on a phone you scroll up to look at a stall, then
 * back down to act on it. Now tapping a stall opens a chip carrying its
 * controls in the grid, right under the tapped stall's row (in flow, so
 * it cannot clip at a screen edge), and the section scrolls the stall
 * and the chip into view together. The old below-grid selected-stall
 * panel is gone: stall controls have exactly one home.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STALL_FOCUS_MARGIN_PX,
  stallChipAfterIndex,
  stallFocusScrollDelta,
} from "../../client/src/utils/stallFocus.js";
import { FARM_CONFIG } from "../../shared/game-balance.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const farm = src("components/Farm.jsx");
const util = src("utils/stallFocus.js");

/** The stall grid's JSX: from its ref to the grid's closing div. */
function gridBlock() {
  const start = farm.indexOf("ref={gridRef}");
  assert.ok(start >= 0, "the grid has a ref");
  return farm.slice(start, farm.indexOf("\n      </div>\n", start));
}
/** The chip's JSX. */
function chipBlock() {
  const start = farm.indexOf("{index === chipAfterIndex && (");
  assert.ok(start >= 0, "the chip renders in the grid");
  return farm.slice(start, farm.indexOf("</Fragment>", start));
}

test("the chip sits after the selected stall's row, so selecting another row moves it", () => {
  const { stallCount, gridCols } = FARM_CONFIG;
  assert.equal(stallCount, 9);
  assert.equal(gridCols, 3);
  // Row one, row two, row three of the 3x3 barn.
  for (const [selected, after] of [[0, 2], [1, 2], [2, 2], [3, 5], [4, 5], [5, 5], [6, 8], [7, 8], [8, 8]]) {
    assert.equal(stallChipAfterIndex(selected, stallCount, gridCols), after, `stall ${selected}`);
  }
  // Nothing selected, or an index outside the barn: no chip.
  assert.equal(stallChipAfterIndex(null, stallCount, gridCols), null);
  assert.equal(stallChipAfterIndex(-1, stallCount, gridCols), null);
  assert.equal(stallChipAfterIndex(9, stallCount, gridCols), null);
  // A short last row (a barn that is not a full rectangle) ends at the last stall.
  assert.equal(stallChipAfterIndex(9, 10, 3), 9);
  // The Farm reads the barn's own size and columns.
  assert.match(farm, /const chipAfterIndex = stallChipAfterIndex\(\s*selected \? selectedStall : null,\s*farm\.stalls\.length,\s*FARM_CONFIG\.gridCols\s*\);/);
});

test("selecting a stall renders its controls in the chip, a full-width Panel inside the grid", () => {
  const grid = gridBlock();
  const chip = chipBlock();
  assert.ok(grid.includes(chip), "the chip is inside the stall grid");
  assert.match(grid, /<Fragment key=\{index\}>\s*<Panel\s+as="button"/);
  assert.match(chip, /<Panel\s+ref=\{chipRef\}\s+id="farm-stall-chip"\s+role="region"/);
  assert.match(chip, /aria-label=\{`Stall \$\{selectedStall \+ 1\} controls`\}/);
  assert.match(chip, /className="col-span-full flex flex-col gap-2 p-3"/);
  // Every control the old panel had: sell, move and lighting for a llama...
  assert.match(chip, /Sell \(\{formatMoney\(selectedSellCents \?\? 0\)\}\)/);
  assert.match(chip, /onClick=\{\(\) => setMoving\(true\)\}/);
  assert.match(chip, />\s*Move\s*</);
  assert.match(chip, /Pick an empty stall to move this llama into\./);
  // ...buy (every shop type) and lighting for an empty stall.
  assert.match(chip, /\{llamaShopTypes\(farm\.unlockedTypes\)\.map\(\(type\) => \{/);
  assert.match(chip, /Buy \{LLAMA_TYPE_NAMES\[type\]\} \(\{formatMoney\(price\)\}\)/);
  assert.equal((chip.match(/onClick=\{\(\) => handleCycleLighting\(selectedStall\)\}/g) ?? []).length, 2);
  // The current (floating) sell price still reads in the chip's copy.
  assert.match(chip, /Sells for\{" "\}\s*\{formatMoney\(selectedSellCents \?\? 0\)\}/);
  // The stall says it opens the chip.
  assert.match(grid, /aria-expanded=\{isSelected\}/);
  assert.match(grid, /aria-controls=\{isSelected \? "farm-stall-chip" : undefined\}/);
  assert.match(grid, /data-stall-index=\{index\}/);
});

test("the old below-grid selected-stall panel is gone: one home for stall controls", () => {
  const afterGrid = farm.slice(farm.indexOf("ref={gridRef}") + gridBlock().length);
  assert.ok(!/\{selected && \(/.test(farm), "no selected-only panel");
  for (const control of ["handleSellLlama", "handleBuyLlama", "handleCycleLighting(selectedStall)", "setMoving(true)"]) {
    assert.ok(!afterGrid.includes(control), `${control} is not below the grid`);
  }
  // One chip, one Sell button, one buy list.
  assert.equal((farm.match(/id="farm-stall-chip"/g) ?? []).length, 1);
  assert.equal((farm.match(/onClick=\{handleSellLlama\}/g) ?? []).length, 1);
  assert.equal((farm.match(/onClick=\{\(\) => handleBuyLlama\(type\)\}/g) ?? []).length, 1);
  // The legend and the herd book stay below the grid.
  assert.ok(afterGrid.includes("Mood lighting"));
  assert.ok(afterGrid.includes("Herd book"));
});

test("focus: the stall and the chip scroll into view together", () => {
  const view = { top: 100, bottom: 700 };
  const d = (stallTop, chipBottom) => stallFocusScrollDelta(stallTop, chipBottom, view.top, view.bottom);
  assert.equal(STALL_FOCUS_MARGIN_PX, 8);
  // Both in view: no scroll.
  assert.equal(d(200, 600), 0);
  // The chip runs off the bottom: scroll down just enough.
  assert.equal(d(300, 800), 108);
  // The stall is above the view: scroll up to it.
  assert.equal(d(50, 400), -58);
  // Taller than the view: the stall's top wins, never scrolled away.
  assert.equal(d(300, 1200), 192);
  assert.equal(d(50, 1200), -58);
  // The effect: on a new selection, find the section scroller and scroll by the delta.
  const start = farm.indexOf("useEffect(() => {");
  const effect = farm.slice(start, farm.indexOf("}, [selectedStall]);", start));
  assert.ok(effect.length > 0);
  assert.match(effect, /if \(selectedStall === null\) return;/);
  assert.match(effect, /querySelector\(\s*`\[data-stall-index="\$\{selectedStall\}"\]`\s*\)/);
  assert.match(effect, /\/\(auto\|scroll\)\/\.test\(getComputedStyle\(scroller\)\.overflowY\)/);
  assert.match(effect, /stallFocusScrollDelta\(/);
  assert.match(effect, /scroller\.scrollBy\(\{ top: delta, behavior: reduceMotion \? "auto" : "smooth" \}\);/);
});

test("reduced motion: the focus scroll jumps instead of gliding", () => {
  assert.match(farm, /"\(prefers-reduced-motion: reduce\)"/);
  assert.match(farm, /const reduceMotion = window\.matchMedia\?\.\(/);
});

test("the existing farm wiring is untouched: births, sell prices and selection", () => {
  assert.match(farm, /const births = useBirthPops\(state\.lastBirths\);/);
  assert.match(farm, /className=\{`stall relative flex/);
  assert.match(farm, /Sells for \{formatMoney\(llamaSellPriceCents\(stall\.llama, pricingRate\)\)\}/);
  assert.match(farm, /setSelectedStall\(\(current\) => \(current === stallIndex \? null : stallIndex\)\);/);
});

test("no em or en dashes in the Farm card or the chip helper", () => {
  for (const [name, text] of [["Farm.jsx", farm], ["stallFocus.js", util]]) {
    assert.ok(!text.includes("—") && !text.includes("–"), name);
  }
});
