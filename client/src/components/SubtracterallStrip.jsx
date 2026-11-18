/**
 * SUBTRACTERALL phase strip (prestige, Slice 3; reworked in issue #150).
 *
 * A thin strip under the star area in the Header, shown ONLY during
 * an active Burst or Withdrawal (Crunch or Burnout in the Overtime
 * reskin), so the player sees the phase on any tab: the multiplier
 * and the time left. Calm neutral styling with explicit text: the
 * phase is never conveyed by color alone. The full detail lives in
 * the SUBTRACTERALL card in Settings.
 *
 * Copy rules: no em dashes anywhere in player-facing copy.
 */

import { useGameContext } from "../context/useGameContext.js";
import * as shared from "../../../shared/game-balance.js";

export function SubtracterallStrip() {
  const { state } = useGameContext();
  const sub = shared.normalizeSubtracterallState(state.subtracterall);
  if (sub.phase !== "burst" && sub.phase !== "withdrawal") return null;
  const framing = shared.subtracterallFraming(state.overtimeReskin ?? false);
  const label =
    sub.phase === "burst" ? framing.burstLabel : framing.withdrawalLabel;
  const multiplier = shared.formatSubtracterallMultiplier(
    shared.subtracterallPhaseMultiplier(sub)
  );
  const remaining = shared.formatSubtracterallSeconds(
    Math.ceil(sub.phaseRemainingSeconds ?? 0)
  );
  return (
    <div className="px-2">
      <div className="flex items-center justify-center gap-2 px-4 py-1 border rounded-2xl m-2 bg-[#181818] border-[var(--border-color)] text-sm">
        <span>
          {framing.name}: {label}, {multiplier} LOC, {remaining} left
        </span>
      </div>
    </div>
  );
}
