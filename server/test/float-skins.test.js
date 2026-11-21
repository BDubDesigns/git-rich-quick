/**
 * Tests for issue #212 (Slice A of the #210 game-feel pass): the float
 * pill skins. The click float becomes the diff chip and the star claim
 * label the CI badge. LOOK ONLY: the click float's behavior is locked
 * (helpers/commit-float-lock.js), and the #205 and #209 pins
 * (star-labels.test.js, star-label-on-screen.test.js) run unmodified.
 *
 * jellybean's condition: the badge is taller than the one-line pill, so
 * a star at the very top of the screen must not clip more than before.
 * The label gets the minimum downward nudge (starLabelNudgeY) that
 * keeps its top edge on screen at the end of its rise.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  shootingStarsChainClaim,
  starEffectName,
  starRewardDetail,
} from "../../shared/game-balance.js";
import {
  splitStarLabel,
  starBadge,
  starBadgeChip,
  starBadgeKind,
} from "../../client/src/utils/starBadge.js";
import {
  FLOATING_TEXT_VARIANTS,
  floatingTextRise,
} from "../../client/src/utils/floatingTextVariants.js";
import {
  STAR_LABEL_EDGE_MARGIN_PX,
  starLabelNudgeY,
} from "../../client/src/utils/starLabelNudge.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const css = src("components/FloatingText.css");
const component = src("components/FloatingText.jsx");
const M = STAR_LABEL_EDGE_MARGIN_PX;

/** A rule's body by its exact selector. */
function rule(selector) {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return css.slice(start, css.indexOf("\n}", start + 1));
}

/** The skins section: everything after the Slice A marker. */
const skins = css.slice(css.indexOf("Skins (issue #212"));

const GOLD = { effect: "lucky", good: true, locDelta: 7820, moneyDelta: 0 };
const CRASH = { effect: "frenzy", good: false, multiplier: 0.5, red: true };
const MOON = { effect: "moonshot", good: true, multiplier: 25, durationSeconds: 15, red: true };

test("the Commit float's behavior is unchanged: origin, 1.25s, 100px rise, text-2xl, z-index 60, 6 alive", () => {
  assertCommitFloatLocked();
});

test("A1: the click float wears the diff chip, with the exact proposal values", () => {
  assert.equal(FLOATING_TEXT_VARIANTS.default.pillClass, "diff-chip px-3 py-1", "padding unchanged");
  const chip = rule(".diff-chip");
  for (const decl of [
    "background: linear-gradient(180deg, rgba(16, 28, 20, 0.92), rgba(8, 16, 11, 0.92));",
    "border: 1px solid rgba(74, 222, 128, 0.55);",
    "color: #4ade80;",
    "text-shadow: 0 0 6px rgba(74, 222, 128, 0.45);",
    'font-family: "Cascadia Code", monospace;',
    "font-variant-numeric: tabular-nums;",
    "letter-spacing: -0.01em;",
  ]) {
    assert.ok(chip.includes(decl), decl);
  }
  // The shadow stack, with the diff gutter as an inset (no extra element).
  assert.match(chip, /box-shadow:\s*0 4px 12px rgba\(0, 0, 0, 0\.55\),\s*inset 0 1px 0 rgba\(255, 255, 255, 0\.06\),\s*inset 3px 0 0 rgba\(74, 222, 128, 0\.8\);/);
  // The old green-600 text and 60% black are gone; the shape stays.
  assert.ok(!component.includes("text-green-600"));
  assert.ok(!/bg-black\/60/.test(src("utils/floatingTextVariants.js")));
  assert.match(component, /: "whitespace-nowrap rounded-full";/);
  // The </> icon is still the one the Commit button passes in.
  assert.match(src("components/ClickButton.jsx"), /icon=\{<HiMiniCodeBracket size=\{20\} \/>\}/);
});

test("A2: each claim kind gets its badge and chip: PASS, FAIL, To the Moon x25, chain x7 / x77 / x777", () => {
  assert.equal(starBadgeKind(GOLD), "pass");
  assert.equal(starBadgeChip(GOLD), "✓ PASS");
  assert.equal(starBadgeKind(CRASH), "fail");
  assert.equal(starBadgeChip(CRASH), "✗ FAIL");
  assert.equal(starBadgeKind(MOON), "moon");
  assert.equal(starBadgeChip(MOON), "🚀 x25");
  for (const [step, chip] of [[1, "x7"], [2, "x77"], [3, "x777"]]) {
    const claim = shootingStarsChainClaim(step, 100);
    assert.equal(starBadgeKind(claim), "chain");
    assert.equal(starBadgeChip(claim), chip);
  }
  // A bad gold star is still a gold star (the proposal's table: gold is PASS).
  assert.equal(starBadgeKind({ effect: "frenzy", good: false }), "pass");
});

