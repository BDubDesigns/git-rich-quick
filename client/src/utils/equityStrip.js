/**
 * The header Equity strip's framing (issue #190), as a pure function of
 * the shared helpers' outputs, so the server test suite pins it without
 * React. Brandon, Nov 19: "It's hard to see how many new points I'm
 * gonna earn. It shows my lifetime in the bar."
 *
 * The strip leads with the sale gain: claimableEquity, the same number
 * the Sell the Company panel shows as "Equity gained". The bar fill and
 * the distance to the next point are equityProgress, the same function
 * the Sell meter reads. No Equity math lives here, so the strip and the
 * Sell panel can never disagree.
 *
 * Copy rules: no em dashes or en dashes in player-facing text. The
 * visible text fits the strip's one line at phone width; the full
 * sentence is the aria-label and title.
 */
import {
  claimableEquity,
  equityProgress,
  formatEstimateDuration,
} from "../../../shared/game-balance.js";
import { formatNumber } from "../../../shared/formatNumber.js";

/**
 * { claimable, fraction, pct, text, label } for the strip.
 * `healthyLocPerSec` is the buffed healthy rate (getBaseLocPerSecond),
 * the rate both bars have always used.
 */
export function equityStripModel(lifetimeLoc, lifetimeEquityEarned, healthyLocPerSec) {
  const claimable = claimableEquity(lifetimeLoc, lifetimeEquityEarned);
  const progress = equityProgress(lifetimeLoc, healthyLocPerSec);
  const pct = Math.floor(progress.fraction * 100);
  const loc = `${formatNumber(progress.remainingLoc)} LOC`;
  // Short on the strip's one line; the label carries the full sentence.
  const time =
    progress.seconds === null
      ? "no LOC/s"
      : formatEstimateDuration(progress.seconds);
  const timeSentence =
    progress.seconds === null
      ? "it needs production to arrive"
      : `about ${formatEstimateDuration(progress.seconds)} at your current rate`;
  const tap = "Tap to open Sell the Company in Settings.";

  if (claimable >= 1) {
    return {
      claimable,
      fraction: progress.fraction,
      pct,
      text: `+${claimable} Equity if you sell now · next ${loc}, ${time}`,
      label:
        `Selling now earns ${claimable} Equity. ` +
        `The next point is ${pct}% of the way there: ${loc} to go, ${timeSentence}. ${tap}`,
    };
  }
  return {
    claimable,
    fraction: progress.fraction,
    pct,
    text: `Next +1 Equity: ${pct}% · ${loc}, ${time}`,
    label:
      `Selling now earns no Equity yet. ` +
      `The first point of this run is ${pct}% of the way there: ${loc} to go, ${timeSentence}. ${tap}`,
  };
}
