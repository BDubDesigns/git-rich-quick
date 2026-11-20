/**
 * Sort modes for the tabs that sell something (issues #180, #181):
 * ONE implementation shared by every tab that offers the Default /
 * Cheapest control. Two pieces live here:
 *
 * - The device preference: each tab remembers its own mode in
 *   localStorage under `grq:sortMode:<tab>`, like the progress bar
 *   toggles and the collapsed star bars. Never save data. Every tab
 *   defaults to Default, so a player who never touches the control
 *   sees exactly the order they saw before.
 * - The ordering helper, sortIdsByCost: a stable ascending sort by a
 *   cost the CALLER supplies from its own shared cost helper (the
 *   number its cards show and its buy action charges), so there is no
 *   second copy of any cost math here.
 *
 * Framework-free (no React) so the server tests can exercise it with a
 * fake storage; the React hook is hooks/useSortMode.js and the control
 * is components/SortControl.jsx.
 *
 * Copy rules: no em dashes in any label.
 */

/** The modes, in control display order. Default is first and the default. */
export const SORT_MODES = Object.freeze([
  Object.freeze({ id: "default", label: "Default" }),
  Object.freeze({ id: "cheapest", label: "Cheapest" }),
]);

export const SORT_MODE_IDS = Object.freeze(SORT_MODES.map((mode) => mode.id));

export const DEFAULT_SORT_MODE = "default";

/** The tabs that offer a sort control; each keeps its own mode. */
export const SORT_TABS = Object.freeze(["openSource", "shop"]);

/** localStorage key for one tab's sort mode. */
export function sortModeStorageKey(tab) {
  return `grq:sortMode:${tab}`;
}

function defaultStorage() {
  try {
    if (
      typeof globalThis.localStorage !== "undefined" &&
      globalThis.localStorage &&
      typeof globalThis.localStorage.getItem === "function"
    ) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage blocked (private mode): fall through to no storage.
  }
  return null;
}

const listeners = new Set();
// In-memory modes for when storage is unavailable or throws, so the
// control still works for the session even if it cannot persist.
const memory = new Map();

/** A tab's mode. Unknown tabs, missing and junk values read Default. */
export function readSortMode(tab, storage = defaultStorage()) {
  if (!SORT_TABS.includes(tab)) return DEFAULT_SORT_MODE;
  let stored = null;
  try {
    stored = storage ? storage.getItem(sortModeStorageKey(tab)) : null;
  } catch {
    stored = null;
  }
  if (SORT_MODE_IDS.includes(stored)) return stored;
  return memory.get(tab) ?? DEFAULT_SORT_MODE;
}

/** Set a tab's mode, persist it, and notify subscribers. */
export function setSortMode(tab, mode, storage = defaultStorage()) {
  if (!SORT_TABS.includes(tab) || !SORT_MODE_IDS.includes(mode)) return;
  memory.set(tab, mode);
  try {
    if (storage) storage.setItem(sortModeStorageKey(tab), mode);
  } catch {
    // Storage unavailable: the in-memory mode still applies.
  }
  for (const listener of [...listeners]) listener();
}

/** Subscribe to mode changes; returns the unsubscribe function. */
export function subscribeSortModes(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Order ids by cost, ascending. Stable: equal costs keep their input
 * order (pass ids in config order and ties keep config order). An id
 * whose cost is not a finite number sinks to the end, still stable,
 * so a missing cost can never scramble the list or throw.
 */
export function sortIdsByCost(ids, costOf) {
  return ids
    .map((id, index) => {
      const cost = costOf(id);
      return { id, index, cost: Number.isFinite(cost) ? cost : Infinity };
    })
    .sort((a, b) => {
      if (a.cost !== b.cost) return a.cost < b.cost ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.id);
}
