/**
 * Progress bar visibility preferences (issue #128).
 *
 * One Settings toggle per progress bar: each bar can be shown or
 * hidden, and the choice persists across reloads. These are device
 * preferences, stored in localStorage under the same `grq:` prefix as
 * the sound settings and the collapsed star bars (never in the server
 * save). Every bar defaults to SHOWN, so a player who never opens the
 * toggles sees exactly what they saw before.
 *
 * Framework-free (no React) so the server tests can exercise it with a
 * fake storage; the React hook lives in hooks/useProgressBarPrefs.js.
 * Writes notify subscribers, so a toggle in Settings updates every bar
 * on screen at once.
 *
 * Copy rules: no em dashes in any label or description.
 */

/** Every toggleable progress bar, in Settings display order. */
export const PROGRESS_BARS = Object.freeze([
  Object.freeze({
    id: "unlock",
    label: "Unlock progress",
    description:
      "The bars on locked hires, projects, open source, and the Llama Farm, plus the SUBTRACTERALL unlock bar. Hidden, the requirement still shows as text.",
  }),
  Object.freeze({
    id: "equityStrip",
    label: "Next Equity strip",
    description:
      "The violet bar under the stats showing progress to your next Equity point.",
  }),
  Object.freeze({
    id: "equityMeter",
    label: "Next Equity meter",
    description: "The progress bar on Sell the Company.",
  }),
  Object.freeze({
    id: "starCountdown",
    label: "Golden star countdown",
    description: "The gold bar counting down to the next star.",
  }),
  Object.freeze({
    id: "starEffects",
    label: "Star effect timers",
    description: "The bars showing how long a star buff (or debuff) has left.",
  }),
  Object.freeze({
    id: "starBuy",
    label: "Buy Star bar",
    description:
      "The StarBroker bar with the Buy a Star button and its cooldown. Hiding it hides the button too.",
  }),
  Object.freeze({
    id: "achievements",
    label: "Achievement progress",
    description:
      "The bars toward each next tier on the Trophies tab. Hidden, progress still shows as text.",
  }),
]);

/** The toggleable bar ids. */
export const PROGRESS_BAR_IDS = Object.freeze(PROGRESS_BARS.map((bar) => bar.id));

/** localStorage key for one bar's visibility ("0" hidden, "1" shown). */
export function progressBarStorageKey(id) {
  return `grq:progressBar:${id}`;
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
// In-memory values for when storage is unavailable or throws, so a
// toggle still works for the session even if it cannot persist.
const memory = new Map();

/** Whether a bar is shown. Unknown ids and missing values read shown. */
export function isProgressBarEnabled(id, storage = defaultStorage()) {
  if (!PROGRESS_BAR_IDS.includes(id)) return true;
  let stored = null;
  try {
    stored = storage ? storage.getItem(progressBarStorageKey(id)) : null;
  } catch {
    stored = null;
  }
  if (stored === "0") return false;
  if (stored === "1") return true;
  return memory.has(id) ? memory.get(id) : true;
}

/** Show or hide a bar, persist the choice, and notify subscribers. */
export function setProgressBarEnabled(id, enabled, storage = defaultStorage()) {
  if (!PROGRESS_BAR_IDS.includes(id)) return;
  const value = Boolean(enabled);
  memory.set(id, value);
  try {
    if (storage) storage.setItem(progressBarStorageKey(id), value ? "1" : "0");
  } catch {
    // Storage unavailable: the in-memory value still applies.
  }
  for (const listener of [...listeners]) listener();
}

/** Subscribe to preference changes; returns the unsubscribe function. */
export function subscribeProgressBarPrefs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every bar's visibility, as { [id]: boolean }. */
export function progressBarPrefsSnapshot(storage = defaultStorage()) {
  const prefs = {};
  for (const id of PROGRESS_BAR_IDS) {
    prefs[id] = isProgressBarEnabled(id, storage);
  }
  return prefs;
}
