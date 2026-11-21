/**
 * Tests for issue #217 (Slice 5 of the #210 game-feel pass): the rank
 * stamp. A successful permanent store purchase bumps the bought track's
 * rank line in gold (the Slice 2 stat bump), flashes the panel's border
 * gold with a fading glow (450ms), and, for Funding Rounds only, sets a
 * ROUND CLOSED chip on the panel for 1.2s. Presentation only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RANK_STAMP_MS,
  ROUND_CLOSED_MS,
  ROUND_CLOSED_TEXT,
  rankStampFor,
  rankStampOn,
} from "../../client/src/utils/rankStamp.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/RankStamp.css");
const store = src("components/PermanentStore.jsx");

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

test("the Commit float's behavior is unchanged: its files have no diff", () => {
  assertCommitFloatLocked();
});

test("trigger: only a successful buyStoreRank stamps; the purchase logic is untouched", () => {
  const handler = store.slice(store.indexOf("async function handleBuy(storeId) {"), store.indexOf("async function handleComplete() {"));
  assert.match(handler, /const result = await buyStoreRank\(storeId\);\s*if \(result\.ok\) \{\s*setStamp\(\(prev\) => rankStampFor\(storeId, prev\)\);\s*\} else \{/);
  assert.equal((store.match(/setStamp\(/g) ?? []).length, 1, "set nowhere else (never on failure)");
  // The purchase itself is the same call, the same button, the same errors.
  assert.match(store, /onClick=\{\(\) => handleBuy\(storeId\)\}/);
  assert.match(handler, /"That purchase is not available\. The store may have changed, try again\."/);
});

test("the stamp: Funding Rounds gets ROUND CLOSED, every other track the flash and bump; one at a time", () => {
  assert.equal(ROUND_CLOSED_TEXT, "ROUND CLOSED");
  assert.ok(!/[—–]/.test(ROUND_CLOSED_TEXT));
  const fr = rankStampFor("fundingRounds", null);
  assert.deepEqual(fr, { storeId: "fundingRounds", key: 1, roundClosed: true });
  const sc = rankStampFor("startingCapital", fr);
  assert.deepEqual(sc, { storeId: "startingCapital", key: 2, roundClosed: false });
  // Only the bought track's panel shows it; a new purchase replaces it.
  assert.equal(rankStampOn(sc, "startingCapital"), true);
  assert.equal(rankStampOn(sc, "fundingRounds"), false);
  assert.equal(rankStampOn(null, "fundingRounds"), false);
  // Keyed by the purchase, so a repeat restarts instead of stacking.
  assert.match(store, /<span key=\{`flash-\$\{stamp\.key\}`\} className="rank-flash" aria-hidden="true" \/>/);
  assert.match(store, /\{stamped && stamp\.roundClosed && \(\s*<span key=\{`closed-\$\{stamp\.key\}`\} className="round-closed-chip" aria-hidden="true">\s*\{ROUND_CLOSED_TEXT\}/);
  // The rank line: the Slice 2 bump, in gold, re-keyed per purchase.
  assert.match(store, /key=\{stamped \? `rank-\$\{stamp\.key\}` : "rank"\}\s*className=\{stamped \? "stat-value stat-bump stat-bump--money" : undefined\}\s*data-value=\{rankText\}/);
  assert.match(src("components/StatBump.css"), /\.stat-bump--money \{\s*--stat-gain-color: #facc15;/);
  // Contained in the panel the player tapped.
  assert.match(store, /<Panel key=\{storeId\} className="relative flex flex-col gap-1 p-3">/);
});

test("the look: a gold border flash with a 14px glow over 450ms; ROUND CLOSED stamped for 1.2s", () => {
  assert.equal(RANK_STAMP_MS, 450);
  assert.equal(ROUND_CLOSED_MS, 1200);
  const flash = rule(".rank-flash");
  for (const decl of ["inset: -1px;", "border-radius: inherit;", "border: 1px solid #facc15;", "box-shadow: 0 0 14px rgba(250, 204, 21, 0.4);", "animation: rank-flash 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards;"]) {
    assert.ok(flash.includes(decl), decl);
  }
  assert.match(keyframes("rank-flash"), /0% \{\s*opacity: 1;\s*\}\s*100% \{\s*opacity: 0;/);
  const chip = rule(".round-closed-chip");
  for (const decl of ["font-weight: 800;", "letter-spacing: 0.2em;", "color: rgba(239, 68, 68, 0.9);", "border: 2px solid currentColor;", "bottom: 14px;", "right: 14px;", "animation: round-closed 1200ms linear forwards;"]) {
    assert.ok(chip.includes(decl), decl);
  }
  const frames = keyframes("round-closed");
  assert.match(frames, /0% \{\s*opacity: 0;\s*transform: rotate\(-8deg\) scale\(1\.6\);/);
  assert.match(frames, /15% \{\s*opacity: 1;\s*transform: rotate\(-8deg\) scale\(0\.96\);/);
  assert.match(frames, /85% \{\s*opacity: 1;/);
  assert.match(frames, /100% \{\s*opacity: 0;/);
});

test("shared rules: transform and opacity only, pointer-events none, no z-index layer", () => {
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) {
    for (const prop of m[2].matchAll(/([a-z-]+):/g)) {
      assert.ok(["transform", "opacity", "animation-timing-function"].includes(prop[1]), `${m[1]} animates ${prop[1]}`);
    }
  }
  for (const sel of [".rank-flash", ".round-closed-chip"]) assert.ok(rule(sel).includes("pointer-events: none;"), sel);
  assert.ok(!/z-index|transition/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
});

test("reduced motion: the flash and the chip appear and disappear, no scale or rotation", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
  assert.match(reduced, /\.rank-flash \{\s*animation: rank-stamp-still 450ms steps\(1, end\) forwards;/);
  assert.match(reduced, /\.round-closed-chip \{\s*transform: none;\s*animation: rank-stamp-still 1200ms steps\(1, end\) forwards;/);
  assert.ok(!/transform/.test(keyframes("rank-stamp-still")));
});

test("no dashes in the new copy", () => {
  for (const file of [css, src("utils/rankStamp.js")]) assert.ok(!/[—–]/.test(file));
});
