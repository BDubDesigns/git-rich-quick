/**
 * Shipped (issue #219, Slice 7 of the #210 game-feel pass), as pure
 * functions so the server test suite pins them. Presentation only:
 * payouts and shipping logic are untouched.
 *
 * Two halves, per the #219 amendment (issue #229's rule: passive income
 * streams get bars or pulses, events get chips):
 * - A manual Ship tap is an event: its float wears the cash version of
 *   the Slice A diff chip (ShipChip.css, scoped to the Ship button, so
 *   the float's own files and behavior are untouched).
 * - Release Manager auto-ships are a stream: NO floating chip. A tick
 *   that auto-ships records state.autoShipPulse ({ seq, atMs },
 *   transient, never saved, cleared by a restore), and the shipping
 *   strip's Cash readout does a Slice 2 bump, at most once a second.
 */

/** The auto-ship pulse never runs more often than this, ms. */
export const CASH_PULSE_MIN_GAP_MS = 1000;

/** The next state.autoShipPulse after a tick: a new seq only when it auto-shipped. */
export function nextAutoShipPulse(prev, autoShipCount, nowMs) {
  if (!(autoShipCount > 0)) return prev ?? null;
  return { seq: (prev?.seq ?? 0) + 1, atMs: nowMs };
}

/**
 * The readout's pulse after a new auto-ship record: { key, atMs }.
 * A new record bumps (key = its seq) only if the last bump was at
 * least CASH_PULSE_MIN_GAP_MS ago; otherwise the current pulse stands.
 */
export function cashPulseAfter(current, record, nowMs) {
  if (!record) return current;
  const last = current?.atMs ?? -Infinity;
  if (nowMs - last < CASH_PULSE_MIN_GAP_MS) return current;
  return { key: record.seq, atMs: nowMs };
}
