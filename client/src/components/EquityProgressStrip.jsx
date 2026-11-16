/**
 * Equity progress strip (issue #131).
 *
 * A thin bar under the star bars in the Header, alongside the other
 * progress bars, so progress to the next Equity point is visible on
 * every tab: lifetime LOC across the current Equity bracket (the next
 * Equity lands at 1,000,000 x (n + 1)^2 lifetime LOC) and the time
 * left at the current healthy LOC/s (the buffed rate, temporary star
 * and SUBTRACTERALL multipliers out). Tapping it opens Settings, where
 * Sell the Company lives.
 *
 * Shown once the player can see the goal: they have Equity, or their
 * lifetime LOC has reached the unlock visibility threshold (10%) of the
 * first Equity, the same rule every locked card uses. The math is the
 * shared equityProgress, the same function the Sell the Company meter
 * reads, so the two bars can never disagree.
 *
 * Copy rules: no em dashes anywhere in player-facing copy.
 */

import { useGameContext } from "../context/useGameContext.js";
import { getBaseLocPerSecond } from "../context/gameLogic.js";
import * as shared from "../../../shared/game-balance.js";
import { formatNumber } from "../../../shared/formatNumber.js";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";

export function EquityProgressStrip() {
  const { state, dispatch } = useGameContext();
  // Progress bar toggles (issue #128): the "equityStrip" toggle.
  const enabled = useProgressBarEnabled("equityStrip");
  if (!enabled) return null;
  if (
    !shared.equityGoalVisible(
      state.totalLinesOfCode ?? 0,
      state.lifetimeEquityEarned ?? 0
    )
  ) {
    return null;
  }
  const progress = shared.equityProgress(
    state.totalLinesOfCode ?? 0,
    getBaseLocPerSecond(state)
  );
  const pct = Math.floor(progress.fraction * 100);
  const timeText =
    progress.seconds === null
      ? "needs production"
      : `${shared.formatEstimateDuration(progress.seconds)} left`;
  const label = `Equity ${progress.nextEquity}: ${pct}%, ${formatNumber(
    progress.remainingLoc
  )} LOC to go, ${timeText} at your current rate. Tap to open Sell the Company in Settings.`;

  return (
    <div className="px-2">
      <div
        className="progress-strip"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label}
        title={label}
        onClick={() =>
          dispatch({ type: "SET_ACTIVE_TAB", payload: { tab: "settings" } })
        }
      >
        <div
          className="progress-strip-fill progress-strip-fill--equity"
          style={{ width: `${progress.fraction * 100}%` }}
        />
        <span className="progress-strip-text">
          Equity {progress.nextEquity}: {pct}% · {timeText}
        </span>
      </div>
    </div>
  );
}
