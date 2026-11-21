/**
 * Tests for issue #214 (Slice 2 of the #210 game-feel pass): the
 * header stats bump on big gains. LOC and Money bump when a listed
 * source raises them by at least 5 seconds of current production; LOC/s
 * bumps when the rate rises by at least 10%. Clicks, ticks, loads,
 * restores and decreases never bump. Presentation and detection only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BIG_GAIN_SECONDS,
  RATE_JUMP_FRACTION,
  STAT_BUMP_MS,
  STAT_GAIN_AMOUNT_ACTIONS,
  STAT_GAIN_COLORS,
  STAT_GAIN_FRESH_MS,
  STAT_GAIN_NEVER_ACTIONS,
  isBigGain,
  isRateJump,
  nextStatGain,
  statGainFlags,
  statGainFreshOnMount,
  statPulseAfter,
} from "../../client/src/utils/statGain.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/StatBump.css");
const context = src("context/GameContext.jsx");

/** A reading: { loc, money, rate, moneyRate }. */
const R = (loc, money, rate, moneyRate = 0) => ({ loc, money, rate, moneyRate });
const NONE = { loc: false, money: false, rate: false };

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
  assert.ok(!/statGain|stat-bump/.test(src("components/FloatingText.jsx") + src("components/FloatingText.css")));
});

test("thresholds: a big gain is at least 5 seconds of current production; the rate bumps at +10%", () => {
  assert.equal(BIG_GAIN_SECONDS, 5);
  assert.equal(RATE_JUMP_FRACTION, 0.1);
  // At 100 LOC/s: 500 is exactly 5 seconds, 499 is not.
  assert.equal(isBigGain(500, 100), true);
  assert.equal(isBigGain(499, 100), false);
  assert.equal(isBigGain(1e9, 100), true);
  // No production (a new company, Money without a Release Manager): any rise from a listed source.
  assert.equal(isBigGain(1, 0), true);
  // Never a decrease, a zero or junk.
  for (const [a, r] of [[0, 100], [-500, 100], [Number.NaN, 1], [Infinity, 1], [undefined, 1]]) {
    assert.equal(isBigGain(a, r), false, `${a}`);
  }
  // Rate: +10% bumps, +9.9% does not, from zero any rise, a fall never.
  assert.equal(isRateJump(100, 110), true);
  assert.equal(isRateJump(100, 109.9), false);
  assert.equal(isRateJump(312, 327), false, "the measured x10 intern hire (+4.8%)");
  assert.equal(isRateJump(312, 7800), true, "To the Moon x25");
  assert.equal(isRateJump(0, 1), true);
  assert.equal(isRateJump(0, 0), false);
  assert.equal(isRateJump(200, 100), false, "a buff ending");
  assert.equal(isRateJump(Number.NaN, 10), false);
});

test("the sources: star claims and ship payouts by amount, the Night Shift report, the Starting Capital grant", () => {
  assert.deepEqual([...STAT_GAIN_AMOUNT_ACTIONS], ["APPLY_STAR_REWARD", "COMPLETE_PROJECT"]);
  // A star claim (an Airdrop) worth 10s of LOC: LOC bumps.
  assert.deepEqual(statGainFlags({ type: "APPLY_STAR_REWARD" }, R(1000, 0, 100), R(2000, 0, 100)), { ...NONE, loc: true });
  // An Airdrop of cash: Money bumps.
  assert.deepEqual(statGainFlags({ type: "APPLY_STAR_REWARD" }, R(1000, 0, 100), R(1000, 3301, 100)), { ...NONE, money: true });
  // A small Lucky worth 2s: nothing.
  assert.deepEqual(statGainFlags({ type: "APPLY_STAR_REWARD" }, R(1000, 0, 100), R(1200, 0, 100)), NONE);
  // A buff starting (Frenzy x3): the rate bumps.
  assert.deepEqual(statGainFlags({ type: "APPLY_STAR_REWARD" }, R(1000, 0, 100), R(1000, 0, 300)), { ...NONE, rate: true });
  // A ship: Money up (and LOC down, which never bumps), against the auto-ship cash rate.
  assert.deepEqual(statGainFlags({ type: "COMPLETE_PROJECT" }, R(5000, 0, 100, 0), R(4000, 2500, 100, 0)), { ...NONE, money: true });
  assert.deepEqual(statGainFlags({ type: "COMPLETE_PROJECT" }, R(5000, 0, 100, 1000), R(4000, 2500, 100, 1000)), NONE, "2.5s of auto-ship cash");
  // The Night Shift report: its credited LOC (already in the numbers from the load).
  assert.deepEqual(statGainFlags({ type: "NIGHT_SHIFT_REPORT", payload: { creditedLoc: 136959 } }, R(9e8, 0, 190), R(9e8, 0, 190)), { ...NONE, loc: true });
  assert.deepEqual(statGainFlags({ type: "NIGHT_SHIFT_REPORT", payload: { creditedLoc: 500 } }, R(9e8, 0, 190), R(9e8, 0, 190)), NONE);
  // The Starting Capital grant (STAT_GAIN): Money, from zero production.
  assert.deepEqual(statGainFlags({ type: "STAT_GAIN", payload: { money: 4065 } }, R(0, 4065, 0), R(0, 4065, 0)), { ...NONE, money: true });
});

