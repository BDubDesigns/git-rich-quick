/**
 * SUBTRACTERALL (prestige, Slice 3).
 *
 * The burst card, in Settings below Sell the Company. It shows the
 * unlock progress (100,000 lifetime LOC, permanent), the Ready state
 * (dose supply, the next dose's exact durations, tolerance recovery
 * progress), the Burst state (remaining time, 3x multiplier, growing
 * liability), and the Withdrawal state (0.25x multiplier, remaining
 * minimum time, liability, and the estimated completion). The
 * Overtime reskin toggle lives here too: a text/framing layer only,
 * the same mechanics framed as Overtime with recovery at a "wellness
 * clinic" instead of rehab.
 *
 * A dose is taken through the reducer (TAKE_SUBTRACTERALL_DOSE),
 * which enforces the unlock, the Ready phase, the remaining supply,
 * and the positive healthy production requirement. The card disables
 * the button when a dose cannot be taken and says why. Taking a
 * dose asks for confirmation every time: the durations change as
 * tolerance grows, and a dose borrows future production, so the
 * cost is worth one more look. The confirmation text is the design's
 * first-use warning, with the current tier's durations filled in.
 *
 * Copy rules: no em dashes anywhere in player-facing copy, and every
 * content box is the shared Panel component. Body copy is text-sm
 * (14px, the Farm tab standard) for phone-size legibility.
 */

import { useState } from "react";
import { useGameContext } from "../context/useGameContext.js";
import {
  calculateLOCPerSecond,
  getBaseLocPerSecond,
} from "../context/gameLogic.js";
import * as shared from "../../../shared/game-balance.js";
import { formatNumber } from "../../../shared/formatNumber.js";
import { Panel } from "./Panel.jsx";
import { Button } from "./Button.jsx";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";

/** The design's card description, verbatim. */
const CARD_DESCRIPTION =
  "Management has discovered a way to borrow tomorrow's productivity at tomorrow's interest rate.";

