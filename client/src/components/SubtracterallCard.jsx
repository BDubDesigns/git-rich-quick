/**
 * SUBTRACTERALL (prestige, Slice 3; reworked in issue #150).
 *
 * The burst card, in Settings below Sell the Company. It explains the
 * tradeoff before the player uses it: the use count this company, the
 * next burst (duration at 3x), the next withdrawal (duration and
 * multiplier), what the use after that looks like, and a plain note
 * that each use makes the next burst shorter and the next crash
 * longer and harsher. During a phase it shows what is left and what
 * comes next. The unlock progress (100,000 lifetime LOC, permanent)
 * shows until it is unlocked.
 *
 * The Overtime reskin toggle lives here too: a text/framing layer
 * only, the same mechanics framed as mandated overtime and burnout.
 * The Overtime framing never says "dose".
 *
 * Activation goes through the reducer (ACTIVATE_SUBTRACTERALL), which
 * enforces the unlock, the Ready phase, and the positive healthy
 * production requirement. There is no use cap. The card disables the
 * button when it cannot be used and says why, and asks for
 * confirmation every time with that use's exact terms.
 *
 * Copy rules: no em dashes anywhere in player-facing copy, and every
 * content box is the shared Panel component. Body copy is text-sm
 * (14px, the Farm tab standard) for phone-size legibility.
 */

import { useState } from "react";
import { useGameContext } from "../context/useGameContext.js";
import { getBaseLocPerSecond } from "../context/gameLogic.js";
import * as shared from "../../../shared/game-balance.js";
import { formatNumber } from "../../../shared/formatNumber.js";
import { Panel } from "./Panel.jsx";
import { Button } from "./Button.jsx";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";

/** The design's card description, verbatim. */
const CARD_DESCRIPTION =
  "Management has discovered a way to borrow tomorrow's productivity at tomorrow's interest rate.";

const seconds = shared.formatSubtracterallSeconds;
const times = shared.formatSubtracterallMultiplier;

/** "3x LOC for 2m 42s, then 0.45x LOC for 3m 36s of withdrawal." */
function termsSentence(terms, framing) {
  return `${times(terms.burstMultiplier)} LOC for ${seconds(terms.burstSeconds)}, then ${times(terms.withdrawalMultiplier)} LOC for ${seconds(terms.withdrawalSeconds)} of ${framing.withdrawalLabel.toLowerCase()}.`;
}

export function SubtracterallCard() {
  const { state, dispatch } = useGameContext();
  // Progress bar toggles (issue #128): the unlock bar here follows the
  // "unlock" toggle, like every other unlock progress bar.
  const showUnlockBar = useProgressBarEnabled("unlock");
  // Local UI step, not saved: the confirm step shows the exact terms
  // of this use before it is activated.
  const [confirming, setConfirming] = useState(false);

  const sub = shared.normalizeSubtracterallState(state.subtracterall);
  const framing = shared.subtracterallFraming(state.overtimeReskin ?? false);
  const lifetimeLoc = state.totalLinesOfCode ?? 0;
  const unlocked = shared.subtracterallUnlocked(lifetimeLoc);
  // The healthy rate (permanent bonuses, no star buffs) is the
  // "positive healthy production" activation requires.
  const healthyRate = getBaseLocPerSecond(state);
  const canActivate =
    unlocked && shared.subtracterallCanActivate(sub, healthyRate);
  const uses = sub.uses ?? 0;
  const next = shared.subtracterallUseTerms(uses + 1);
  const after = shared.subtracterallUseTerms(uses + 2);
  const active = shared.subtracterallUseTerms(sub.activeUse || 1);
  const remaining = seconds(Math.ceil(sub.phaseRemainingSeconds ?? 0));

  // Why it cannot be used right now (the button is disabled and this
  // line says why). Empty when it can be used.
  let blockedReason = "";
  if (sub.phase !== "ready") {
    blockedReason = "The current phase must end first.";
  } else if (healthyRate <= 0) {
    blockedReason = "It needs at least one employee with positive production.";
  }

  function handleActivate() {
    dispatch({ type: "ACTIVATE_SUBTRACTERALL" });
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
              aria-label={`Progress to ${framing.name} unlock`}
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
            {framing.burstLabel}: {times(active.burstMultiplier)} LOC for{" "}
            {remaining} more.
          </p>
          <p className="m-0 text-sm">
            Then {framing.withdrawalLabel.toLowerCase()}:{" "}
            {times(active.withdrawalMultiplier)} LOC for{" "}
            {seconds(active.withdrawalSeconds)}.
          </p>
        </>
      ) : sub.phase === "withdrawal" ? (
        <>
          <p className="m-0 text-sm">{framing.withdrawalDescription}</p>
          <p className="m-0 text-sm">
            {framing.withdrawalLabel}: {times(active.withdrawalMultiplier)}{" "}
            LOC for {remaining} more. Selling the company does not end it.
          </p>
        </>
      ) : confirming ? (
        <>
          <p className="m-0 text-sm">{termsSentence(next, framing)}</p>
          <p className="m-0 text-sm">
            The {framing.withdrawalLabel.toLowerCase()} survives selling the
            company.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleActivate}>
              {framing.action}
            </Button>
            <Button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-sm">
            {framing.usesLabel}: {formatNumber(uses)}.
          </p>
          <p className="m-0 text-sm">
            {framing.nextLabel}: {termsSentence(next, framing)}
          </p>
          <p className="m-0 text-sm">
            The one after that: {termsSentence(after, framing)}
          </p>
          <p className="m-0 text-sm">
            {framing.scalingNote} {framing.resetNote}
          </p>
          <div>
            <Button
              type="button"
              disabled={!canActivate}
              onClick={() => setConfirming(true)}
            >
              {framing.action}
            </Button>
          </div>
          {blockedReason && <p className="m-0 text-sm">{blockedReason}</p>}
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
        Overtime reskin: frame this as mandated overtime and burnout
        instead of {shared.SUBTRACTERALL_FRAMING.subtracterall.name}. Same
        mechanics.
      </label>
    </Panel>
  );
}
