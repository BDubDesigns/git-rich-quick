/**
 * Choosable panes (issue #174): the pane rules, as pure functions over
 * the reducer state, so the server test suite imports them directly
 * (no React, no npm imports), like navigation/highlight.js.
 *
 * The model:
 * - Desktop: two pinned side panes (`sidePanes.left` / `.right`) and
 *   one center pane (`activeTab`), three different sections on screen.
 *   Mobile: one pane, `activeTab`.
 * - The nav and email links only ever change the center, through ONE
 *   helper, showSection: a section already on screen never moves (a
 *   side pane's title bar flashes instead), and an off-screen section
 *   opens in the center.
 * - Only the pane picker rearranges (chooseSectionForPane), with SWAP
 *   semantics: picking a section open in another pane trades the two.
 * - The invariant: on desktop the three panes always hold three
 *   different valid sections, and `activeTab` is never a side section.
 * - The side panes are a device preference (localStorage
 *   `grq:sidePanes`, read through readSidePanes), never in the save.
 */

/** Every section a pane can show, in nav order (pinned to NAV_TABS by a test). */
export const PANE_SECTION_IDS = Object.freeze([
  "email",
  "shop",
  "projects",
  "openSource",
  "farm",
  "achievements",
  "settings",
]);

/** The three desktop panes. */
export const PANES = Object.freeze(["left", "center", "right"]);

/** Where the side panes start: Hire on the left, Projects on the right. */
export const DEFAULT_SIDE_PANES = Object.freeze({ left: "shop", right: "projects" });

/**
 * The center a fresh desktop load opens on: Open Source, as before
 * (the default layout is Hire / Open Source / Projects). If a side pane
 * holds it, the center falls to the first free section in nav order.
 */
export const DESKTOP_START_SECTION = "openSource";

/** localStorage key for the side panes (same `grq:` prefix as the other device preferences). */
export const SIDE_PANES_STORAGE_KEY = "grq:sidePanes";

/** The two layout modes; App sets it from its min-width 1024px media query. */
export const LAYOUT_MODES = Object.freeze(["desktop", "mobile"]);

/** Whether `id` is a section a pane can show. */
export function isPaneSection(id) {
  return PANE_SECTION_IDS.includes(id);
}

/**
 * The side panes from storage: a JSON string or an object holding two
 * different known section ids. Anything else (unknown ids, duplicates,
 * a missing key, junk, a parse error) is the default, Hire / Projects.
 */
export function readSidePanes(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_SIDE_PANES };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SIDE_PANES };
  }
  const { left, right } = value;
  if (!isPaneSection(left) || !isPaneSection(right) || left === right) {
    return { ...DEFAULT_SIDE_PANES };
  }
  return { left, right };
}

/** The side panes in state, sanitized (the reducer state is the source). */
function sidesOf(state) {
  return readSidePanes(state?.sidePanes);
}

/** Whether the reducer state is in the desktop layout. */
export function isDesktopLayout(state) {
  return state?.layoutMode === "desktop";
}

/** The first section, in nav order, that neither side pane shows. */
export function firstFreeSection(sidePanes) {
  const sides = readSidePanes(sidePanes);
  return PANE_SECTION_IDS.find((id) => id !== sides.left && id !== sides.right);
}

/** { left, center, right } on desktop (center is activeTab). */
export function paneSections(state) {
  const sides = sidesOf(state);
  return { left: sides.left, center: state.activeTab, right: sides.right };
}

/** The sections on screen: three on desktop, one on mobile. */
export function onScreenSections(state) {
  if (!isDesktopLayout(state)) return [state.activeTab];
  const panes = paneSections(state);
  return [panes.left, panes.center, panes.right];
}

/**
 * Whether a section is on screen. The new-mail notification bar and
 * the Farm birth badge read this, so a section pinned in a side pane
 * counts as seen just like the center (or the one mobile pane).
 */
export function isSectionOnScreen(state, id) {
  return onScreenSections(state).includes(id);
}

/** The desktop pane a section is in ("left", "center", "right"), or null. */
export function paneOf(state, id) {
  if (!isDesktopLayout(state)) return state.activeTab === id ? "center" : null;
  const panes = paneSections(state);
  return PANES.find((pane) => panes[pane] === id) ?? null;
}

