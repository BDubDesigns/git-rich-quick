/**
 * The numbers react (issue #214, Slice 2 of the #210 game-feel pass):
 * which state changes make a header stat bump, as pure functions so the
 * server test suite pins them. Presentation and detection only.
 *
 * A gain is detected per ACTION, never by diffing the numbers on
 * screen, so the cases that must never fire cannot:
 * - Save load and restore (RESTORE_SAVE: the numbers appearing, a 409
 *   revert, the sale, and the intermission completion building the new
 *   company) are never examined, and clear any pending gain.
 * - Ticks (GAME_TICK) and clicks (WRITE_CODE) are never examined.
 * - Only a RISE counts; spending and resets never fire.
 *
 * The sources:
 * - LOC and Money: a star claim (APPLY_STAR_REWARD, Airdrops and chain
 *   steps included) or a manual ship (COMPLETE_PROJECT), when the stat
 *   rises by at least BIG_GAIN_SECONDS of its current production; the
 *   Night Shift report (its credited LOC, which the load already put in
 *   the numbers); the Starting Capital grant (STAT_GAIN, dispatched
 *   after a fresh intermission completion).
 * - LOC/s: any other action that raises the rate by at least
 *   RATE_JUMP_FRACTION (a hire, a level-up, a buff starting).
 */

/** A big gain is at least this many seconds of current production. */
export const BIG_GAIN_SECONDS = 5;

/** The LOC/s stat bumps when the rate rises by at least this fraction. */
export const RATE_JUMP_FRACTION = 0.1;

/** The bump, ms (StatBump in index.css's stat-bump rules). */
export const STAT_BUMP_MS = 360;

/** A gain this recent still plays when the stat mounts (the header returns after the intermission). */
export const STAT_GAIN_FRESH_MS = 1500;

/** The gain colors: LOC green, Money gold, LOC/s the active-nav blue. */
export const STAT_GAIN_COLORS = Object.freeze({
  loc: "#4ade80",
  money: "#facc15",
  rate: "#60a5fa",
});

/** Never examined: restore/load, ticks and clicks. */
export const STAT_GAIN_NEVER_ACTIONS = Object.freeze(["RESTORE_SAVE", "GAME_TICK", "WRITE_CODE"]);

/** Actions whose LOC and Money rises can be big gains. */
export const STAT_GAIN_AMOUNT_ACTIONS = Object.freeze(["APPLY_STAR_REWARD", "COMPLETE_PROJECT"]);

/**
 * Whether a rise of `amount` is a big gain at `perSecond` production:
 * a positive amount of at least BIG_GAIN_SECONDS of it. With no
 * production (a new company, Money with no Release Manager) any
 * positive gain from a listed source counts. Junk is never a gain.
 */
export function isBigGain(amount, perSecond) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return false;
  const rate = Number(perSecond);
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 0;
  return a >= BIG_GAIN_SECONDS * safeRate;
}

/** Whether the rate rose by at least RATE_JUMP_FRACTION (or from 0). */
export function isRateJump(prevRate, nextRate) {
  const prev = Number(prevRate);
  const next = Number(nextRate);
  if (!Number.isFinite(prev) || !Number.isFinite(next) || next <= prev) return false;
  if (prev <= 0) return next > 0;
  // The rise against the fraction (prev * 1.1 is 110.00000000000001 at
  // 100, which would miss an exact +10%).
  return next - prev >= prev * RATE_JUMP_FRACTION - 1e-9;
}

/**
 * Which stats an action bumps. `prev` and `next` are
 * { loc, money, rate, moneyRate } before and after (rate is LOC/s,
 * moneyRate the cash per second, both "current production"); `action`
 * the dispatched action. Returns { loc, money, rate } booleans.
 */
export function statGainFlags(action, prev, next) {
  const none = { loc: false, money: false, rate: false };
  const type = action?.type;
  if (!type || STAT_GAIN_NEVER_ACTIONS.includes(type)) return none;
  const flags = { ...none };
  if (STAT_GAIN_AMOUNT_ACTIONS.includes(type)) {
    flags.loc = isBigGain(next.loc - prev.loc, prev.rate);
    flags.money = isBigGain(next.money - prev.money, prev.moneyRate);
  } else if (type === "NIGHT_SHIFT_REPORT") {
    flags.loc = isBigGain(action.payload?.creditedLoc, next.rate);
  } else if (type === "STAT_GAIN") {
    flags.loc = isBigGain(action.payload?.loc, next.rate);
    flags.money = isBigGain(action.payload?.money, next.moneyRate);
  }
  flags.rate = isRateJump(prev.rate, next.rate);
  return flags;
}

/**
 * The next state.statGain: a new sequence number with the flags and the
 * time, or the previous one unchanged when nothing bumps.
 */
export function nextStatGain(prevGain, flags, nowMs) {
  if (!flags?.loc && !flags?.money && !flags?.rate) return prevGain ?? null;
  return {
    seq: (prevGain?.seq ?? 0) + 1,
    loc: Boolean(flags.loc),
    money: Boolean(flags.money),
    rate: Boolean(flags.rate),
    atMs: nowMs,
  };
}

/** Whether a gain bumps `key` when the stat mounts: flagged and fresh. */
export function statGainFreshOnMount(gain, key, nowMs) {
  return Boolean(gain?.[key]) && nowMs - (gain?.atMs ?? -Infinity) <= STAT_GAIN_FRESH_MS;
}

/**
 * The pulse a stat shows after a new gain: the gain's seq when it
 * flags this stat (a new seq remounts the value and restarts the bump,
 * never stacking), else the current pulse.
 */
export function statPulseAfter(currentPulse, gain, key) {
  return gain?.[key] ? gain.seq : currentPulse;
}
