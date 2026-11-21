/**
 * The header tick bar (issue #229), as pure data so the server test
 * suite can pin it. Passive income is a stream, and the standing rule
 * is that streams get bars or pulses while events get chips. So the
 * per-second passive float is gone from the header; instead a slim bar
 * along the header panel's bottom edge fills over each production tick,
 * and the LOC total does a brief, quiet flash when the tick lands. The
 * amount needs no number of its own: it is the printed LOC/s rate.
 *
 * The game tick (App.jsx) dispatches PRODUCTION_TICK_EVENT on window
 * after every tick that credits passive LOC. Each event restarts the bar
 * (a new key) and the flash, so the bar lands as the LOC total jumps.
 */

/** The window event the game tick dispatches when it credits passive LOC. */
export const PRODUCTION_TICK_EVENT = "productionTick";

/** The LOC total's flash when a tick lands, ms (TickBar.css). */
export const TICK_FLASH_MS = 300;

/** The bar shows only while there is passive production to tick. */
export function tickBarVisible(tickKey, locPerSecond) {
  return tickKey > 0 && locPerSecond > 0;
}