/**
 * Keep the desktop invariant: the center is a valid section that no
 * side pane shows. A center that collides (the layout just turned
 * desktop with a side section active) falls to the first free section
 * in nav order. Mobile is left as it is.
 */
export function normalizeCenter(state) {
  if (!isDesktopLayout(state)) return state;
  const sides = sidesOf(state);
  const center = state.activeTab;
  const sidesStored =
    state.sidePanes?.left === sides.left && state.sidePanes?.right === sides.right;
  if (isPaneSection(center) && center !== sides.left && center !== sides.right) {
    return sidesStored ? state : { ...state, sidePanes: sides };
  }
  return { ...state, sidePanes: sides, activeTab: firstFreeSection(sides) };
}

/** The highlight target for "it's over here": only a title bar's own anchor matches it. */
function paneFlash(state, id) {
  const seq = Number.isInteger(state.highlightSeq) ? state.highlightSeq : 0;
  const key = seq + 1;
  return {
    ...state,
    highlightSeq: key,
    highlightTarget: { tab: id, itemId: null, scope: "pane", key },
  };
}

/**
 * Show a section: the ONE helper for nav taps, the notification bar's
 * OPEN_EMAIL and email deep links.
 * - Mobile: it becomes the one pane.
 * - Desktop, already in the center: nothing changes.
 * - Desktop, pinned in a side pane: nothing moves; that pane's title
 *   bar flashes (unless `flashPane` is false: a deep link records its
 *   own item target instead).
 * - Desktop, on screen nowhere: it opens in the center; the sides
 *   never change.
 * An unknown id changes nothing.
 */
export function showSection(state, id, { flashPane = true } = {}) {
  if (!isPaneSection(id)) return state;
  if (!isDesktopLayout(state)) {
    return state.activeTab === id ? state : { ...state, activeTab: id };
  }
  const pane = paneOf(state, id);
  if (pane === "center") return state;
  if (pane === "left" || pane === "right") {
    return flashPane ? paneFlash(state, id) : state;
  }
  return { ...state, activeTab: id };
}

/**
 * The pane picker: show `id` in `pane` (desktop only). A section open
 * in another pane SWAPS with this pane's section; one on screen
 * nowhere just replaces it. Choosing the pane's own section changes
 * nothing. Any pending highlight is dropped (a swap can unmount its
 * card). The center stays `activeTab`, so the invariant holds.
 */
export function chooseSectionForPane(state, pane, id) {
  if (!isDesktopLayout(state) || !PANES.includes(pane) || !isPaneSection(id)) {
    return state;
  }
  const before = paneSections(normalizeCenter(state));
  if (before[pane] === id) return state;
  const after = { ...before };
  const from = PANES.find((p) => before[p] === id);
  after[pane] = id;
  if (from) after[from] = before[pane];
  return {
    ...state,
    highlightTarget: null,
    sidePanes: { left: after.left, right: after.right },
    activeTab: after.center,
  };
}

/** Set the layout mode from the media query, keeping the desktop invariant. */
export function setLayoutMode(state, mode) {
  if (!LAYOUT_MODES.includes(mode)) return state;
  const next = state.layoutMode === mode ? state : { ...state, layoutMode: mode };
  return normalizeCenter(next);
}

/**
 * The picker's row for a section, seen from `pane`: "here" (this
 * pane's own), "open" in another pane (choosing swaps), or "free".
 */
export function pickerRowState(state, pane, id) {
  const panes = paneSections(state);
  if (panes[pane] === id) return { kind: "here", pane };
  const other = PANES.find((p) => p !== pane && panes[p] === id);
  return other ? { kind: "open", pane: other } : { kind: "free", pane: null };
}

/** Whether the desktop invariant holds: three different valid sections. */
export function panesAreValid(state) {
  if (!isDesktopLayout(state)) return isPaneSection(state.activeTab);
  const { left, center, right } = paneSections(state);
  return (
    [left, center, right].every(isPaneSection) &&
    new Set([left, center, right]).size === 3 &&
    state.sidePanes?.left === left &&
    state.sidePanes?.right === right
  );
}
