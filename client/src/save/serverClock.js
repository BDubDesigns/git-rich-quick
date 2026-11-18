/**
 * Server clock offset (issue #148): star timing anchored to server
 * time, so setting the device clock forward cannot skip a star
 * countdown or the StarBroker cooldown.
 *
 *   offsetMs = serverTime - deviceTime
 *   serverNowMs() = Date.now() + offsetMs
 *
 * The offset comes from the `savedAt` the save server already
 * returns: no new endpoint, and the server keeps no authority over
 * stars. It is refreshed from every response whose `savedAt` is the
 * server's "now" (an accepted save, a mint, a fresh reset / sale /
 * store buy / intermission), and persisted to localStorage so it
 * survives reloads and keeps working offline (the last-known offset).
 * With nothing stored it is 0: the device clock.
 *
 * NOT refreshed from the load response: a load's `savedAt` is when the
 * save was last STORED, not the current time, so after a day away it
 * is a day old and would wind the clock back by the whole absence.
 * The persisted offset covers the load, and the next accepted save
 * (a 60s heartbeat at most) refreshes it.
 *
 * Accepted limits (by design): offline there is no server to check
 * against, so a clock change helps offline; online it only helps until
 * the next save. Full prevention would need the server to own star
 * timing again, which was deliberately removed.
 *
 * Plain module state, no React: the reducer and components read it
 * directly, and node tests import it with an injected storage.
 */

/** localStorage key for the persisted offset (ms, a finite number). */
export const SERVER_CLOCK_OFFSET_KEY = "grq:serverClockOffset";

/** The browser's localStorage, or null where it is unavailable. */
function browserStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

let storage = browserStorage();
let offsetMs = readStoredOffset();

/** The persisted offset, or 0 when none is stored or it is unreadable. */
function readStoredOffset() {
  try {
    const raw = storage?.getItem(SERVER_CLOCK_OFFSET_KEY);
    if (raw === null || raw === undefined || raw === "") return 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** The current offset in ms (server minus device). */
export function serverClockOffsetMs() {
  return offsetMs;
}

/** Server time now, in ms since the epoch: the device clock plus the offset. */
export function serverNowMs() {
  return Date.now() + offsetMs;
}

/**
 * Set the offset from a `savedAt` the server just stamped (an ISO
 * string, or ms). A missing or unparseable value is ignored and the
 * old offset kept. Returns true when the offset was updated.
 * `deviceNowMs` is injectable for tests.
 */
export function setOffsetFromSavedAt(savedAt, deviceNowMs = Date.now()) {
  if (savedAt === null || savedAt === undefined || savedAt === "") return false;
  const serverMs =
    typeof savedAt === "number" ? savedAt : Date.parse(String(savedAt));
  if (!Number.isFinite(serverMs) || !Number.isFinite(deviceNowMs)) return false;
  offsetMs = serverMs - deviceNowMs;
  try {
    storage?.setItem(SERVER_CLOCK_OFFSET_KEY, String(offsetMs));
  } catch {
    // Storage unavailable (private mode): the offset still applies
    // for this session, it just does not survive a reload.
  }
  return true;
}

/**
 * Tests only: swap the storage (getItem/setItem) and re-read the
 * offset from it. Pass null for "no storage".
 */
export function _resetServerClockForTests(nextStorage = null) {
  storage = nextStorage;
  offsetMs = readStoredOffset();
}
