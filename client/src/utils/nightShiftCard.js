/**
 * The Night Shift card's collapse preference and its compact-row copy
 * (Brandon's Nov 21 playtest: "the card is plain and I'd like it to
 * collapse, takes up too much space").
 *
 * - The open/closed choice is a device preference, like the sort modes
 *   and the progress bar toggles: localStorage under
 *   `grq:nightShiftOpen`, never the save. Collapsed is the default, so
 *   a player who never taps the chevron sees one compact row.
 * - nightShiftRowModel turns the shared nightShiftNextPurchase result
 *   into the strings both the collapsed row and the expanded detail
 *   show (level chip, button label, disabled reason), so the two views
 *   cannot disagree. No price, rate or gate math lives here: the caller
 *   passes the shared purchase result in.
 *
 * Framework-free (no React) so the server tests can exercise it with a
 * fake storage. Copy rules: no em or en dashes.
 */

/** localStorage key for the card's open/closed choice. */
export const NIGHT_SHIFT_OPEN_KEY = "grq:nightShiftOpen";

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

/** Whether the card is open on this device. Missing, junk or blocked
 *  storage reads collapsed (false). */
export function readNightShiftOpen(storage = defaultStorage()) {
  try {
    return storage ? storage.getItem(NIGHT_SHIFT_OPEN_KEY) === "1" : false;
  } catch {
    return false;
  }
}

/** Remember the open/closed choice. A throwing storage is ignored: the
 *  toggle still works for the session, it just does not persist. */
export function writeNightShiftOpen(open, storage = defaultStorage()) {
  try {
    storage?.setItem(NIGHT_SHIFT_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Quota or private mode: keep the in-memory state only.
  }
}

/**
 * The strings the card shows for a level and the shared next purchase
 * (nightShiftNextPurchase's result, or null at max level).
 *
 * - chip: "L2/5", or "L5/5 Maxed" at the top level.
 * - buyLabel / shortBuyLabel: the expanded and collapsed button text,
 *   without the price ("Hire the night shift" / "Hire" at level 0,
 *   "Upgrade to level 3" / "Upgrade" after). null when maxed.
 * - blockedReason: the expanded detail's reason the button is
 *   disabled ("" when it can be bought or is maxed).
 * - shortReason: the collapsed row's shorter version ("Locked" /
 *   "Need more cash"), short enough to fit beside the button on a
 *   phone; the expanded detail shows the full reason and the gate.
 */
export function nightShiftRowModel(level, next, maxLevel) {
  const maxed = !next;
  let blockedReason = "";
  let shortReason = "";
  if (next && !next.gate.met) {
    blockedReason = "Meet the requirements below to hire this shift.";
    shortReason = "Locked";
  } else if (next && !next.affordable) {
    blockedReason = "Not enough cash yet.";
    shortReason = "Need more cash";
  }
  return {
    maxed,
    chip: maxed ? `L${level}/${maxLevel} Maxed` : `L${level}/${maxLevel}`,
    buyLabel: maxed
      ? null
      : level === 0
        ? "Hire the night shift"
        : `Upgrade to level ${next.level}`,
    shortBuyLabel: maxed ? null : level === 0 ? "Hire" : "Upgrade",
    blockedReason,
    shortReason,
  };
}
