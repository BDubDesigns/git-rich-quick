/**
 * Tests for issue #239: the Farm shows a countdown to the next breeding
 * check, on the Farm tab near the stalls. Brandon, Nov 21: the player
 * should see when the next kid check lands instead of guessing at the
 * 60 second rhythm. Not another bar: a small numeric countdown. One
 * source of truth: it reads the reducer's own breeding clock
 * (state.farmBreedTicks), never a second timer that could drift.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatBreedCountdown,
  secondsUntilBreedCheck,
} from "../../client/src/utils/breedCountdown.js";
import { FARM_CONFIG } from "../../shared/game-balance.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const farm = src("components/Farm.jsx");
const util = src("utils/breedCountdown.js");
const context = src("context/GameContext.jsx");

/** The countdown's JSX: from its comment to the grid. */
function countdownBlock() {
  const start = farm.indexOf("Issue #239: a quiet countdown");
  assert.ok(start >= 0, "the Farm renders the countdown");
  return farm.slice(start, farm.indexOf("ref={gridRef}", start));
}

test("the countdown reads the breeding interval and counts 60 down to 1", () => {
  const interval = FARM_CONFIG.breedingTickSeconds;
  assert.equal(interval, 60);
  assert.equal(secondsUntilBreedCheck(0), 60);
  assert.equal(secondsUntilBreedCheck(18), 42);
  assert.equal(secondsUntilBreedCheck(59), 1);
  // Ticks counted before the barn was bought: the next tick runs the check.
  assert.equal(secondsUntilBreedCheck(60), 1);
  assert.equal(secondsUntilBreedCheck(500), 1);
  // A missing or bad count reads as a fresh interval, never NaN.
  for (const bad of [undefined, null, NaN, -3, "x"]) {
    assert.equal(secondsUntilBreedCheck(bad), 60, String(bad));
  }
  // Another interval is honored.
  assert.equal(secondsUntilBreedCheck(2, 5), 3);
});

test("the countdown formats as m:ss", () => {
  assert.equal(formatBreedCountdown(60), "1:00");
  assert.equal(formatBreedCountdown(42), "0:42");
  assert.equal(formatBreedCountdown(9), "0:09");
  assert.equal(formatBreedCountdown(1), "0:01");
  assert.equal(formatBreedCountdown(125), "2:05");
  assert.equal(formatBreedCountdown(-4), "0:00");
});

test("it lands on the same tick as the reducer's breeding check", () => {
  // The reducer's GAME_TICK: ticks + 1, and at the interval the check is
  // due and the count goes back to 0. Pin that source, then replay it.
  assert.match(context, /const breedTicks = \(state\.farmBreedTicks \?\? 0\) \+ 1;/);
  assert.match(context, /breedTicks >= shared\.FARM_CONFIG\.breedingTickSeconds\s*\)\s*\{\s*nextBreedTicks = 0;\s*farmBreedDue = true;/);
  assert.match(context, /farmBreedTicks: nextBreedTicks,/);

  const interval = FARM_CONFIG.breedingTickSeconds;
  let ticks = 0;
  let shown = [];
  let checks = 0;
  for (let second = 0; second < interval * 3; second += 1) {
    shown.push(secondsUntilBreedCheck(ticks));
    const next = ticks + 1;
    if (next >= interval) {
      ticks = 0;
      checks += 1;
      // The check fires on the tick right after the countdown read 1.
      assert.equal(shown.at(-1), 1);
    } else {
      ticks = next;
    }
  }
  assert.equal(checks, 3);
  assert.equal(shown[0], 60);
  assert.equal(shown[interval], 60, "back to 1:00 after a check");
  assert.ok(shown.every((s) => s >= 1 && s <= interval));
});

test("one source of truth: no second clock in the countdown", () => {
  for (const code of [util, countdownBlock()]) {
    assert.doesNotMatch(code, /setInterval|setTimeout|requestAnimationFrame|Date\.now|performance\.now/);
  }
  assert.match(
    farm,
    /const breedCountdown = formatBreedCountdown\(\s*secondsUntilBreedCheck\(state\.farmBreedTicks\)\s*\);/
  );
});

test("it sits on the Farm tab right above the stalls, as quiet text and not a bar", () => {
  const block = countdownBlock();
  // Only in the owned barn: after the not-owned early return.
  assert.ok(farm.indexOf("Issue #239: a quiet countdown") > farm.indexOf("if (!farm.owned) {"));
  // Directly before the stall grid.
  assert.match(farm, /\(nothing can breed yet\)" : ""\}\s*<\/p>\s*<div\s*ref=\{gridRef\}/);
  assert.match(block, /Next breeding check in \{breedCountdown\}/);
  assert.match(block, /eligible\.length === 0 \? " \(nothing can breed yet\)" : ""/);
  assert.match(block, /role="timer"/);
  assert.match(block, /className="m-0 px-1 text-xs text-gray-400 text-right tabular-nums"/);
  // Not a bar, no animation, nothing global.
  assert.doesNotMatch(block, /ProgressBar|progress|animate|transition|scaleX/);
  for (const file of ["App.jsx", "components/StatBox.jsx"]) {
    assert.doesNotMatch(src(file), /breedCountdown|farmBreedTicks/, file);
  }
});

test("no dashes in the countdown copy or helper", () => {
  for (const code of [util, countdownBlock()]) {
    assert.doesNotMatch(code, /[–—]/);
  }
});
