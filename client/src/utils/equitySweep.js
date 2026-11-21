/**
 * Equity milestones (issue #220, Slice 8 of the #210 game-feel pass):
 * when the Equity strip sweeps, as pure functions so the server test
 * suite pins them. Presentation only: the strip keeps reading the
 * shared claimableEquity; the Equity math is untouched.
 *
 * Trigger: claimableEquity rising (a new point becomes sellable). The
 * root reducer compares it before and after every action except a
 * restore (a load, a revert or the sale's reset is never a gain) and
 * records state.equityGain ({ seq, from, to, milestone, atMs },
 * transient, never saved). One record per step: a jump of several
 * points in one step fires ONCE, not once per point.
 *
 * Look: a light sweep crosses the strip once (700ms) and the "+N
 * Equity" text does a Slice 2 bump. Reaching or crossing a milestone
 * (1, 5, 10, 25, 50, 100 claimable) makes the sweep gold and doubled
 * (two passes, 1.4s).
 */
import { claimableEquity } from "../../../shared/game-balance.js";

/** The claimable counts that get the gold, doubled sweep. */
export const EQUITY_MILESTONES = Object.freeze([1, 5, 10, 25, 50, 100]);

/** One sweep, ms; the doubled milestone sweep, ms (EquitySweep.css). */
export const EQUITY_SWEEP_MS = 700;
export const EQUITY_MILESTONE_SWEEP_MS = 1400;

/** Whether a step from `from` to `to` reaches or crosses a milestone. */
export function crossesMilestone(from, to) {
  return EQUITY_MILESTONES.some((m) => from < m && m <= to);
}

/** The claimable Equity of a reducer state. */
export function claimableOf(state) {
  return claimableEquity(state?.totalLinesOfCode ?? 0, state?.lifetimeEquityEarned ?? 0);
}

/**
 * The next state.equityGain for an action: a new record when the
 * claimable count rose (once, however many points), else the previous
 * one. A restore is never a gain.
 */
export function nextEquityGain(prevState, nextState, actionType, nowMs) {
  const prevGain = prevState?.equityGain ?? null;
  if (actionType === "RESTORE_SAVE") return null;
  if (
    nextState?.totalLinesOfCode === prevState?.totalLinesOfCode &&
    nextState?.lifetimeEquityEarned === prevState?.lifetimeEquityEarned
  ) {
    return nextState?.equityGain ?? prevGain;
  }
  const from = claimableOf(prevState);
  const to = claimableOf(nextState);
  if (!(to > from)) return nextState?.equityGain ?? prevGain;
  return {
    seq: (prevGain?.seq ?? 0) + 1,
    from,
    to,
    milestone: crossesMilestone(from, to),
    atMs: nowMs,
  };
}

/**
 * The strip's lead and the rest of its text: "+N Equity" (bumped) and
 * " if you sell now · ...". The lead is null with nothing claimable.
 */
export function splitStripText(text) {
  const m = /^(\+\d+ Equity)(.*)$/.exec(String(text ?? ""));
  return m ? { lead: m[1], rest: m[2] } : { lead: null, rest: String(text ?? "") };
}
