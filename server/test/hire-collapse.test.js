/**
 * Collapsible Hire cards and Collapse all (Brandon, Nov 21, after the
 * collapsible Night Shift card from #261: "I wish we could do that with
 * all the employees too, collapse them as well and just show the image,
 * buy button, number you have, and the name of the employee. And maybe
 * a collapse all toggle as well would be great."):
 *
 * - One store (utils/hireCards.js) for every Hire card: employee cards
 *   under `grq:hireCardsOpen` (type -> boolean), Night Shift under its
 *   own `grq:nightShiftOpen`. Collapsed by default, never in the save,
 *   blocked or junk storage never breaks a card.
 * - Collapse all / Expand all sets every card, Night Shift included,
 *   and is labelled by what it will do.
 * - The collapsed row: chevron, small icon, name, owned count, the Hire
 *   button with its bulk price (still disabled when unaffordable); a
 *   locked card: chevron, lock, name, the disabled LOCKED button. The
 *   expanded card is the old JSDoc card.
 * - Email links open their card for the session before the anchor
 *   scrolls and flashes, without changing the remembered choice.
 * - The sort and the quantity selector are untouched.
 *
 * The client components import React, so the component checks are
 * source checks, like the rest of the suite.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMPLOYEE_TYPES,
  NIGHT_SHIFT_EMAIL_ITEM_ID,
  buildEmployeeUnlockedEmail,
  buildEmployeeVisibleEmail,
} from "../../shared/game-balance.js";
import {
  HIRE_CARDS_OPEN_KEY,
  NIGHT_SHIFT_CARD_ID,
  anyHireCardOpen,
  collapseAllLabel,
  createHireCardsStore,
  hireCardToggleLabel,
  isHireCardOpen,
  readHireCardsOpen,
  writeHireCardsOpen,
} from "../../client/src/utils/hireCards.js";
import { NIGHT_SHIFT_OPEN_KEY } from "../../client/src/utils/nightShiftCard.js";
import {
  consumeHighlight,
  highlightMatches,
  navigateToTarget,
} from "../../client/src/navigation/highlight.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    map,
    writes,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      writes.push(k);
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
}

const throwing = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("quota");
  },
};

const ALL_CARDS = [NIGHT_SHIFT_CARD_ID, ...EMPLOYEE_TYPES];

// --- The device preference ---

test("employee cards live under grq:hireCardsOpen, Night Shift keeps grq:nightShiftOpen, collapsed by default", () => {
  assert.equal(HIRE_CARDS_OPEN_KEY, "grq:hireCardsOpen");
  assert.equal(NIGHT_SHIFT_CARD_ID, NIGHT_SHIFT_EMAIL_ITEM_ID);
  assert.equal(NIGHT_SHIFT_CARD_ID, "nightShift");
  const storage = memoryStorage();
  const store = createHireCardsStore(storage);
  for (const id of ALL_CARDS) {
    assert.equal(isHireCardOpen(store.getSnapshot(), id), false, `${id} collapsed`);
  }
  store.setOpen("intern", true);
  assert.deepEqual(JSON.parse(storage.map.get("grq:hireCardsOpen")), { intern: true });
  assert.equal(storage.map.has("grq:nightShiftOpen"), false, "only the employee key written");
  store.setOpen("intern", false);
  assert.deepEqual(JSON.parse(storage.map.get("grq:hireCardsOpen")), { intern: false });
  store.setOpen(NIGHT_SHIFT_CARD_ID, true);
  assert.equal(storage.map.get(NIGHT_SHIFT_OPEN_KEY), "1");
  assert.ok(
    !("nightShift" in JSON.parse(storage.map.get("grq:hireCardsOpen"))),
    "Night Shift never goes into the employee key"
  );
  // A fresh store (a reload) reads both keys back.
  const reloaded = createHireCardsStore(storage).getSnapshot();
  assert.equal(isHireCardOpen(reloaded, NIGHT_SHIFT_CARD_ID), true);
  assert.equal(isHireCardOpen(reloaded, "intern"), false);
});

test("a remembered Night Shift choice from #261 carries over", () => {
  const store = createHireCardsStore(memoryStorage({ "grq:nightShiftOpen": "1" }));
  assert.equal(isHireCardOpen(store.getSnapshot(), NIGHT_SHIFT_CARD_ID), true);
});

test("junk, blocked or throwing storage reads collapsed and never breaks a card", () => {
  for (const junk of ["not json", "[true]", "null", "42", '{"intern":"yes","junior":1}']) {
    const store = createHireCardsStore(memoryStorage({ "grq:hireCardsOpen": junk }));
    for (const id of EMPLOYEE_TYPES) {
      assert.equal(isHireCardOpen(store.getSnapshot(), id), false, `${junk}: ${id}`);
    }
  }
  assert.deepEqual(
    readHireCardsOpen(memoryStorage({ "grq:hireCardsOpen": '{"intern":true,"junior":"x"}' })),
    { intern: true },
    "only boolean entries survive"
  );
  assert.deepEqual(readHireCardsOpen(throwing), {});
  assert.deepEqual(readHireCardsOpen(null), {});
  assert.doesNotThrow(() => writeHireCardsOpen({ intern: true }, throwing));
  assert.doesNotThrow(() => writeHireCardsOpen({ intern: true }, null));
  // The toggles still work for the session on a throwing storage.
  const store = createHireCardsStore(throwing);
  assert.doesNotThrow(() => store.setAllOpen(ALL_CARDS, true));
  assert.equal(anyHireCardOpen(store.getSnapshot(), ALL_CARDS), true);
  // Both storage calls are wrapped in try/catch in the source.
  const util = src("utils/hireCards.js");
  assert.match(util, /try \{\s*parsed = storage \? JSON\.parse\(storage\.getItem\(HIRE_CARDS_OPEN_KEY\)\)/);
  assert.match(util, /try \{\s*storage\?\.setItem\(HIRE_CARDS_OPEN_KEY, JSON\.stringify\(open\)\);/);
});

test("the open/closed choices are never in the save", () => {
  for (const file of [
    "save/serialize.js",
    "save/saveSync.js",
    "context/GameContext.jsx",
    "context/gameLogic.js",
  ]) {
    assert.ok(!src(file).includes("hireCardsOpen"), file);
    assert.ok(!src(file).includes("hireCards"), file);
  }
});

test("the snapshot is stable until a change, and subscribers hear every change", () => {
  const store = createHireCardsStore(memoryStorage());
  const first = store.getSnapshot();
  assert.equal(store.getSnapshot(), first, "same object, so useSyncExternalStore does not loop");
  assert.ok(Object.isFrozen(first));
  let heard = 0;
  const unsubscribe = store.subscribe(() => heard++);
  store.setOpen("junior", true);
  store.setAllOpen(ALL_CARDS, false);
  store.openForSession("senior");
  assert.equal(heard, 3);
  assert.notEqual(store.getSnapshot(), first);
  unsubscribe();
  store.setOpen("junior", true);
  assert.equal(heard, 3);
});

// --- Collapse all / Expand all ---

test("Collapse all / Expand all sets every card, Night Shift included, and is labelled by what it will do", () => {
  const storage = memoryStorage();
  const store = createHireCardsStore(storage);
  assert.equal(collapseAllLabel(anyHireCardOpen(store.getSnapshot(), ALL_CARDS)), "Expand all");
  store.setAllOpen(ALL_CARDS, true);
  for (const id of ALL_CARDS) assert.equal(isHireCardOpen(store.getSnapshot(), id), true, id);
  assert.equal(storage.map.get("grq:nightShiftOpen"), "1");
  assert.deepEqual(
    Object.keys(JSON.parse(storage.map.get("grq:hireCardsOpen"))).sort(),
    [...EMPLOYEE_TYPES].sort()
  );
  assert.equal(collapseAllLabel(anyHireCardOpen(store.getSnapshot(), ALL_CARDS)), "Collapse all");
  // One card open is enough to offer Collapse all.
  store.setAllOpen(ALL_CARDS, false);
  store.setOpen("senior", true);
  assert.equal(collapseAllLabel(anyHireCardOpen(store.getSnapshot(), ALL_CARDS)), "Collapse all");
  store.setAllOpen(ALL_CARDS, false);
  for (const id of ALL_CARDS) assert.equal(isHireCardOpen(store.getSnapshot(), id), false, id);
  assert.equal(storage.map.get("grq:nightShiftOpen"), "0");
  assert.equal(collapseAllLabel(false), "Expand all");
  assert.equal(collapseAllLabel(true), "Collapse all");
});

test("the Hire tab renders the control beside the sort, over every card", () => {
  const shop = src("components/Shop.jsx");
  const controls = shop.slice(shop.indexOf('role="group"'), shop.indexOf("<HighlightAnchor"));
  assert.match(controls, /<SortControl tab="shop" \/>\s*<Button\s+onClick=\{toggleAllCards\}\s+className="game-button--inactive ml-auto tap-target-40"\s*>\s*\{collapseAllLabel\(anyCardOpen\)\}\s*<\/Button>/);
  // Every card: Night Shift plus every employee type, even ones not on
  // screen yet, so a newly revealed card follows the last choice.
  assert.match(shop, /hireCardsStore\.setAllOpen\(\s*\[NIGHT_SHIFT_CARD_ID, \.\.\.Object\.keys\(EMPLOYEE_CONFIGS\)\],\s*!anyCardOpen\s*\)/);
  // The label judges the cards on screen: Night Shift, unlocked types
  // and the teasers past their threshold.
  assert.match(shop, /const visibleCardIds = \[\s*NIGHT_SHIFT_CARD_ID,\s*\.\.\.employeeTypes\.filter\(\s*\(type\) =>\s*isEmployeeUnlocked\(type, state\) \|\|\s*hasCrossedUnlockThreshold\("employee", type, state\)\s*\),\s*\];/);
  assert.match(shop, /const anyCardOpen = anyHireCardOpen\(hireCards, visibleCardIds\);/);
  assert.match(shop, /const hireCards = useHireCardsSnapshot\(\);/);
});

// --- The cards ---

test("the collapsed and expanded disclosure: aria-expanded, aria-controls, hidden detail, the shared chevron, 40px rows", () => {
  const parts = src("components/HireCardToggle.jsx");
  const collapsed = parts.slice(parts.indexOf("export function CollapsedHireRow"), parts.indexOf("export function ExpandedHireHeader"));
  const expanded = parts.slice(parts.indexOf("export function ExpandedHireHeader"));
  // Same Panel padding and row height as the collapsed Night Shift row.
  assert.match(collapsed, /<Panel className=\{`px-3 py-1\.5 m-0 \$\{className\}`\.trim\(\)\}>/);
  assert.match(src("components/NightShiftCard.jsx"), /<Panel as="section" className="px-3 py-1\.5 m-0"/);
  assert.match(collapsed, /<div className="flex items-center gap-2 min-h-10">/);
  assert.match(collapsed, /<button\s+type="button"[\s\S]*?min-h-10[\s\S]*?onClick=\{onToggle\}\s+aria-expanded=\{false\}\s+aria-controls=\{detailId\}\s+aria-label=\{hireCardToggleLabel\(name, false\)\}/);
  assert.match(collapsed, /<div id=\{detailId\} hidden \/>/);
  assert.match(expanded, /<button\s+type="button"\s+className=\{`block w-full min-h-10 \$\{TOGGLE_CLASS\}`\}\s+onClick=\{onToggle\}\s+aria-expanded=\{true\}\s+aria-controls=\{detailId\}\s+aria-label=\{hireCardToggleLabel\(name, true\)\}/);
  assert.match(parts, /info-toggle-chevron/);
  assert.equal(hireCardToggleLabel("Intern", false), "Show Intern details");
  assert.equal(hireCardToggleLabel("Intern", true), "Hide Intern details");
  // The expanded header keeps the JSDoc opener and title line.
  assert.match(expanded, /\{`\/\*\* `\}/);
  assert.match(expanded, /<span className="text-sm font-bold">\{brandNodes\(name\)\}<\/span>/);
  // The detail region the expanded disclosure controls: the JSDoc body.
  const block = src("components/JsDocBlock.jsx");
  assert.match(block, /\{bodyId \? <div id=\{bodyId\}>\{body\}<\/div> : body\}/);
  // Without the new props the block renders exactly as before.
  assert.match(block, /\{header \?\? \(\s*<>\s*<span className="comment-text">\{`\/\*\* `\}<\/span>\s*<br \/>\s*<span className="text-sm font-bold">\s*\{brandNodes\(title\)\}\s*\{titleAfter\}/);
  // Reduced motion: the shared chevron snaps, no expand animation.
  const css = src("index.css");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.info-toggle-chevron \{\s*transition: none;/);
  assert.ok(!/transition|animation/.test(parts), "no expand animation");
});

test("the collapsed employee row: chevron, small icon, name, owned count, the Hire button at the bulk price", () => {
  const card = src("components/EmployeeCard.jsx");
  const collapsed = card.slice(card.indexOf("if (!open) {"), card.indexOf("return (\n    <>"));
  assert.match(collapsed, /<CollapsedHireRow\s+name=\{config\.name\}/);
  assert.match(collapsed, /<config\.Icon\s+size=\{22\}\s+color=\{config\.color\}/);
  assert.match(collapsed, /sub=\{`x\$\{formatNumber\(ownedCount\)\}`\}/);
  assert.match(collapsed, /className=\{tintClass\}/, "the buff tint still shows collapsed");
  // The same game-action button: bounce, "+N" float, disabled when the
  // batch is unaffordable, the bulk total.
  assert.match(collapsed, /<BouncyButton\s+onClick=\{onPurchase\}\s+disabled=\{!canAfford\}\s+floatText=\{`\+\$\{quantity\}`\}/);
  assert.match(collapsed, /\{hireLabel\} \(\{formatMoney\(currentCost\)\}\)/);
  assert.match(card, /const hireLabel = quantity > 1 \? `Hire x\$\{quantity\}` : "Hire";/);
  // Nothing else in the row: no description, no JSDoc tag lines.
  assert.ok(!/description|JsDocLine|@param|@returns/.test(collapsed));
});

test("the expanded employee card is the old JSDoc card, with the Release Manager summary under it only while open", () => {
  const card = src("components/EmployeeCard.jsx");
  const expanded = card.slice(card.indexOf("return (\n    <>"));
  assert.match(expanded, /<Panel className=\{`px-3 pb-1 flex flex-col gap-1 m-0 \$\{tintClass\}`\}>/);
  assert.match(expanded, /description=\{config\.description\}/);
  assert.match(expanded, /<ExpandedHireHeader\s+name=\{config\.name\}\s+detailId=\{detailId\}\s+onToggle=\{toggle\}\s*\/>/);
  assert.match(expanded, /bodyId=\{detailId\}/);
  assert.match(expanded, /value=\{`x\$\{formatNumber\(config\.costMultiplier\)\} per hire`\}/);
  assert.match(expanded, /tag="@returns"/);
  assert.match(expanded, /tag="@deprecated"/);
  assert.match(expanded, /<config\.Icon size=\{36\} color=\{config\.color\} \/>/);
  assert.match(expanded, /x\{formatNumber\(ownedCount\)\}/);
  assert.match(expanded, /<div>\{hireLabel\}<\/div>\s*<div>\(\{formatMoney\(currentCost\)\}\)<\/div>/);
  assert.match(expanded, /<\/Panel>\s*\{children\}\s*<\/>/);
  // The open state is the shared store's, keyed by the employee type.
  assert.match(card, /const \[open, toggle\] = useHireCardOpen\(cardId\);/);
  const shop = src("components/Shop.jsx");
  assert.match(shop, /<EmployeeCard\s+cardId=\{employeeType\}/);
  assert.match(shop, /listCost=\{listCost\}\s*>[\s\S]*?\{employeeType === "releaseManager" && \(\s*<ReleaseManagerShippingSummary \/>\s*\)\}\s*<\/EmployeeCard>/);
});

test("the locked card: collapsed is the chevron, a lock, the name and the disabled LOCKED button; expanded keeps the unlock bars", () => {
  const card = src("components/LockedEmployeeCard.jsx");
  const collapsed = card.slice(card.indexOf("if (!open) {"), card.lastIndexOf("return ("));
  assert.match(card, /import \{ FaLock \} from "react-icons\/fa";/);
  assert.match(collapsed, /<CollapsedHireRow\s+name=\{config\.name\}/);
  assert.match(collapsed, /<FaLock/);
  assert.match(collapsed, /<Button disabled className="shrink-0 whitespace-nowrap tap-target-40">\s*LOCKED \{priceText\}\s*<\/Button>/);
  assert.ok(!/sub=/.test(collapsed), "no owned count on a locked card");
  assert.match(card, /const priceText = `\(\$\{formatMoney\(price \?\? config\.baseCost\)\}\)`;/);
  const expanded = card.slice(card.lastIndexOf("return ("));
  assert.match(expanded, /<JsDocUnlockRequirements progress=\{progress\} \/>/);
  assert.match(expanded, /<div>LOCKED<\/div>\s*<div>\{priceText\}<\/div>/);
  assert.match(card, /const \[open, toggle\] = useHireCardOpen\(cardId\);/);
  assert.match(src("components/Shop.jsx"), /<LockedEmployeeCard\s+cardId=\{employeeType\}/);
});

test("the row buttons keep their look and still get a 41px tap area", () => {
  const css = src("index.css");
  assert.match(css, /\.tap-target-40 \{\s*position: relative;\s*\}/);
  assert.match(css, /\.tap-target-40::after \{\s*content: "";\s*position: absolute;\s*inset: -6px 0;\s*\}/);
  assert.match(src("components/EmployeeCard.jsx"), /className="shrink-0 whitespace-nowrap tap-target-40"/);
  assert.match(src("components/NightShiftCard.jsx"), /className="shrink-0 whitespace-nowrap tap-target-40"/);
  assert.match(src("components/NightShiftCard.jsx"), /gap-2 min-h-10 py-1 text-left/);
});

// --- Email deep links ---

test("an email link opens its card for the session before the anchor scrolls, without changing the remembered choice", () => {
  // Employee mails (unlock and teaser) target the card's own id.
  for (const type of EMPLOYEE_TYPES) {
    for (const email of [
      buildEmployeeUnlockedEmail({ employeeName: type, employeeType: type }),
      buildEmployeeVisibleEmail({ employeeName: type, requirementText: "x", employeeType: type }),
    ]) {
      const linked = navigateToTarget(
        { activeSection: "email", highlightSeq: 0, highlightTarget: null },
        email.target
      );
      assert.ok(highlightMatches(linked.highlightTarget, "shop", type), type);
      const consumed = consumeHighlight(linked, linked.highlightTarget.key);
      assert.equal(highlightMatches(consumed.highlightTarget, "shop", type), false);
    }
  }
  // The hook: targeted opens during render, the effect keeps it open
  // for the session through openForSession.
  const hook = src("hooks/useHireCards.js");
  assert.match(hook, /const targeted = highlightMatches\(state\.highlightTarget, "shop", cardId\);/);
  assert.match(hook, /useEffect\(\(\) => \{\s*if \(targeted\) hireCardsStore\.openForSession\(cardId\);\s*\}, \[targeted, cardId\]\);/);
  assert.match(hook, /const open = targeted \|\| isHireCardOpen\(cards, cardId\);/);
  // The store: a session open writes nothing and stays until a tap.
  const storage = memoryStorage();
  const store = createHireCardsStore(storage);
  store.openForSession("senior");
  store.openForSession(NIGHT_SHIFT_CARD_ID);
  assert.equal(isHireCardOpen(store.getSnapshot(), "senior"), true);
  assert.equal(isHireCardOpen(store.getSnapshot(), NIGHT_SHIFT_CARD_ID), true);
  assert.deepEqual(storage.writes, [], "a link never writes the device choice");
  assert.equal(isHireCardOpen(createHireCardsStore(storage).getSnapshot(), "senior"), false, "a reload is collapsed again");
  // A chevron tap afterwards is remembered and drops the session open.
  store.setOpen("senior", false);
  assert.equal(isHireCardOpen(store.getSnapshot(), "senior"), false);
  assert.deepEqual(JSON.parse(storage.map.get("grq:hireCardsOpen")), { senior: false });
  // Collapse all collapses link-opened cards too.
  store.setAllOpen(ALL_CARDS, false);
  assert.equal(anyHireCardOpen(store.getSnapshot(), ALL_CARDS), false);
  // Each card's anchor is unchanged: unlocked and locked cards carry
  // the employee type, Night Shift its own id.
  const shop = src("components/Shop.jsx");
  assert.equal((shop.match(/<HighlightAnchor key=\{employeeType\} tab="shop" itemId=\{employeeType\}>/g) ?? []).length, 1);
  assert.equal((shop.match(/<HighlightAnchor tab="shop" itemId=\{employeeType\}>/g) ?? []).length, 1);
  assert.match(shop, /<HighlightAnchor tab="shop" itemId=\{NIGHT_SHIFT_EMAIL_ITEM_ID\}>\s*<NightShiftCard \/>\s*<\/HighlightAnchor>/);
  // The cards use the hook with their anchor's id.
  assert.match(src("components/EmployeeCard.jsx"), /useHireCardOpen\(cardId\)/);
  assert.match(src("components/LockedEmployeeCard.jsx"), /useHireCardOpen\(cardId\)/);
  assert.match(src("components/NightShiftCard.jsx"), /useHireCardOpen\(NIGHT_SHIFT_CARD_ID\)/);
});

// --- Unchanged behaviour ---

test("the quantity selector and the Default / Cheapest sort are unchanged", () => {
  const shop = src("components/Shop.jsx");
  assert.match(shop, /const BULK_QUANTITIES = \[1, 5, 10, 25, 100\];/);
  assert.match(shop, /const \[quantity, setQuantity\] = useState\(1\);/);
  assert.match(shop, /const \[sortMode\] = useSortMode\("shop"\);/);
  assert.match(shop, /sortEmployeeTypes\(\s*Object\.keys\(EMPLOYEE_CONFIGS\),\s*state,\s*sortMode,\s*quantity\s*\)/);
  assert.match(shop, /payload: \{ employeeType, quantity \}/);
  assert.match(shop, /const currentCost = getEmployeeBulkCost\(\s*employeeType,\s*state,\s*quantity\s*\);/);
  assert.match(shop, /quantity=\{quantity\}/);
  assert.ok(!/\.sort\(/.test(shop), "no sort of its own");
  // The open state never feeds the order or the price.
  assert.ok(!/hireCards|anyCardOpen/.test(src("utils/unlockProgress.js")));
});

test("no em or en dashes in the new player-facing copy", () => {
  for (const file of [
    "utils/hireCards.js",
    "hooks/useHireCards.js",
    "components/HireCardToggle.jsx",
  ]) {
    assert.ok(!/[–—]/.test(src(file)), file);
  }
  for (const text of [collapseAllLabel(true), collapseAllLabel(false), hireCardToggleLabel("Intern", true)]) {
    assert.ok(!/[–—]/.test(text), text);
  }
});

test("the Commit click float stays locked", () => {
  assertCommitFloatLocked();
});