export function SubtracterallCard() {
  const { state, dispatch } = useGameContext();
  // Progress bar toggles (issue #128): the unlock bar here follows the
  // "unlock" toggle, like every other unlock progress bar.
  const showUnlockBar = useProgressBarEnabled("unlock");
  // "overview" | "confirm": local UI steps, not saved. The confirm
  // step shows the tier-specific warning before a dose is taken.
  const [confirming, setConfirming] = useState(false);

  const sub = state.subtracterall ?? shared.zeroSubtracterallState();
  const framing = shared.subtracterallFraming(state.overtimeReskin ?? false);
  const lifetimeLoc = state.totalLinesOfCode ?? 0;
  const unlocked = shared.subtracterallUnlocked(lifetimeLoc);
  // The healthy rate (permanent bonuses, no star buffs) is the
  // "positive healthy production" the dose requirement reads. The
  // withdrawal estimate reads the LIVE rate (star buffs included):
  // that is the rate the tick actually repays liability at, so the
  // estimate and the reality can never disagree during a star.
  const healthyRate = getBaseLocPerSecond(state);
  const liveRate = calculateLOCPerSecond(state);
  const canDose =
    unlocked && shared.subtracterallCanDose(sub, healthyRate);
  const dosesLeft =
    shared.SUBTRACTERALL_CONFIG.maxDosesPerCompany - (sub.dosesUsed ?? 0);
  const tier = Math.min(2, Math.max(0, Math.floor(sub.tolerance ?? 0)));
  const tierDurations = shared.SUBTRACTERALL_CONFIG.tiers[tier];
  const withdrawalEstimate =
    shared.subtracterallWithdrawalEstimateSeconds(sub, liveRate);

  // Why a dose cannot be taken right now (the button is disabled and
  // this line says why). Empty when a dose can be taken.
  let doseBlockedReason = "";
  if (sub.phase !== "ready") {
    doseBlockedReason =
      "A dose cannot be taken during an active phase. The current phase must end first.";
  } else if (dosesLeft <= 0) {
    doseBlockedReason =
      "No doses left in this company. Sell the company for three fresh doses.";
  } else if (healthyRate <= 0) {
    doseBlockedReason =
      "Taking a dose requires at least one employee with positive production.";
  }

  function handleTakeDose() {
    dispatch({ type: "TAKE_SUBTRACTERALL_DOSE" });
    setConfirming(false);
  }

  return (
    <Panel as="section" className="flex flex-col gap-2 p-3">
      <h3 className="m-0 text-sm text-[#cccccc]">{framing.name}</h3>
      <p className="m-0 text-sm">{CARD_DESCRIPTION}</p>

      {!unlocked ? (
        <>
          <p className="m-0 text-sm">
            Unlocks at {formatNumber(shared.SUBTRACTERALL_CONFIG.unlockLifetimeLoc)} lifetime LOC. You have{" "}
            {formatNumber(lifetimeLoc)}.
          </p>
          {showUnlockBar && (
            <div
              className="h-4 bg-gray-700 rounded relative"
              role="progressbar"
              aria-valuenow={Math.round(
                Math.min(
                  100,
                  (lifetimeLoc / shared.SUBTRACTERALL_CONFIG.unlockLifetimeLoc) * 100
                )
              )}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="Progress to SUBTRACTERALL unlock"
            >
              <div
                className="h-4 bg-green-500 rounded"
                style={{
                  width: `${Math.min(100, (lifetimeLoc / shared.SUBTRACTERALL_CONFIG.unlockLifetimeLoc) * 100)}%`,
                }}
              />
            </div>
          )}
        </>
      ) : sub.phase === "burst" ? (
        <>
          <p className="m-0 text-sm">
            {framing.burstLabel}: 3x LOC for{" "}
            {shared.formatEstimateDuration(sub.phaseRemainingSeconds ?? 0)}{" "}
            more. Liability so far: {formatNumber(sub.liability ?? 0)} LOC.
          </p>
          <p className="m-0 text-sm">
            Every extra LOC adds 1.5 LOC of future lost production. The
            withdrawal that follows lasts at least{" "}
            {shared.formatEstimateDuration(
              shared.SUBTRACTERALL_CONFIG.tiers[sub.activeTier ?? 0]
                .minWithdrawalSeconds
            )}
            .
          </p>
        </>
      ) : sub.phase === "withdrawal" ? (
        <>
          <p className="m-0 text-sm">{framing.withdrawalDescription}</p>
          <p className="m-0 text-sm">
            {framing.withdrawalLabel}: 0.25x LOC. Minimum time remaining:{" "}
            {shared.formatEstimateDuration(sub.phaseRemainingSeconds ?? 0)}
            . Liability: {formatNumber(sub.liability ?? 0)} LOC.
          </p>
          <p className="m-0 text-sm">
            {withdrawalEstimate === null
              ? "Completion depends on future production."
              : `Estimated completion in ${shared.formatEstimateDuration(Math.ceil(withdrawalEstimate))} at current employee production, excluding future clicks and star changes.`}
          </p>
          <p className="m-0 text-sm">
            The company changes hands. The founder&apos;s obligations do
            not. Selling does not end this phase.
          </p>
        </>
      ) : confirming ? (
        <>
          <p className="m-0 text-sm">
            3x LOC for {tierDurations.burstSeconds} seconds. Then 0.25x
            LOC for at least {tierDurations.minWithdrawalSeconds / 60}{" "}
            minutes. Every extra LOC adds 1.5 LOC of future lost
            production. Withdrawal survives selling.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleTakeDose}>
              {framing.doseAction}
            </Button>
            <Button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-sm">
            Doses left in this company: {dosesLeft} of{" "}
            {shared.SUBTRACTERALL_CONFIG.maxDosesPerCompany}. Next dose:
            3x LOC for{" "}
            {shared.formatEstimateDuration(tierDurations.burstSeconds)},
            then 0.25x LOC for at least{" "}
            {shared.formatEstimateDuration(
              tierDurations.minWithdrawalSeconds
            )}
            .
          </p>
          {(sub.tolerance ?? 0) > 0 && (
            <p className="m-0 text-sm">
              {framing.recoveryLabel}:{" "}
              {shared.formatEstimateDuration(sub.recoverySeconds ?? 0)} of{" "}
              {shared.formatEstimateDuration(
                shared.SUBTRACTERALL_CONFIG.recoverySecondsPerTolerance
              )}{" "}
              healthy production to drop one tolerance tier (currently
              tier {sub.tolerance}).
            </p>
          )}
          <div>
            <Button
              type="button"
              disabled={!canDose}
              onClick={() => setConfirming(true)}
            >
              {framing.doseAction}
            </Button>
          </div>
          {doseBlockedReason && (
            <p className="m-0 text-sm">{doseBlockedReason}</p>
          )}
        </>
      )}

      <label className="m-0 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.overtimeReskin ?? false}
          onChange={(event) =>
            dispatch({
              type: "SET_OVERTIME_RESKIN",
              payload: { enabled: event.target.checked },
            })
          }
        />
        Overtime reskin: frame this as overtime and a wellness clinic
        visit instead of {shared.SUBTRACTERALL_FRAMING.subtracterall.name}.
        Same mechanics.
      </label>
    </Panel>
  );
}