test("never: save load and restore, ticks, clicks, and decreases", () => {
  assert.deepEqual([...STAT_GAIN_NEVER_ACTIONS], ["RESTORE_SAVE", "GAME_TICK", "WRITE_CODE"]);
  // Huge rises on these never bump: a load showing the numbers, a tick, a click.
  for (const type of STAT_GAIN_NEVER_ACTIONS) {
    assert.deepEqual(statGainFlags({ type }, R(0, 0, 0), R(1e12, 1e12, 1e9)), NONE, type);
  }
  // Decreases from any source never bump: spending, a buy, a sale reset.
  for (const type of ["APPLY_STAR_REWARD", "COMPLETE_PROJECT", "BUY_EMPLOYEE", "BUY_STAR", "STAT_GAIN", "NIGHT_SHIFT_REPORT"]) {
    assert.deepEqual(statGainFlags({ type, payload: { money: -5, loc: -5, creditedLoc: -5 } }, R(1e6, 1e6, 100), R(10, 10, 50)), NONE, type);
  }
  // Other actions bump only the rate, never LOC or Money (a hire spends Money).
  assert.deepEqual(statGainFlags({ type: "BUY_EMPLOYEE" }, R(0, 5000, 100), R(1e9, 1e9, 115)), { ...NONE, rate: true });
  assert.deepEqual(statGainFlags({ type: "SELL_LLAMA" }, R(0, 0, 100), R(0, 1e9, 100)), NONE);
  // The reducer: ticks, clicks and restores return before anything is measured...
  assert.match(context, /function withStatGain\(prev, next, action\) \{\s*\/\/ Ticks, clicks and restores: never examined \(and never measured\)\.\s*if \(STAT_GAIN_NEVER_ACTIONS\.includes\(action\.type\)\) return next;/);
  // ...and a load or restore clears any pending gain.
  const restore = context.slice(context.indexOf('case "RESTORE_SAVE": {'), context.indexOf("// if action type doesn't make sense"));
  assert.match(restore, /statGain: null,/);
  // The intermission completion builds the new company through that same
  // restore; only a fresh grant then bumps Money.
  assert.match(context, /const grantCents = result\?\.grant\?\.applied \? Number\(result\.grant\.cashCents\) : 0;\s*if \(result\?\.ok && !result\.alreadyCompleted && grantCents > 0\) \{\s*dispatch\(\{ type: "STAT_GAIN", payload: \{ money: grantCents \} \}\);/);
  // statGain is transient: never saved.
  assert.ok(!src("save/serialize.js").includes("statGain"));
});

test("the reducer wiring: every action passes through the detector, with LOC/s and auto-ship cash/s as production", () => {
  assert.match(context, /const next = withStatGain\(state, gameReducer\(state, action\), action\);/);
  assert.match(context, /rate: calculateLOCPerSecond\(state\),\s*moneyRate: getReleaseManagerEconomics\(state\)\.cashPerSecond,/);
  assert.match(context, /const statGain = nextStatGain\(next\.statGain, flags, Date\.now\(\)\);/);
  assert.match(context, /"RESTORE_SAVE",\s*\/\/ The numbers react \(issue #214\): presentation only\.\s*"STAT_GAIN",/);
});

test("restart, not stack: each gain is a new seq; a stat follows only its own; an old gain never replays on mount", () => {
  assert.equal(nextStatGain(null, NONE, 1), null);
  const g1 = nextStatGain(null, { ...NONE, loc: true }, 1000);
  assert.deepEqual(g1, { seq: 1, loc: true, money: false, rate: false, atMs: 1000 });
  const g2 = nextStatGain(g1, { ...NONE, money: true }, 1100);
  assert.equal(g2.seq, 2);
  assert.equal(nextStatGain(g2, NONE, 1200), g2, "nothing new: the same gain");
  // The LOC stat restarts on g1, ignores g2 (Money only), restarts again on g3.
  let loc = statPulseAfter(0, g1, "loc");
  assert.equal(loc, 1);
  loc = statPulseAfter(loc, g2, "loc");
  assert.equal(loc, 1, "a Money gain does not restart the LOC bump");
  const g3 = nextStatGain(g2, { ...NONE, loc: true }, 1300);
  assert.equal(statPulseAfter(loc, g3, "loc"), 3, "a new key: the value remounts and the bump restarts");
  // On mount: only a fresh gain plays (the header returning after the intermission).
  assert.equal(STAT_GAIN_FRESH_MS, 1500);
  assert.equal(statGainFreshOnMount(g2, "money", 1100 + 200), true);
  assert.equal(statGainFreshOnMount(g2, "money", 1100 + 1501), false);
  assert.equal(statGainFreshOnMount(g2, "loc", 1100), false);
  assert.equal(statGainFreshOnMount(null, "loc", 0), false);
  // The value is keyed by the pulse, so a restart remounts it.
  const display = src("components/StatDisplay.jsx");
  assert.match(display, /<span\s*key=\{bumpKey\}/);
  assert.match(display, /bump && bumpKey \? `stat-value stat-bump stat-bump--\$\{bump\}` : "stat-value"/);
  assert.match(display, /data-value=\{value\}/);
  const hook = src("hooks/useStatBump.js");
  assert.match(hook, /statGainFreshOnMount\(gain, key, Date\.now\(\)\) \? gain\.seq : 0/);
  assert.match(hook, /setPulse\(\(current\) => statPulseAfter\(current, gain, key\)\);/);
  const box = src("components/StatBox.jsx");
  for (const key of ["loc", "money", "rate"]) {
    assert.match(box, new RegExp(`useStatBump\\(state\\.statGain, "${key}"\\)`));
    assert.match(box, new RegExp(`bump="${key}"`));
  }
});

test("the look: scale 1 to 1.14 to 1, the gain color flashing back to #ccc, the underline sweep, 360ms", () => {
  assert.equal(STAT_BUMP_MS, 360);
  assert.deepEqual({ ...STAT_GAIN_COLORS }, { loc: "#4ade80", money: "#facc15", rate: "#60a5fa" });
  for (const [key, color] of Object.entries(STAT_GAIN_COLORS)) {
    assert.ok(rule(`.stat-bump--${key}`).includes(`--stat-gain-color: ${color};`), key);
  }
  assert.ok(rule(".stat-bump").includes("animation: stat-bump 360ms cubic-bezier(0.16, 1, 0.3, 1);"));
  assert.match(keyframes("stat-bump"), /0% \{\s*transform: scale\(1\);\s*\}\s*40% \{\s*transform: scale\(1\.14\);\s*\}\s*100% \{\s*transform: scale\(1\);/);
  // The flash: the value in the gain color over the #ccc text, fading out.
  const flash = rule(".stat-bump::before");
  for (const decl of ["content: attr(data-value);", "color: var(--stat-gain-color);", "animation: stat-bump-flash 360ms cubic-bezier(0.16, 1, 0.3, 1);", "pointer-events: none;"]) {
    assert.ok(flash.includes(decl), decl);
  }
  assert.match(src("index.css"), /--primary-text-color: #ccc;/);
  // The underline: 2px, scaleX 0 to 1 from the left, then fades.
  const line = rule(".stat-bump::after");
  for (const decl of ["height: 2px;", "transform-origin: left;", "transform: scaleX(0);", "animation: stat-bump-underline 360ms cubic-bezier(0.16, 1, 0.3, 1);"]) {
    assert.ok(line.includes(decl), decl);
  }
  assert.match(keyframes("stat-bump-underline"), /70% \{\s*transform: scaleX\(1\);\s*opacity: 1;\s*\}\s*100% \{\s*transform: scaleX\(1\);\s*opacity: 0;/);
});

test("shared rules: transform and opacity only, no layout change, no taps taken", () => {
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) {
    for (const prop of m[2].matchAll(/([a-z-]+):/g)) {
      assert.ok(["transform", "opacity"].includes(prop[1]), `${m[1]} animates ${prop[1]}`);
    }
  }
  assert.ok(!/transition/.test(css));
  // The value is a flex item (blockified already): inline-block and relative change no layout.
  assert.match(src("components/StatDisplay.jsx"), /className="flex flex-col items-center w-20"/);
  const value = rule(".stat-value");
  assert.ok(value.includes("display: inline-block;") && value.includes("position: relative;"));
  for (const sel of [".stat-bump::before", ".stat-bump::after"]) {
    assert.ok(rule(sel).includes("pointer-events: none;"), sel);
  }
  assert.ok(!/z-index/.test(css), "inside the stat's own box, no layer");
});

test("reduced motion: the color flash alone", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
  assert.match(reduced, /\.stat-bump \{\s*animation: none;/);
  assert.match(reduced, /\.stat-bump::after \{\s*animation: none;\s*display: none;/);
  assert.ok(!reduced.includes(".stat-bump::before"), "the flash still plays");
});

test("no copy, no dashes, no balance change", () => {
  for (const file of [css, src("utils/statGain.js"), src("hooks/useStatBump.js")]) {
    assert.ok(!/[—–]/.test(file));
  }
});