test("A2: the label splits on its first \"! \" into name and detail; the text itself is unchanged", () => {
  assert.deepEqual(splitStarLabel("Airdrop! +$33.01K"), { name: "Airdrop!", detail: "+$33.01K" });
  assert.deepEqual(splitStarLabel("Sprint! Senior Developer x12 for 60s"), { name: "Sprint!", detail: "Senior Developer x12 for 60s" });
  assert.deepEqual(splitStarLabel("Golden Star!"), { name: "Golden Star!", detail: "" });
  assert.deepEqual(splitStarLabel("Wow! Such! Detail"), { name: "Wow!", detail: "Such! Detail" });
  assert.deepEqual(splitStarLabel(undefined), { name: "", detail: "" });
  // Built from the real label: name + "! " + detail is exactly it.
  const label = `${starEffectName(MOON.effect, true)}! ${starRewardDetail(MOON)}`;
  const badge = starBadge(MOON, label);
  assert.equal(badge.label, label);
  assert.equal(`${badge.name} ${badge.detail}`, label);
  assert.equal(badge.name, "To the Moon!");
  assert.equal(badge.kind, "moon");
  // No em or en dashes in any chip.
  for (const claim of [GOLD, CRASH, MOON, shootingStarsChainClaim(3, 1)]) {
    assert.ok(!/[—–]/.test(starBadgeChip(claim)));
  }
});

test("A2: the badge palettes, shape and type, as the proposal's table", () => {
  assert.equal(FLOATING_TEXT_VARIANTS.star.pillClass, "ci-badge");
  const base = rule(".ci-badge");
  assert.ok(base.includes("padding: 6px 12px;"));
  assert.match(base, /box-shadow:\s*0 6px 20px rgba\(0, 0, 0, 0\.6\),\s*var\(--ci-glow\);/);
  assert.ok(base.includes("border: 1px solid var(--ci-border);"));
  assert.ok(base.includes("background: var(--ci-bg);"));
  const palette = {
    ".ci-badge": ["--ci-bg: rgba(22, 18, 6, 0.95);", "--ci-border: rgba(255, 215, 0, 0.75);", "--ci-name: #ffd700;", "--ci-glow: 0 0 18px rgba(255, 215, 0, 0.25);", "--ci-chip-bg: rgba(255, 215, 0, 0.25);"],
    ".ci-badge--fail": ["--ci-bg: rgba(26, 8, 8, 0.95);", "--ci-border: rgba(255, 77, 77, 0.75);", "--ci-name: #ff6b6b;", "--ci-glow: 0 0 18px rgba(255, 77, 77, 0.25);", "--ci-chip-bg: rgba(255, 77, 77, 0.25);"],
    ".ci-badge--moon": ["--ci-bg: linear-gradient(90deg, rgba(40, 10, 10, 0.96), rgba(40, 32, 6, 0.96));", "--ci-border: rgba(255, 215, 0, 0.9);", "--ci-glow: 0 0 22px rgba(255, 140, 0, 0.45);"],
  };
  for (const [selector, decls] of Object.entries(palette)) {
    for (const decl of decls) assert.ok(rule(selector).includes(decl), `${selector} ${decl}`);
  }
  // Chain and pass use gold (they set nothing but the gold background).
  assert.ok(!/--ci-border|--ci-name/.test(rule(".ci-badge--chain")));
  assert.ok(!/--ci-border|--ci-name/.test(rule(".ci-badge--pass")));
  // The chip: 11px bold uppercase monospace, 1px 6px, radius 6px.
  const chip = rule(".ci-badge-chip");
  for (const decl of ["font-size: 11px;", "font-weight: 700;", "text-transform: uppercase;", "padding: 1px 6px;", "border-radius: 6px;", 'font-family: "Cascadia Code", monospace;', "background: var(--ci-chip-bg);"]) {
    assert.ok(chip.includes(decl), decl);
  }
  // Name text-2xl bold (the variant's size), detail text-lg semibold #f5f5f5 under it.
  assert.equal(FLOATING_TEXT_VARIANTS.star.fontClass, "text-2xl");
  assert.ok(rule(".ci-badge-name").includes("font-weight: 700;"));
  const detail = rule(".ci-badge-detail");
  for (const decl of ["font-size: 1.125rem;", "font-weight: 600;", "color: #f5f5f5;"]) assert.ok(detail.includes(decl), decl);
  assert.ok(rule(".ci-badge-body").includes("flex-direction: column;"), "the detail sits under the name");
  // Still rounded-2xl and capped at the viewport width (it wraps).
  assert.match(component, /"whitespace-normal text-center max-w-\[calc\(100vw-16px\)\] rounded-2xl"/);
});

