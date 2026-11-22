/**
 * The Night Shift card redesign (Brandon's Nov 21 playtest: "Ugly tho.
 * The card is plain and id like it to collapse, takes up too much
 * space."):
 *
 * - The open/closed choice is a device preference under
 *   `grq:nightShiftOpen`, collapsed by default, never in the save, and
 *   blocked or throwing storage never breaks the card.
 * - The collapsed row's copy (chip, button label, short disabled
 *   reason) comes from nightShiftRowModel over the shared purchase
 *   result, including "L5/5 Maxed" with no buy button at max level.
 * - The card speaks the Hire tab's JSDoc language and its toggle is a
 *   real disclosure button (aria-expanded / aria-controls).
 * - An email link to the card (item id "nightShift") opens it before
 *   the HighlightAnchor scrolls and flashes.
 *
 * The client components import React, so the component checks are
 * source checks, like the rest of the suite.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NIGHT_SHIFT_CONFIG,
  NIGHT_SHIFT_EMAIL_ITEM_ID,
  nightShiftNextPurchase,
} from "../../shared/game-balance.js";
import {
  NIGHT_SHIFT_OPEN_KEY,
  nightShiftRowModel,
  readNightShiftOpen,
  writeNightShiftOpen,
} from "../../client/src/utils/nightShiftCard.js";
import {
  consumeHighlight,
  highlightMatches,
  navigateToTarget,
} from "../../client/src/navigation/highlight.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const card = () => src("components/NightShiftCard.jsx");

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const MAX = NIGHT_SHIFT_CONFIG.maxLevel;

// A purchase result shaped like nightShiftNextPurchase's.
function purchase({ level = 2, met = true, affordable = true } = {}) {
  return {
    level,
    priceCents: 2_008_000,
    gate: {
      met,
      locPerSecond: { current: 425, target: 1_000 },
      employees: { employeeType: "senior", current: 3, target: 5 },
    },
    affordable,
    canBuy: met && affordable,
  };
}

// --- The device preference ---

test("the open/closed choice lives under grq:nightShiftOpen and defaults to collapsed", () => {
  assert.equal(NIGHT_SHIFT_OPEN_KEY, "grq:nightShiftOpen");
  const storage = memoryStorage();
  assert.equal(readNightShiftOpen(storage), false, "nothing stored: collapsed");
  writeNightShiftOpen(true, storage);
  assert.equal(storage.map.get("grq:nightShiftOpen"), "1");
  assert.equal(readNightShiftOpen(storage), true);
  writeNightShiftOpen(false, storage);
  assert.equal(storage.map.get("grq:nightShiftOpen"), "0");
  assert.equal(readNightShiftOpen(storage), false);
  storage.setItem(NIGHT_SHIFT_OPEN_KEY, "junk");
  assert.equal(readNightShiftOpen(storage), false, "junk reads collapsed");
});

test("blocked or throwing storage never breaks the card", () => {
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  assert.equal(readNightShiftOpen(throwing), false);
  assert.doesNotThrow(() => writeNightShiftOpen(true, throwing));
  assert.equal(readNightShiftOpen(null), false);
  assert.doesNotThrow(() => writeNightShiftOpen(true, null));
  // Both calls are wrapped in try/catch in the source.
  const util = src("utils/nightShiftCard.js");
  assert.match(util, /try \{\s*return storage \? storage\.getItem\(NIGHT_SHIFT_OPEN_KEY\)/);
  assert.match(util, /try \{\s*storage\?\.setItem\(NIGHT_SHIFT_OPEN_KEY/);
});

test("the preference is never in the save", () => {
  for (const file of [
    "save/serialize.js",
    "save/saveSync.js",
    "context/GameContext.jsx",
    "context/gameLogic.js",
  ]) {
    assert.ok(!src(file).includes("nightShiftOpen"), file);
  }
});

// --- The collapsed row's copy ---

test("row model: level chip, short and full button labels", () => {
  const hire = nightShiftRowModel(0, purchase({ level: 1 }), MAX);
  assert.equal(hire.chip, `L0/${MAX}`);
  assert.equal(hire.shortBuyLabel, "Hire");
  assert.equal(hire.buyLabel, "Hire the night shift", "the unlock mail's link label");
  assert.equal(hire.maxed, false);

  const upgrade = nightShiftRowModel(1, purchase({ level: 2 }), MAX);
  assert.equal(upgrade.chip, "L1/5");
  assert.equal(upgrade.shortBuyLabel, "Upgrade");
  assert.equal(upgrade.buyLabel, "Upgrade to level 2");
  assert.equal(upgrade.blockedReason, "");
  assert.equal(upgrade.shortReason, "");
});

test("row model: the disabled reasons, full for the detail and short for the row", () => {
  const gated = nightShiftRowModel(1, purchase({ met: false, affordable: true }), MAX);
  assert.equal(gated.blockedReason, "Meet the requirements below to hire this shift.");
  assert.equal(gated.shortReason, "Locked");
  // The gate wins over cash, as before.
  const both = nightShiftRowModel(1, purchase({ met: false, affordable: false }), MAX);
  assert.equal(both.blockedReason, gated.blockedReason);
  const broke = nightShiftRowModel(1, purchase({ met: true, affordable: false }), MAX);
  assert.equal(broke.blockedReason, "Not enough cash yet.");
  assert.equal(broke.shortReason, "Need more cash");
  for (const model of [gated, broke]) {
    for (const text of [model.blockedReason, model.shortReason, model.chip]) {
      assert.ok(!/[–—]/.test(text), text);
    }
  }
});

test("row model at max level: 'L5/5 Maxed' and no buy button", () => {
  const next = nightShiftNextPurchase({
    level: MAX,
    money: 1e15,
    buffedLocPerSec: 1e9,
    employeeCounts: {},
  });
  assert.equal(next, null, "the shared helper has no next level at max");
  const maxed = nightShiftRowModel(MAX, next, MAX);
  assert.equal(maxed.chip, "L5/5 Maxed");
  assert.equal(maxed.maxed, true);
  assert.equal(maxed.buyLabel, null);
  assert.equal(maxed.shortBuyLabel, null);
  assert.equal(maxed.blockedReason, "");
  // The card renders the buy button only when not maxed.
  assert.match(card(), /\{!row\.maxed && \(\s*<Button/);
});

// --- The card's markup ---

test("collapsed by default, the toggle is a disclosure button with aria-expanded and aria-controls", () => {
  const c = card();
  // Open state comes from the Hire tab's one card store (#hire-collapse),
  // which reads and writes grq:nightShiftOpen for this card.
  assert.match(c, /const \[open, toggle\] = useHireCardOpen\(NIGHT_SHIFT_CARD_ID\);/);
  assert.match(src("utils/hireCards.js"), /\[NIGHT_SHIFT_CARD_ID\]: readNightShiftOpen\(storage\)/);
  assert.match(c, /const detailId = useId\(\);/);
  assert.match(c, /<button\s+type="button"[\s\S]*?onClick=\{toggle\}\s+aria-expanded=\{open\}\s+aria-controls=\{detailId\}/);
  assert.match(c, /<div id=\{detailId\} hidden=\{!open\}/);
  // The chevron is the shared disclosure chevron (reduced motion snaps it).
  assert.match(c, /info-toggle-chevron/);
  const css = readFileSync(new URL("../../client/src/index.css", import.meta.url), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.info-toggle-chevron \{\s*transition: none;/);
  // A tap remembers the choice (the shared store's setOpen writes it).
  assert.match(src("hooks/useHireCards.js"), /const toggle = \(\) => hireCardsStore\.setOpen\(cardId, !open\);/);
  assert.match(src("utils/hireCards.js"), /writeNightShiftOpen\(saved\[NIGHT_SHIFT_CARD_ID\], storage\)/);
});

test("the collapsed row: moon, title, chip, short reason, price button", () => {
  const c = card();
  assert.match(c, /import \{ BsMoonStarsFill \} from "react-icons\/bs";/);
  const header = c.slice(c.indexOf("Header row"), c.indexOf("<div id={detailId}"));
  assert.match(header, /<BsMoonStarsFill/);
  assert.match(header, /Night Shift\s*<\/span>/);
  assert.match(header, /\{row\.chip\}/);
  assert.match(header, /\{!open && row\.shortReason && \(/);
  assert.match(header, /disabled=\{!next\.canBuy\}/);
  assert.match(header, /dispatch\(\{ type: "BUY_NIGHT_SHIFT_LEVEL" \}\)/);
  assert.match(header, /\{row\.shortBuyLabel\} \(\{price\}\)/);
  assert.match(header, /aria-label=\{`\$\{row\.buyLabel\} \(\$\{price\}\)`\}/);
});

test("the expanded detail is a JSDoc block with every piece of the old card", () => {
  const c = card();
  const detail = c.slice(c.indexOf("<div id={detailId}"));
  assert.match(detail, /\{`\/\*\* `\}/);
  assert.match(detail, /\{`\*\/`\}/);
  assert.match(detail, /tag="@level" type="Shift" value=\{`\$\{level\} of \$\{maxLevel\}`\}/);
  assert.match(detail, /tag="@returns"/);
  assert.match(detail, /tag="@next"/);
  assert.match(detail, /tag="@param"\s+type="Cost"\s+value=\{`Price: \$\{priceMinutes\} minutes of shipping income`\}\s+suffix=\{` \(\$\{price\} at your current LOC\/s\)\.`\}/);
  assert.equal((detail.match(/type: "LOC\/s"|type: "Team"/g) ?? []).length, 2, "two gate lines");
  assert.match(detail, /<span className="text-blue-400">@requires<\/span>/);
  assert.match(detail, /<ProgressBar/);
  assert.match(detail, /\{row\.blockedReason && \(/);
  assert.match(detail, /Right now everyone goes home when you do: no LOC while the game is closed\./);
  assert.match(detail, /Maxed: half your team works through the night\./);
  assert.match(detail, /Away less than 5 minutes counts as still here\. Night Shift resets when\s+you sell the company\./);
  assert.match(detail, /Your Night Shift Contract starts every new company at level 1\./);
  assert.match(detail, /The Night Shift Contract in the permanent store keeps level 1 through a sale\./);
  assert.match(c, /function levelTerms\(level\)/);
  assert.match(c, /function overnightLine\(level\)/);
  assert.ok(!/[–—]/.test(c), "no em or en dashes");
});

// --- The email deep link ---

test("an email link to the card opens it before its anchor scrolls and flashes", () => {
  // The link target the discovery mails carry still matches the card.
  const linked = navigateToTarget(
    { activeSection: "email", highlightSeq: 0, highlightTarget: null },
    { tab: "shop", itemId: NIGHT_SHIFT_EMAIL_ITEM_ID }
  );
  assert.equal(linked.highlightTarget.itemId, "nightShift");
  assert.ok(highlightMatches(linked.highlightTarget, "shop", NIGHT_SHIFT_EMAIL_ITEM_ID));
  // Once the anchor consumes it, the card no longer matches (it stays
  // open for the session; only the chevron changes the device choice).
  const consumed = consumeHighlight(linked, linked.highlightTarget.key);
  assert.equal(
    highlightMatches(consumed.highlightTarget, "shop", NIGHT_SHIFT_EMAIL_ITEM_ID),
    false
  );

  // The card reads the same match (through the shared hook, with its
  // own id) and opens during render, so the expanded card is in the DOM
  // when HighlightAnchor's effect scrolls.
  const c = card();
  assert.match(c, /useHireCardOpen\(NIGHT_SHIFT_CARD_ID\)/);
  assert.match(src("utils/hireCards.js"), /export const NIGHT_SHIFT_CARD_ID = NIGHT_SHIFT_EMAIL_ITEM_ID;/);
  const hook = src("hooks/useHireCards.js");
  assert.match(hook, /const targeted = highlightMatches\(state\.highlightTarget, "shop", cardId\);/);
  assert.match(hook, /const open = targeted \|\| isHireCardOpen\(cards, cardId\);/);
  // It does not persist the link's open as the device choice: the link
  // path is openForSession, which never writes storage.
  assert.match(hook, /if \(targeted\) hireCardsStore\.openForSession\(cardId\);/);
  assert.ok(!/writeNightShiftOpen|setItem/.test(c), "the card itself never writes storage");
  // The anchor around it is unchanged.
  assert.match(
    src("components/Shop.jsx"),
    /<HighlightAnchor tab="shop" itemId=\{NIGHT_SHIFT_EMAIL_ITEM_ID\}>\s*<NightShiftCard \/>\s*<\/HighlightAnchor>/
  );
  const anchor = src("components/HighlightAnchor.jsx");
  assert.match(anchor, /scrollIntoView/);
  assert.match(anchor, /highlight-flash/);
});

test("the Commit click float stays locked", () => {
  assertCommitFloatLocked();
});
