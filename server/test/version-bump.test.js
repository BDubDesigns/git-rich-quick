/**
 * Tests for issue #216 (Slice 4 of the #210 game-feel pass): the
 * version bump. A successful CONTRIBUTE_TO_PROJECT rolls that Open
 * Source card's version text (the old one slides up and out, the new
 * one slides in, inside a clipped one-line box) and sweeps a 1px
 * #84bd6a line across the card's top border, 320ms. Presentation only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VERSION_ROLL_FRESH_MS,
  VERSION_ROLL_MS,
  nextContribution,
  versionRollAfter,
  versionRollFreshOnMount,
  versionText,
} from "../../client/src/utils/versionRoll.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/VersionRoll.css");
const card = src("components/OpenSourceCard.jsx");
const context = src("context/GameContext.jsx");

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

test("trigger: a successful contribution records the roll; a refused one and a restore never do", () => {
  const contribute = context.slice(context.indexOf('case "CONTRIBUTE_TO_PROJECT": {'), context.indexOf('case "FAVORITE_OPEN_SOURCE_PROJECT"'));
  // Recorded only in the success branch, after every refusal returns state.
  const success = contribute.indexOf("const contributed = {");
  assert.ok(success > 0);
  assert.ok(contribute.lastIndexOf("return state;", success) < success, "refusals return before it");
  assert.match(contribute.slice(success), /lastContribution: nextContribution\(\s*state\.lastContribution,\s*projectId,\s*projectState\.level,\s*projectState\.level \+ 1,\s*Date\.now\(\)\s*\),/);
  const restore = context.slice(context.indexOf('case "RESTORE_SAVE": {'), context.indexOf("// if action type doesn't make sense"));
  assert.match(restore, /lastContribution: null,/);
  assert.ok(!src("save/serialize.js").includes("lastContribution"), "never saved");
  // The record.
  const a = nextContribution(null, "overReactFramework", 5, 6, 1000);
  assert.deepEqual(a, { projectId: "overReactFramework", from: 5, to: 6, seq: 1, atMs: 1000 });
  assert.equal(nextContribution(a, "blocker", 4, 5, 1100).seq, 2);
});

test("one card per contribution: its own project rolls, restarts on a new one, never another card", () => {
  const a = nextContribution(null, "overReactFramework", 5, 6, 1000);
  const b = nextContribution(a, "blocker", 4, 5, 1100);
  assert.equal(versionRollAfter(null, a, "overReactFramework"), a);
  assert.equal(versionRollAfter(null, a, "blocker"), null, "another card is untouched");
  assert.equal(versionRollAfter(a, b, "overReactFramework"), a, "a contribution elsewhere does not restart it");
  const c = nextContribution(b, "overReactFramework", 6, 7, 1200);
  assert.equal(versionRollAfter(a, c, "overReactFramework"), c, "a new seq restarts, never stacks");
  // The card keys the roll and the sweep on seq.
  assert.match(card, /<VersionRoll key=\{roll \? `roll-\$\{roll\.seq\}` : "rest"\} level=\{currentLevel\} roll=\{roll\} \/>/);
  assert.match(card, /\{roll && <VersionSweep key=\{`sweep-\$\{roll\.seq\}`\} \/>\}/);
  assert.match(card, /const roll = useVersionRoll\(gameState\.lastContribution, projectId\);/);
});

test("the last level: a card that remounts into Maxed Out still rolls, ending on MAXED OUT; an old one never replays", () => {
  assert.equal(VERSION_ROLL_FRESH_MS, 1000);
  const last = nextContribution(null, "blocker", 4, 5, 1000);
  assert.equal(versionRollFreshOnMount(last, "blocker", 1000 + 300), true);
  assert.equal(versionRollFreshOnMount(last, "blocker", 1000 + 1001), false);
  assert.equal(versionRollFreshOnMount(last, "overReactFramework", 1100), false);
  assert.equal(versionRollFreshOnMount(null, "blocker", 0), false);
  assert.match(src("hooks/useVersionRoll.js"), /versionRollFreshOnMount\(contribution, projectId, Date\.now\(\)\) \? contribution : null/);
  // The maxed card keeps its MAXED OUT line.
  assert.match(card, /"\/\/ MAXED OUT"/);
});

test("the look: the version rolls in a clipped one-line box, and a 1px #84bd6a line sweeps the top border, 320ms", () => {
  assert.equal(VERSION_ROLL_MS, 320);
  assert.equal(versionText(6), "v.6.0");
  assert.equal(versionText(0), "v.0.0");
  assert.equal(versionText(Number.NaN), "v.0.0");
  const box = rule(".version-roll");
  for (const decl of ["display: inline-flex;", "flex-direction: column;", "height: 1lh;", "overflow: hidden;"]) {
    assert.ok(box.includes(decl), decl);
  }
  assert.ok(rule(".version-roll-old").includes("animation: version-roll-out 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards;"));
  assert.ok(rule(".version-roll-new").includes("animation: version-roll-in 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards;"));
  assert.match(keyframes("version-roll-out"), /to \{\s*transform: translateY\(-100%\);\s*opacity: 0;/);
  assert.match(keyframes("version-roll-in"), /from \{\s*transform: translateY\(0\);\s*opacity: 0;\s*\}\s*to \{\s*transform: translateY\(-100%\);\s*opacity: 1;/);
  const sweep = rule(".version-sweep");
  for (const decl of ["height: 1px;", "background: #84bd6a;", "transform-origin: left;", "transform: scaleX(0);", "pointer-events: none;", "animation: version-sweep 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards;"]) {
    assert.ok(sweep.includes(decl), decl);
  }
  assert.match(keyframes("version-sweep"), /80% \{\s*transform: scaleX\(1\);\s*opacity: 1;/);
  // Contained in the card: the sweep sits in the card's own Panel.
  assert.match(card, /<Panel className="relative px-3 pb-1 flex flex-col gap-1 m-0">/);
  // The roll's accessible name is the new version only.
  assert.match(src("components/VersionRoll.jsx"), /aria-label=\{versionText\(level\)\}/);
});

test("shared rules: transform and opacity only, pointer-events none, no layer, the Contribute bounce and float unchanged", () => {
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) {
    for (const prop of m[2].matchAll(/([a-z-]+):/g)) {
      assert.ok(["transform", "opacity"].includes(prop[1]), `${m[1]} animates ${prop[1]}`);
    }
  }
  assert.ok(!/transition|z-index/.test(css));
  for (const sel of [".version-roll-old", ".version-sweep"]) assert.ok(rule(sel).includes("pointer-events: none;"), sel);
  // The Contribute button and its float are the existing ones.
  assert.match(card, /<ActionButton\s*onClick=\{handleContributeClick\}\s*disabled=\{!canContribute \|\| isMaxed \|\| isRoundLocked \|\| confirming\}\s*floatText=\{floatText\}/);
});

test("reduced motion: no slide, the new version shows at once, the top line shows whole for 320ms", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
  assert.match(reduced, /\.version-roll-old \{\s*display: none;/);
  assert.match(reduced, /\.version-roll-new \{\s*animation: none;\s*transform: none;\s*opacity: 1;/);
  assert.match(reduced, /\.version-sweep \{\s*transform: none;\s*animation: version-sweep-still 320ms steps\(1, end\) forwards;/);
  assert.ok(!/transform/.test(keyframes("version-sweep-still")));
});

test("no copy added, no dashes", () => {
  for (const file of [css, src("components/VersionRoll.jsx"), src("utils/versionRoll.js"), src("hooks/useVersionRoll.js")]) {
    assert.ok(!/[—–]/.test(file));
  }
});
