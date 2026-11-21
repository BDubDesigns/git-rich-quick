/**
 * Equity progress strip (issue #131, reframed around the sale gain in
 * issue #190).
 *
 * A thin bar under the star bars in the Header, so the Equity goal is
 * visible on every tab. It leads with what a sale earns right now:
 * "+N Equity if you sell now" (claimableEquity, the Sell the Company
 * panel's "Equity gained"), then the distance to the next point beyond
 * those. With nothing claimable it shows progress toward the first
 * point of this run in the same framing. The bar fill is the current
 * Equity bracket: lifetime LOC from 10,000,000 x n^3 to 10,000,000 x
 * (n + 1)^3 (the cube-root curve since PR #171), with the time left at
 * the current healthy LOC/s (the buffed rate, temporary star and
 * SUBTRACTERALL multipliers out). Tapping it opens Settings, where Sell
 * the Company lives.
 *
 * Shown once the player can see the goal: they have Equity, or their
 * lifetime LOC has reached the unlock visibility threshold (10%) of the
 * first Equity, the same rule every locked card uses. The framing is
 * utils/equityStrip.js, which only reads the shared claimableEquity and
 * equityProgress, the same functions the Sell the Company meter reads,
 * so the two can never disagree.
 *
 * Copy rules: no em dashes anywhere in player-facing copy.
 */

import { useGameContext } from "../context/useGameContext.js";
import { getBaseLocPerSecond } from "../context/gameLogic.js";
import * as shared from "../../../shared/game-balance.js";
import { equityStripModel } from "../utils/equityStrip.js";
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
  // The sale-gain framing (issue #190), from the shared helpers only.
  const strip = equityStripModel(
    state.totalLinesOfCode ?? 0,
    state.lifetimeEquityEarned ?? 0,
    getBaseLocPerSecond(state)
  );

  return (
    <div className="px-2">
      <div
        className="progress-strip"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={strip.pct}
        aria-label={strip.label}
        title={strip.label}
        onClick={() =>
          dispatch({ type: "SET_ACTIVE_TAB", payload: { tab: "settings" } })
        }
      >
        <div
          className="progress-strip-fill progress-strip-fill--equity"
          style={{ width: `${strip.fraction * 100}%` }}
        />
        <span className="progress-strip-text">{strip.text}</span>
      </div>
    </div>
  );
}