test("A2 wiring: the star claim passes the badge; FloatingText renders chip, name and detail with the kind class", () => {
  const star = src("components/GoldenStar.jsx");
  assert.match(star, /starBadge\(claim, starRewardLabel\(claim\)\),/);
  assert.match(component, /const badge = isStar && text && typeof text === "object" \? text : null;/);
  assert.match(component, /const skinClass = badge \? `ci-badge--\$\{badge\.kind\}` : "";/);
  assert.match(component, /<span className="ci-badge-chip">\{badge\.chip\}<\/span>/);
  assert.match(component, /<span className="ci-badge-name">\{badge\.name\}<\/span>/);
  assert.match(component, /<span className="ci-badge-detail">\{badge\.detail\}<\/span>/);
  assert.match(component, /aria-label=\{badge\.label\}/);
  // Every other float still renders its plain text.
  assert.match(component, /<span>\{text\}<\/span>/);
});

test("look only: the skins animate nothing and keep the float untouchable", () => {
  for (const banned of ["animation", "transition", "transform", "translate", "will-change"]) {
    // A declaration of the property (text-transform is not one).
    assert.ok(!new RegExp(`(^|[\\s;{])${banned}(-[a-z-]+)?\\s*:`).test(skins), `no ${banned} in the skins`);
  }
  assert.ok(!skins.includes("@keyframes"));
  assert.match(component, /select-none pointer-events-none fixed/);
  // The star label's motion and layer are the #205 ones.
  assert.equal(FLOATING_TEXT_VARIANTS.star.durationMs, 2750);
  assert.equal(FLOATING_TEXT_VARIANTS.star.zIndex, 70);
});

test("top edge: the taller badge never ends its rise off the top; the nudge is the minimum and 0 mid-screen", () => {
  // Measured in a Pixel 7: the star at the top margin (its top at 12px)
  // spawns the label centered at y 12. The one-line pill (40px) clipped
  // 8px on master; the two-line badge (74px) would clip 25px.
  const y = 12;
  for (const height of [40, 74, 102]) {
    const rise = floatingTextRise("star", y);
    const top = y - height / 2;
    const nudge = starLabelNudgeY(top, rise);
    assert.equal(top - rise + nudge, M, `height ${height}: the top edge lands on the margin`);
  }
  // Anywhere the badge already ends on screen, it is not moved.
  for (const y2 of [300, 500, 743]) {
    assert.equal(starLabelNudgeY(y2 - 37, floatingTextRise("star", y2)), 0, `y ${y2}`);
  }
  // A sweep: every spawn height, every badge height, ends inside, minimally.
  for (let yy = 0; yy <= 900; yy += 1) {
    for (const height of [40, 74, 102]) {
      const rise = floatingTextRise("star", yy);
      const top = yy - height / 2;
      const nudge = starLabelNudgeY(top, rise);
      assert.ok(nudge >= 0);
      const endTop = top - rise + nudge;
      assert.ok(endTop >= M - 1e-9, `y ${yy} h ${height}`);
      if (nudge > 0) assert.equal(endTop, M, "pushed exactly onto the margin");
    }
  }
  for (const junk of [[Number.NaN, 0], [0, Infinity], [undefined, 3]]) {
    assert.equal(starLabelNudgeY(...junk), 0);
  }
});

test("top edge wiring: measured from a zero nudge with the label's own rise, applied as a static margin", () => {
  const hook = src("hooks/useStarLabelNudge.js");
  assert.match(hook, /el\.style\.setProperty\("--star-nudge-y", "0px"\);\s*el\.style\.setProperty\("--star-nudge-x", "0px"\);\s*const rect = el\.getBoundingClientRect\(\);/);
  assert.match(hook, /const rise = parseFloat\(el\.style\.getPropertyValue\("--float-rise"\)\);/);
  assert.match(hook, /const nudgeY = starLabelNudgeY\(rect\.top, rise\);/);
  assert.match(hook, /el\.style\.setProperty\("--star-nudge-y", `\$\{nudgeY\}px`\);/);
  assert.ok(rule(".ci-badge").includes("margin-top: var(--star-nudge-y, 0px);"));
  // Only the star badge reads it; the click float never does.
  assert.ok(!rule(".diff-chip").includes("--star-nudge"));
});
