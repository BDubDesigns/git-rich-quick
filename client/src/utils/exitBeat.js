/**
 * The exit (issue #215, Slice 3 of the #210 game-feel pass): the 1.1s
 * "merge" beat after a successful sale, as pure data plus a tiny store,
 * so the server test suite pins it. A presentation layer over the sale:
 * the sale, its frozen quote and the store-only intermission (#196,
 * #188) run exactly as before, and the store screen is already rendered
 * under the beat (it is not a loading screen; its buttons stay live).
 *
 * The timeline, from the sale response:
 * 1. 0 to 350ms: the Equity strip flashes gold, reading MERGED INTO main
 *    (a copy over where the strip was: the store screen has replaced
 *    the game by then).
 * 2. 250 to 900ms: the ACQUIRED stamp slams in over the middle.
 * 3. 900 to 1100ms: the stamp fades.
 * 4. Then, on the store screen: Equity spendable counts up from the old
 *    value to the new one over 700ms, with one Slice 2 bump at the end.
 */

/** The copy (no dashes). */
export const EXIT_STRIP_TEXT = "MERGED INTO main";
export const EXIT_STAMP_TEXT = "ACQUIRED";

/** The beat, ms. Matches ExitBeat.css. */
export const EXIT_BEAT_MS = 1100;
export const EXIT_STRIP_MS = 350;
export const EXIT_STAMP_IN_MS = 250;
export const EXIT_STAMP_HOLD_END_MS = 900;
export const EXIT_COUNT_UP_MS = 700;

/** The beat's layer: the top of the ambient band, under the floats. */
export const EXIT_BEAT_Z_INDEX = 55;

/** A beat this recent still counts up when the store mounts. */
export const EXIT_BEAT_FRESH_MS = 3000;

/**
 * The count-up's value at progress `t` (0 to 1) from `from` to `to`:
 * whole Equity, on a strong ease-out, never past `to`, and exactly `to`
 * at the end. A count with nothing to climb is `to` throughout.
 */
export function exitCountUpValue(from, to, t) {
  const target = Number.isFinite(Number(to)) ? Number(to) : 0;
  const start = Number.isFinite(Number(from)) ? Number(from) : target;
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (p >= 1 || start >= target) return target;
  const eased = 1 - (1 - p) ** 3;
  return Math.min(target, Math.floor(start + (target - start) * eased));
}

/**
 * How long the count-up waits after the store mounts: until the beat
 * (the stamp) is over. 0 when it is already over.
 */
export function exitCountUpDelayMs(beat, nowMs) {
  if (!beat) return 0;
  return Math.max(0, beat.atMs + EXIT_BEAT_MS - nowMs);
}

/** Whether the store should count up for this beat: fresh, and climbing. */
export function exitCountUpActive(beat, spendable, nowMs) {
  return (
    Boolean(beat) &&
    nowMs - beat.atMs <= EXIT_BEAT_FRESH_MS &&
    Number.isFinite(Number(beat.fromEquity)) &&
    Number(beat.fromEquity) < Number(spendable)
  );
}

// The live beat: at most one (a second sale replaces it). Module state,
// because the sale's screen (Settings) is gone by the time the beat
// plays; the layer reads it from beside the App.
let current = null;
const listeners = new Set();

/** The live beat, or null. */
export function getExitBeat() {
  return current;
}

/** Subscribe to beat changes (useSyncExternalStore). */
export function subscribeExitBeat(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Start the beat. `stripRect` is where the Equity strip was ({ left,
 * top, width, height }, or null when it was not on screen); `fromEquity`
 * the spendable Equity before the sale.
 */
export function startExitBeat({ stripRect = null, fromEquity = null } = {}, nowMs = Date.now()) {
  current = { id: nowMs + Math.random(), atMs: nowMs, stripRect, fromEquity };
  for (const listener of listeners) listener();
  return current;
}

/** End the beat `id` (the stamp's animation ended). */
export function endExitBeat(id) {
  if (!current || current.id !== id) return;
  current = null;
  for (const listener of listeners) listener();
}

/** The Equity strip's on-screen box, or null when it is not shown. */
export function measureEquityStrip(doc = globalThis.document) {
  const strips = doc?.querySelectorAll?.("[data-equity-strip]") ?? [];
  for (const el of strips) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
  }
  return null;
}
