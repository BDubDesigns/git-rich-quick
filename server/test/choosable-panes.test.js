/**
 * Tests for issue #174: choosable panes, built to the approved proposal
 * (comment 7018275605). Desktop shows two pinned side panes and a
 * nav-driven center, three different sections; the nav and email links
 * change only the center, through ONE helper (showSection); the pane
 * picker rearranges with SWAP semantics; the side panes persist as the
 * device preference grq:sidePanes; title bars are pinned structurally
 * (above their own scroller); mobile is one pane with no picker.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SIDE_PANES,
  DESKTOP_START_SECTION,
  PANES,
  PANE_SECTION_IDS,
  SIDE_PANES_STORAGE_KEY,
  chooseSectionForPane,
  firstFreeSection,
  isSectionOnScreen,
  normalizeCenter,
  onScreenSections,
  paneOf,
  paneSections,
  panesAreValid,
  pickerRowState,
  readSidePanes,
  setLayoutMode,
  showSection,
} from "../../client/src/navigation/panes.js";
import {
  ACHIEVEMENTS,
  EMAIL_LINK_TABS,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
} from "../../shared/game-balance.js";

/** A valid card id to link to on each linkable tab (the Farm links to the tab itself). */
const LINK_ITEM = {
  shop: EMPLOYEE_TYPES[0],
  projects: FREELANCE_PROJECT_KEYS[0],
  openSource: OPEN_SOURCE_IDS[0],
  achievements: ACHIEVEMENTS[0]?.id,
  farm: null,
  // The IPO Roadshow card (issue #266).
  settings: "roadshow",
};
import {
  clearHighlight,
  consumeHighlight,
  highlightMatches,
  navigateToTarget,
} from "../../client/src/navigation/highlight.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

/** A reducer-shaped state with a layout. */
function desk(left, center, right, extra = {}) {
  return { layoutMode: "desktop", sidePanes: { left, right }, activeTab: center, highlightTarget: null, highlightSeq: 0, ...extra };
}
function mobile(activeTab, extra = {}) {
  return { layoutMode: "mobile", sidePanes: { ...DEFAULT_SIDE_PANES }, activeTab, highlightTarget: null, highlightSeq: 0, ...extra };
}

/** Every valid desktop layout: three different sections (7 x 6 x 5 = 210). */
function allLayouts() {
  const out = [];
  for (const left of PANE_SECTION_IDS)
    for (const center of PANE_SECTION_IDS)
      for (const right of PANE_SECTION_IDS)
        if (new Set([left, center, right]).size === 3) out.push(desk(left, center, right));
  return out;
}

