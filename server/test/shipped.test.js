/**
 * Tests for issue #219 (Slice 7 of the #210 game-feel pass), with its
 * Nov 21 amendment (issue #229's rule: passive income streams get bars
 * or pulses, events get chips):
 * - a manual Ship tap's float wears the cash version of the Slice A
 *   diff chip (gold), scoped to the Ship button, the float's own files
 *   and behavior untouched;
 * - Release Manager auto-ships get NO floating chip: the shipping
 *   strip's Cash readout does a Slice 2 bump, at most once a second.
 * Presentation only: payouts and shipping logic are untouched.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CASH_PULSE_MIN_GAP_MS,
  cashPulseAfter,
  nextAutoShipPulse,
} from "../../client/src/utils/shipFeel.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const chipCss = src("components/ShipChip.css");
const card = src("components/ProjectCard.jsx");
const strip = src("components/ReleaseManagerShippingSummary.jsx");
const context = src("context/GameContext.jsx");

test("the Commit float's behavior is unchanged: its files have no diff", () => {
  assertCommitFloatLocked();
});

test("manual Ship: the cash diff chip, scoped to the Ship button, static colors only", () => {
  const start = chipCss.indexOf(".ship-action .floating-text.diff-chip {");
  assert.ok(start >= 0, "scoped to the Ship button's wrapper");
  const rule = chipCss.slice(start, chipCss.indexOf("\n}", start));
  for (const decl of ["background: rgba(28, 24, 8, 0.92);", "border-color: rgba(250, 204, 21, 0.55);", "color: #facc15;"]) {
    assert.ok(rule.includes(decl), decl);
  }
  assert.match(rule, /inset 3px 0 0 rgba\(250, 204, 21, 0\.8\);/, "the diff gutter in gold");
  // Look only: no motion, so the float's timing and behavior are the existing ones.
  const code = chipCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const banned of ["animation", "transition", "transform", "translate", "z-index", "@keyframes"]) {
    assert.ok(!new RegExp(`(^|[\\s;{])${banned}(-[a-z-]+)?\\s*:`).test(code) && !code.includes("@keyframes"), `no ${banned}`);
  }
  // The Ship button carries the scope; its float text and icon are unchanged.
  assert.match(card, /<ActionButton\s*onClick=\{onComplete\}\s*disabled=\{!canComplete\}\s*floatText=\{`\+\$\{payoutText\}`\}\s*icon=\{<HiOutlineBanknotes size=\{20\} \/>\}\s*fullWidth=\{false\}\s*className="ship-action"\s*>/);
  assert.match(card, /import "\.\/ShipChip\.css";/);
  // The scope reaches the float: ActionButton puts the class on the div the float renders in.
  assert.match(src("components/ActionButton.jsx"), /mt-auto \$\{className\}`\}/);
});

test("Release Manager auto-ships: NO floating chip; the tick records a pulse only when it auto-shipped", () => {
  const tick = context.slice(context.indexOf('case "GAME_TICK": {'), context.indexOf('case "CONTRIBUTE_TO_PROJECT": {'));
  assert.match(tick, /autoShipPulse: nextAutoShipPulse\(state\.autoShipPulse, autoShipCount, Date\.now\(\)\),/);
  assert.ok(!/triggerFloatingText|FloatingText|floatText/.test(strip), "the strip has no float");
  assert.ok(!/gameTickAnimation/.test(tick), "the tick dispatches no float for ships");
  assert.equal(nextAutoShipPulse(null, 0, 1000), null);
  assert.deepEqual(nextAutoShipPulse(null, 24, 1000), { seq: 1, atMs: 1000 });
  const p = { seq: 4, atMs: 900 };
  assert.equal(nextAutoShipPulse(p, 0, 1000), p, "a tick with no ship keeps it");
  assert.equal(nextAutoShipPulse(p, Number.NaN, 1000), p);
  // A restore never pulses; never saved.
  const restore = context.slice(context.indexOf('case "RESTORE_SAVE": {'), context.indexOf("// if action type doesn't make sense"));
  assert.match(restore, /autoShipPulse: null,/);
  assert.ok(!src("save/serialize.js").includes("autoShipPulse"));
});

test("the once-a-second cap: a new record bumps only if the last bump was at least 1000ms ago", () => {
  assert.equal(CASH_PULSE_MIN_GAP_MS, 1000);
  let pulse = null;
  pulse = cashPulseAfter(pulse, { seq: 1 }, 10_000);
  assert.deepEqual(pulse, { key: 1, atMs: 10_000 });
  // Records arriving faster (a burst of ticks) do not bump again.
  for (const [seq, t] of [[2, 10_200], [3, 10_500], [4, 10_999]]) {
    assert.equal(cashPulseAfter(pulse, { seq }, t), pulse, `seq ${seq} at +${t - 10_000}ms`);
  }
  pulse = cashPulseAfter(pulse, { seq: 5 }, 11_000);
  assert.deepEqual(pulse, { key: 5, atMs: 11_000 }, "a second later it bumps");
  assert.equal(cashPulseAfter(pulse, null, 20_000), pulse);
  // Over a minute of records every 250ms, never more than one bump a second.
  let p2 = null; const bumps = [];
  for (let t = 0; t < 60_000; t += 250) {
    const next = cashPulseAfter(p2, { seq: t / 250 + 1 }, t);
    if (next !== p2) bumps.push(t);
    p2 = next;
  }
  assert.equal(bumps.length, 60);
  assert.ok(bumps.slice(1).every((t, i) => t - bumps[i] >= 1000));
});

test("the readout bump: the Slice 2 bump in gold on the Cash per second value, keyed per pulse, never on mount", () => {
  assert.match(strip, /const cashPulse = useCashPulse\(state\.autoShipPulse\);/);
  assert.match(strip, /key=\{cashPulse\}\s*className=\{`text-green-400\$\{cashPulse \? " stat-value stat-bump stat-bump--money" : ""\}`\}\s*data-value=\{`\+\$\{formatMoney\(econ\.cashPerSecond\)\}`\}/);
  assert.match(src("components/StatBump.css"), /\.stat-bump--money \{\s*--stat-gain-color: #facc15;/);
  // Slice 2's own rules: 360ms, transform and opacity, a reduced-motion fallback.
  const bump = src("components/StatBump.css");
  assert.match(bump, /animation: stat-bump 360ms/);
  assert.match(bump, /@media \(prefers-reduced-motion: reduce\)/);
  const hook = src("hooks/useCashPulse.js");
  assert.match(hook, /const \[pulse, setPulse\] = useState\(null\);/);
  assert.match(hook, /setPulse\(\(current\) => cashPulseAfter\(current, record, Date\.now\(\)\)\);/);
});

test("payouts and shipping are untouched; no dashes", () => {
  assert.match(context, /const payout = shared\.freelanceShipPayoutCents\(/);
  for (const file of [chipCss, src("utils/shipFeel.js"), src("hooks/useCashPulse.js")]) assert.ok(!/[—–]/.test(file));
});
