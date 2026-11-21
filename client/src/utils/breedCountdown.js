/**
 * The Farm's countdown to the next breeding check (issue #239), as pure
 * functions so the server test suite can pin them.
 *
 * One source of truth: the countdown is read from the reducer's own
 * breeding clock, state.farmBreedTicks. GAME_TICK adds one to it every
 * second and raises farmBreedDue (and zeroes the count) once it reaches
 * FARM_CONFIG.breedingTickSeconds. There is no second timer here, so the
 * countdown can never drift from the real check: it moves only when the
 * game tick does, and it freezes when the tick does (the intermission).
 */
import { FARM_CONFIG } from "../../../shared/game-balance.js";

/**
 * Whole seconds until the next breeding check, from the reducer's
 * farmBreedTicks. 60 right after a check, 1 on the last second before
 * one. A count at or past the interval (ticks counted before the barn
 * was bought) means the very next tick runs the check, so that is 1.
 */
export function secondsUntilBreedCheck(
  breedTicks,
  intervalSeconds = FARM_CONFIG.breedingTickSeconds
) {
  const ticks = Number.isFinite(breedTicks) && breedTicks > 0 ? Math.floor(breedTicks) : 0;
  return Math.min(intervalSeconds, Math.max(1, intervalSeconds - ticks));
}

/** Seconds as m:ss, for example 42 is "0:42" and 60 is "1:00". */
export function formatBreedCountdown(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