test("the sections are the nav's seven, in nav order; the default layout is Hire / Open Source / Projects", () => {
  const config = src("context/gameConfig.js");
  const block = config.slice(config.indexOf("export const NAV_TABS"), config.indexOf("]);", config.indexOf("export const NAV_TABS")));
  const navIds = [...block.matchAll(/\{ id: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...PANE_SECTION_IDS], navIds);
  assert.deepEqual({ ...DEFAULT_SIDE_PANES }, { left: "shop", right: "projects" });
  assert.equal(DESKTOP_START_SECTION, "openSource");
  assert.deepEqual([...PANES], ["left", "center", "right"]);
  assert.equal(allLayouts().length, 210);
});

test("showSection on desktop: center stays, a side section flashes its bar without moving, an off-screen one opens in the center", () => {
  for (const state of allLayouts()) {
    const { left, center, right } = paneSections(state);
    for (const id of PANE_SECTION_IDS) {
      const next = showSection(state, id);
      assert.ok(panesAreValid(next), `${left}/${center}/${right} show ${id}`);
      if (id === center) {
        assert.equal(next, state, "already in the center: nothing changes");
      } else if (id === left || id === right) {
        // Nothing moves; the side pane's title bar gets the scoped flash.
        assert.deepEqual(paneSections(next), paneSections(state));
        assert.deepEqual(next.highlightTarget, { tab: id, itemId: null, scope: "pane", key: 1 });
        assert.equal(highlightMatches(next.highlightTarget, id, null, "pane"), true);
        assert.equal(highlightMatches(next.highlightTarget, id), false, "no item or tab anchor matches it");
        assert.deepEqual(showSection(state, id, { flashPane: false }), state);
      } else {
        // Off screen: into the center; the sides never change.
        assert.deepEqual(paneSections(next), { left, center: id, right });
      }
    }
    assert.equal(showSection(state, "bogus"), state);
  }
});

test("showSection on mobile: the one pane becomes the section", () => {
  for (const from of PANE_SECTION_IDS) {
    for (const id of PANE_SECTION_IDS) {
      const next = showSection(mobile(from), id);
      assert.equal(next.activeTab, id);
      assert.equal(next.highlightTarget, null, "no pane flash on mobile");
      assert.deepEqual(next.sidePanes, DEFAULT_SIDE_PANES, "the sides are not touched");
    }
  }
});

test("the picker SWAPS in every pane pairing: open elsewhere trades places, free replaces, here does nothing", () => {
  let swaps = 0;
  for (const state of allLayouts()) {
    const before = paneSections(state);
    for (const pane of PANES) {
      for (const id of PANE_SECTION_IDS) {
        const next = chooseSectionForPane(state, pane, id);
        assert.ok(panesAreValid(next), `${JSON.stringify(before)} ${pane} <- ${id}`);
        const after = paneSections(next);
        const from = PANES.find((p) => before[p] === id);
        if (from === pane) {
          assert.equal(next, state, "this pane's own section: nothing");
          continue;
        }
        assert.equal(after[pane], id);
        if (from) {
          // Swap: the other pane takes this pane's old section; the third is untouched.
          swaps += 1;
          assert.equal(after[from], before[pane], `${pane} <-> ${from}`);
          const third = PANES.find((p) => p !== pane && p !== from);
          assert.equal(after[third], before[third]);
        } else {
          for (const p of PANES.filter((x) => x !== pane)) assert.equal(after[p], before[p]);
        }
        assert.equal(next.activeTab, after.center, "activeTab follows the center");
      }
    }
  }
  // Every ordered pane pair, both ways (left/center, left/right, center/right).
  assert.equal(swaps, 210 * 3 * 2);
  // The picker drops a pending highlight (a swap can unmount its card).
  const pending = desk("shop", "openSource", "projects", { highlightTarget: { tab: "shop", itemId: "junior", key: 3 } });
  assert.equal(chooseSectionForPane(pending, "left", "projects").highlightTarget, null);
  // Desktop only, and junk changes nothing.
  assert.equal(chooseSectionForPane(mobile("shop"), "left", "farm").activeTab, "shop");
  const s = desk("shop", "openSource", "projects");
  for (const [pane, id] of [["middle", "farm"], ["left", "bogus"], [undefined, "farm"]]) {
    assert.equal(chooseSectionForPane(s, pane, id), s);
  }
});

test("picker rows: Here for this pane's own, Open (pane) for another pane's, free otherwise", () => {
  const s = desk("shop", "openSource", "projects");
  assert.deepEqual(pickerRowState(s, "left", "shop"), { kind: "here", pane: "left" });
  assert.deepEqual(pickerRowState(s, "left", "projects"), { kind: "open", pane: "right" });
  assert.deepEqual(pickerRowState(s, "left", "openSource"), { kind: "open", pane: "center" });
  assert.deepEqual(pickerRowState(s, "right", "shop"), { kind: "open", pane: "left" });
  assert.deepEqual(pickerRowState(s, "center", "farm"), { kind: "free", pane: null });
});

test("no duplicates, ever: the invariant holds after every action in a long random run", () => {
  let seed = 174;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  let state = normalizeCenter(desk("shop", "shop", "projects"));
  assert.ok(panesAreValid(state), "the collision is repaired up front");
  for (let i = 0; i < 20000; i += 1) {
    const roll = rand();
    if (roll < 0.4) state = showSection(state, pick(PANE_SECTION_IDS));
    else if (roll < 0.8) state = chooseSectionForPane(state, pick(PANES), pick(PANE_SECTION_IDS));
    else if (roll < 0.9) state = setLayoutMode(state, pick(["desktop", "mobile"]));
    else state = navigateToTarget(state, { tab: pick(PANE_SECTION_IDS), itemId: null });
    assert.ok(panesAreValid(state), `step ${i}: ${JSON.stringify(paneSections(state))} ${state.layoutMode}`);
    if (state.layoutMode === "desktop") {
      assert.equal(new Set(onScreenSections(state)).size, 3);
    }
  }
});

test("layout mode: turning desktop moves a colliding center to the first free section in nav order; mobile shows the old center", () => {
  // Hire active on mobile, Hire pinned left: the center falls to Email (nav order).
  const turned = setLayoutMode(mobile("shop"), "desktop");
  assert.deepEqual(paneSections(turned), { left: "shop", center: "email", right: "projects" });
  assert.equal(firstFreeSection({ left: "email", right: "shop" }), "projects");
  // A center that does not collide stays.
  assert.equal(setLayoutMode(mobile("farm"), "desktop").activeTab, "farm");
  // Back to mobile: the one pane is what the center showed.
  assert.equal(setLayoutMode(desk("shop", "achievements", "projects"), "mobile").activeTab, "achievements");
  assert.equal(setLayoutMode(mobile("farm"), "tablet").layoutMode, "mobile", "junk mode ignored");
  // A fresh desktop load opens on Open Source (the reducer's starting
  // state), and falls through only if a side pane holds it.
  const context = src("context/GameContext.jsx");
  assert.match(context, /activeTab: desktop \? DESKTOP_START_SECTION : base\.activeTab,/);
  assert.equal(normalizeCenter(desk("openSource", "openSource", "projects")).activeTab, "email");
});

test("storage sanitizer: junk is the default Hire / Projects, a valid pair is kept", () => {
  assert.equal(SIDE_PANES_STORAGE_KEY, "grq:sidePanes");
  const def = { left: "shop", right: "projects" };
  for (const junk of [
    null, undefined, "", "{not json", "null", "[]", "42", '"shop"', [], 7, true,
    { left: "shop" }, { right: "projects" }, { left: "shop", right: "shop" },
    { left: "bogus", right: "projects" }, { left: "shop", right: "__proto__" },
    '{"left":"farm","right":"farm"}', '{"left":"FARM","right":"email"}', { left: 1, right: 2 },
  ]) {
    assert.deepEqual(readSidePanes(junk), def, JSON.stringify(junk) ?? String(junk));
  }
  assert.deepEqual(readSidePanes('{"left":"email","right":"farm"}'), { left: "email", right: "farm" });
  assert.deepEqual(readSidePanes({ left: "settings", right: "achievements", extra: 1 }), { left: "settings", right: "achievements" });
  // A returned default is a fresh object (never the frozen constant).
  readSidePanes(null).left = "farm";
  assert.equal(DEFAULT_SIDE_PANES.left, "shop");
});

test("deep links route through showSection: side pane flashes in place, center flashes in place, nowhere opens in the center", () => {
  // In a side pane: nothing rearranges, the card in that pane is the target.
  const inbox = desk("achievements", "email", "settings", { selectedEmailId: "m1" });
  const side = navigateToTarget(inbox, { tab: "achievements", itemId: "rateExpectations" });
  assert.deepEqual(paneSections(side), paneSections(inbox));
  assert.equal(side.selectedEmailId, "m1", "the open mail stays open");
  assert.equal(highlightMatches(side.highlightTarget, "achievements", "rateExpectations"), true);
  assert.equal(highlightMatches(side.highlightTarget, "achievements", null, "pane"), false, "the bar does not also flash");
  // In the center: same as before.
  const center = navigateToTarget(desk("shop", "openSource", "projects"), { tab: "openSource", itemId: "blocker" });
  assert.equal(center.activeTab, "openSource");
  assert.equal(highlightMatches(center.highlightTarget, "openSource", "blocker"), true);
  // On screen nowhere: it opens in the center (replacing the inbox), the sides never change.
  const nowhere = navigateToTarget(desk("farm", "email", "settings", { selectedEmailId: "m1" }), { tab: "achievements", itemId: "rateExpectations" });
  assert.deepEqual(paneSections(nowhere), { left: "farm", center: "achievements", right: "settings" });
  assert.equal(nowhere.selectedEmailId, "m1", "back to Email reopens the same mail");
  // A link never puts a section into a side pane.
  let followed = 0;
  for (const state of allLayouts()) {
    for (const tab of EMAIL_LINK_TABS) {
      // A real link: the tab's first card (the Farm links to the tab itself).
      const next = navigateToTarget(state, { tab, itemId: LINK_ITEM[tab] ?? null });
      assert.notEqual(next, state, `${tab} is a valid link`);
      followed += 1;
      assert.deepEqual(next.sidePanes, state.sidePanes);
      assert.ok(isSectionOnScreen(next, tab));
      assert.ok(panesAreValid(next));
    }
  }
  assert.equal(followed, 210 * EMAIL_LINK_TABS.length, `${followed} links followed`);
  // Mobile: unchanged, the tab switches.
  assert.equal(navigateToTarget(mobile("email"), { tab: "farm", itemId: null }).activeTab, "farm");
});

test("scope: the Farm's tab anchor and a title bar anchor never both match", () => {
  const link = navigateToTarget(desk("shop", "email", "projects"), { tab: "farm", itemId: null });
  assert.equal(highlightMatches(link.highlightTarget, "farm"), true, "the email link hits the Farm top-panel anchor");
  assert.equal(highlightMatches(link.highlightTarget, "farm", null, "pane"), false);
  const tap = showSection(desk("farm", "email", "projects"), "farm");
  assert.equal(highlightMatches(tap.highlightTarget, "farm", null, "pane"), true, "the nav tap hits the title bar");
  assert.equal(highlightMatches(tap.highlightTarget, "farm"), false);
  // It is consumed like any target, and a manual tab switch clears it.
  assert.equal(consumeHighlight(tap, tap.highlightTarget.key).highlightTarget, null);
  assert.equal(clearHighlight(tap).highlightTarget, null);
});

test("on screen: the side panes count as seen (mail notification, Farm badge)", () => {
  const s = desk("email", "openSource", "farm");
  assert.equal(isSectionOnScreen(s, "email"), true);
  assert.equal(isSectionOnScreen(s, "farm"), true);
  assert.equal(isSectionOnScreen(s, "settings"), false);
  assert.equal(paneOf(s, "email"), "left");
  assert.equal(isSectionOnScreen(mobile("shop"), "email"), false);
  assert.equal(isSectionOnScreen(mobile("email"), "email"), true);
  // The reducer: all four new-mail checks (Night Shift, Shooting Stars
  // chain, withEmailTriggers, withAchievements) and the Farm checks read it.
  const context = src("context/GameContext.jsx");
  assert.ok(!/activeTab [!=]== "email"/.test(context), "no activeTab email check left");
  assert.ok(!/activeTab [!=]== "farm"/.test(context), "no activeTab farm check left");
  assert.equal((context.match(/isSectionOnScreen\((?:new)?[sS]tate, "email"\)/g) ?? []).length, 4);
  assert.match(context, /watching: isSectionOnScreen\(state, "farm"\),/);
  assert.match(src("components/NavBar.jsx"), /const unseenBirths = isSectionOnScreen\(state, "farm"\)/);
});

test("the reducer: one helper for the nav, OPEN_EMAIL and links; the pane actions; persistence; selectedPanes gone", () => {
  const context = src("context/GameContext.jsx");
  assert.match(context, /return withFarmVisit\(showSection\(clearHighlight\(state\), activeTab\)\);/);
  assert.match(context, /\.\.\.showSection\(state, "email"\),\s*selectedEmailId: emailId,/);
  assert.match(src("navigation/highlight.js"), /\.\.\.showSection\(state, clean\.tab, \{ flashPane: false \}\),/);
  assert.match(context, /case "SET_LAYOUT_MODE": \{\s*return withFarmVisit\(setLayoutMode\(state, action\.payload\?\.mode\)\);/);
  assert.match(context, /case "CHOOSE_PANE_SECTION": \{\s*return withFarmVisit\(\s*chooseSectionForPane\(state, action\.payload\?\.pane, action\.payload\?\.sectionId\)/);
  // The device preference: read through the sanitizer at start, written back in try/catch.
  assert.match(context, /stored = localStorage\.getItem\(SIDE_PANES_STORAGE_KEY\);/);
  assert.match(context, /sidePanes: readSidePanes\(stored\),/);
  assert.match(context, /localStorage\.setItem\(\s*SIDE_PANES_STORAGE_KEY,\s*JSON\.stringify\(\{ left: sideLeft, right: sideRight \}\)\s*\);/);
  assert.match(context, /useReducer\(rootReducer, initialState, initGameState\)/);
  // Never in the save; the dead selectedPanes is deleted.
  assert.ok(!/selectedPanes/.test(context));
  const serialize = src("save/serialize.js");
  assert.ok(!/sidePanes:|layoutMode:/.test(serialize.replace(/\/\*[\s\S]*?\*\//g, "")));
  // App reports the media query and renders the panes from the reducer.
  const app = src("App.jsx");
  assert.match(app, /type: "SET_LAYOUT_MODE",\s*payload: \{ mode: isDesktop \? "desktop" : "mobile" \},/);
  assert.match(app, /<Pane position="left" desktop \/>\s*<Pane position="center" desktop \/>\s*<Pane position="right" desktop \/>/);
  assert.match(app, /<Pane position="center" desktop=\{false\} \/>/);
  assert.ok(!/<OpenSource \/>|ScrollAffordanceFrame/.test(app), "no fallback branch, no per-pane scroller in App");
});

test("title bars pinned structurally, the Info toggle, the picker on desktop only, no dashes", () => {
  const layout = src("components/SectionLayout.jsx");
  // The bar, then the scroller that holds the description and content.
  const bar = layout.indexOf("<SectionTitleBar");
  const scroller = layout.indexOf("<ScrollAffordanceFrame");
  assert.ok(bar > 0 && scroller > bar, "the bar is above its own scroller");
  assert.ok(layout.indexOf("<CodeComment>") > scroller, "the description scrolls under the bar");
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/sticky/.test(code(layout + src("components/SectionTitleBar.jsx"))), "not CSS sticky");
  // Every section renders through SectionLayout.
  for (const file of ["Shop", "Projects", "OpenSource", "Farm", "Achievements", "Settings", "Email"]) {
    assert.match(src(`components/${file}.jsx`), /<SectionLayout sectionId="/, file);
  }
  const titleBar = src("components/SectionTitleBar.jsx");
  // The toggle: bordered, "Info" with a chevron, a disclosure, never an x.
  assert.match(titleBar, /className="info-toggle [^"]*border border-\[#5a5a5a\]/);
  assert.match(titleBar, /<span>Info<\/span>/);
  assert.match(titleBar, /aria-expanded=\{isDescriptionVisible\}/);
  assert.match(titleBar, /isDescriptionVisible \? "Hide description" : "Show description"/);
  const toggle = titleBar.slice(titleBar.indexOf('className="info-toggle'), titleBar.indexOf("</button>", titleBar.indexOf('className="info-toggle')));
  for (const x of ["×", "✕", "✖", ">x<", ">X<"]) assert.ok(!toggle.includes(x), `no ${x}`);
  // The picker: the title button on desktop only; plain text on mobile.
  assert.match(titleBar, /\{desktop \? \(\s*<button\s*ref=\{titleButtonRef\}/);
  assert.match(titleBar, /aria-haspopup="listbox"/);
  assert.match(titleBar, /title="Change this pane"/);
  assert.match(titleBar, /\{desktop && pickerOpen && \(/);
  assert.match(titleBar, /<HighlightAnchor\s*tab=\{sectionId\}\s*scope="pane"/);
  const picker = src("components/PanePicker.jsx");
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /role="option"/);
  assert.match(picker, /Open \(\{PANE_WORD\[row\.pane\]\}\)/);
  assert.match(picker, />Swap</);
  assert.match(picker, /Here ✓/);
  assert.match(picker, /dispatch\(\{ type: "CHOOSE_PANE_SECTION", payload: \{ pane, sectionId: row\.id \} \}\);/);
  assert.match(src("navigation/paneContext.js"), /createContext\(\{ pane: "center", desktop: false \}\)/);
  // The nav: pinned sections get the ring.
  assert.match(src("components/NavButton.jsx"), /ring-2 ring-blue-400/);
  for (const file of ["components/SectionTitleBar.jsx", "components/PanePicker.jsx", "components/Pane.jsx", "navigation/panes.js", "components/NavButton.jsx"]) {
    assert.ok(!/[—–]/.test(src(file)), `no em or en dash in ${file}`);
  }
});
