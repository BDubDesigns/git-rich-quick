/**
 * SUBTRACTERALL phase strip (prestige, Slice 3).
 *
 * A thin strip under the star area in the Header, shown ONLY during
 * an active Burst or Withdrawal, so the player sees the phase on any
 * tab. Burst: the remaining time, the 3x multiplier, and the growing
 * liability. Withdrawal: the 0.25x multiplier, the remaining minimum
 * time, and the liability. Calm neutral styling with explicit text:
 * the phase is never conveyed by color alone. The full detail lives
 * in the SUBTRACTERALL card in Settings.
 *
 * Copy rules: no em dashes anywhere in player-facing copy.
 */

import { useGameContext } from "../context/useGameContext.js";
import * as shared from "../../../shared/game-balance.js";
import { formatNumber } from "../../../shared/formatNumber.js";

export function SubtracterallStrip() {
  const { state } = useGameContext();
  const sub = state.subtracterall ?? shared.zeroSubtracterallState();
  if (sub.phase !== "burst" && sub.phase !== "withdrawal") return null;
  const framing = shared.subtracterallFraming(state.overtimeReskin ?? false);
  const remaining = shared.formatEstimateDuration(
    sub.phaseRemainingSeconds ?? 0
  );
  const liability = formatNumber(sub.liability ?? 0);
  return (
    <div className="px-2">
      <div className="flex items-center justify-center gap-2 px-4 py-1 border rounded-2xl m-2 bg-[#181818] border-[var(--border-color)] text-sm">
        {sub.phase === "burst" ? (
          <span>
            {framing.name} {framing.burstLabel}: 3x LOC, {remaining} left,
            liability {liability} LOC
          </span>
        ) : (
          <span>
            {framing.name} {framing.withdrawalLabel}: 0.25x LOC,{" "}
            {remaining} minimum left, liability {liability} LOC
          </span>
        )}
      </div>
    </div>
  );
}
