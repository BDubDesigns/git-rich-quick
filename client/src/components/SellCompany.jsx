/**
 * Sell the Company (prestige, Slice 1).
 *
 * The prestige panel, in Settings above the Danger Zone. It shows the
 * Equity meter (lifetime LOC against the next threshold), the
 * current-rate estimate to the next Equity, and the sale preview:
 * Equity gained, unspent Equity afterward, the Founder multiplier
 * before/after, everything the sale resets, and everything it keeps.
 * Confirming calls the save engine's sellCompany, which claims the
 * Equity and atomically resets the company on the server and restores
 * the post-sale state locally; the sale opens the post-sale
 * intermission, and the permanent store (PermanentStore) renders in
 * this panel's place until the player starts the next company. The
 * closing screen is this component's local step, from the preview
 * snapshot taken at confirm time, and it shows only when the sale
 * was already applied (a retried sale whose intermission is already
 * gone): a fresh sale lands in the store, not here. A reload after
 * the sale lands back in the store with the Equity already claimed
 * (the sale is idempotent by saleId on the server), because the
 * intermission is saved state.
 *
 * Copy rules: no em dashes anywhere in player-facing copy, and every
 * content box is the shared Panel component. Body copy is text-sm
 * (14px, the Farm tab standard) for phone-size legibility.
 */

import { useState } from "react";
import { useGameContext } from "../context/useGameContext.js";
import {
  flatEmployeeCounts,
  flatOpenSourceLevels,
  getBaseLocPerSecond,
} from "../context/gameLogic.js";
import * as shared from "../../../shared/game-balance.js";
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { Panel } from "./Panel.jsx";
import { Button } from "./Button.jsx";
import { PermanentStore } from "./PermanentStore.jsx";
import { measureEquityStrip, startExitBeat } from "../utils/exitBeat.js";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";

/** "1.40x" for a Founder multiplier. */
function formatMultiplier(value) {
  return `${value.toFixed(2)}x`;
}

/** "12 Interns" for an employee count, pluralized. */
function employeeLine(type, count) {
  const name = shared.EMPLOYEE_DISPLAY_NAMES[type] ?? type;
  return `${count} ${name}${count === 1 ? "" : "s"}`;
}

export function SellCompany() {
  const { state, sellCompany, savePlayerId } = useGameContext();
  // Progress bar toggles (issue #128): the "equityMeter" toggle hides
  // the bar only; the numbers above and below it stay.
  const showMeter = useProgressBarEnabled("equityMeter");
  // "overview" | "confirm" | "complete": local UI steps, not saved.
  const [step, setStep] = useState("overview");
  const [saleBusy, setSaleBusy] = useState(false);
  const [saleError, setSaleError] = useState(null);
  // The preview snapshot taken when the player opens the confirm step.
  // The closing screen reads it, not the live state (which the sale
  // has already reset by then).
  const [preview, setPreview] = useState(null);

  const lifetimeLoc = state.totalLinesOfCode ?? 0;
  const lifetimeEquityEarned = state.lifetimeEquityEarned ?? 0;
  const equitySpent = state.equitySpent ?? 0;
  const claimable = shared.claimableEquity(lifetimeLoc, lifetimeEquityEarned);
  const spendable = shared.availableEquity(
    lifetimeEquityEarned,
    equitySpent
  );
  const founderBefore = shared.founderMultiplier(lifetimeEquityEarned);
  const founderAfter = shared.founderMultiplier(
    lifetimeEquityEarned + claimable
  );
  const healthyRate = getBaseLocPerSecond(state);
  const companyLoc = shared.companyLocEarned(state);

  // The meter spans the current bracket: entitlement n means the bar
  // runs from 10M x n^3 through 10M x (n+1)^3 lifetime LOC. It
  // rolls over when an Equity is earned, while the claimable count
  // stays visible next to it. A filled bar is progress, never a
  // deadline. Shared with the header Equity strip (issue #131), so
  // the two bars can never disagree.
  const estimate = shared.equityProgress(lifetimeLoc, healthyRate);
  const bracketPct = estimate.fraction * 100;

  // Founder boost, honestly (issue #131): read off founderMultiplier
  // itself, the multiplier production applies to clicks and employee
  // production. Based on Lifetime Equity EARNED, even if spent.
  const boostNow = shared.founderBoostPercent(lifetimeEquityEarned);
  const boostNext = shared.founderNextEquityBoostPercent(lifetimeEquityEarned);
  const boostAfterSale = shared.founderBoostPercent(
    lifetimeEquityEarned + claimable
  );
  const pastLinear = lifetimeEquityEarned >= shared.FOUNDER_LINEAR_EQUITY_CAP;
  const achievementMult = shared.achievementLocMultiplier(state.achievements);
  const totalPermanent = shared.buffedLocMultiplier(state);

  const employeeCounts = flatEmployeeCounts(state);
  const totalEmployees = shared.totalEmployees(employeeCounts);
  const ownedEmployeeLines = shared.EMPLOYEE_TYPES.filter(
    (type) => (employeeCounts[type] ?? 0) > 0
  ).map((type) => employeeLine(type, employeeCounts[type]));
  const openSourceLevels = flatOpenSourceLevels(state);
  const ownedProjectLines = shared.OPEN_SOURCE_IDS.filter(
    (id) => (openSourceLevels[id] ?? 0) > 0
  ).map(
    (id) =>
      `${shared.OPEN_SOURCE_DISPLAY_NAMES[id] ?? id} (level ${openSourceLevels[id]})`
  );
  const totalProjectLevels = Object.values(openSourceLevels).reduce(
    (sum, level) => sum + (level ?? 0),
    0
  );
  const farm = state.farm ?? shared.emptyFarmState();
  const farmLlamas = shared.farmLlamaCount(farm.stalls ?? []);
  const activeStarCount = (state.activeStarEffects ?? []).length;
  const assignedManagers = shared.releaseManagerAssignedCount(
    state.releaseManagerAssignments ?? {}
  );
  // Permanent store (Slice 2): the owned ranks, as a one-line
  // summary for the overview ("Keyboard rank 2, Client Network rank
  // 1"). Empty when nothing is owned.
  const ownedStoreLines = shared.PRESTIGE_STORE_IDS.filter(
    (storeId) => ((state.permanentStoreRanks ?? {})[storeId] ?? 0) > 0
  ).map((storeId) => {
    const rank = (state.permanentStoreRanks ?? {})[storeId];
    // Funding Rounds (issue #170) reads as the round, not a rank number.
    return storeId === "fundingRounds"
      ? `${shared.PRESTIGE_STORE_CONFIG[storeId].displayName}: ${shared.fundingRoundName(rank)}`
      : `${shared.PRESTIGE_STORE_CONFIG[storeId].displayName} rank ${rank}`;
  });

  // SUBTRACTERALL framing (issue #150): the reskin's words, never
  // "dose" in the Overtime framing.
  const subFraming = shared.subtracterallFraming(state.overtimeReskin ?? false);

  function openConfirm() {
    const sub = shared.normalizeSubtracterallState(state.subtracterall);
    setPreview({
      gainedEquity: claimable,
      unspentAfter: spendable + claimable,
      founderBefore,
      founderAfter,
      lifetimeLoc,
      moneyLost: state.money ?? 0,
      locLost: state.linesOfCode ?? 0,
      totalEmployees,
      ownedEmployeeLines,
      totalProjectLevels,
      ownedProjectLines,
      activeStarCount,
      assignedManagers,
      farmOwned: farm.owned ?? false,
      farmLlamas,
      cosmeticsKept: (state.unlockedCosmetics ?? []).length,
      emailsKept: (state.emails ?? []).length,
      // Issue #237: discovered llama types survive the sale.
      discoveredTypesKept: (farm.unlockedTypes ?? []).length,
      // SUBTRACTERALL (issue #256): whether there was anything for the
      // sale to wipe (a phase in progress or uses spent), read at
      // confirm time so the closing screen reads the snapshot, not the
      // reset live state.
      subWiped: sub.phase !== "ready" || (sub.uses ?? 0) > 0,
    });
    setSaleError(null);
    setStep("confirm");
  }

  async function handleSellConfirm() {
    if (saleBusy) return;
    setSaleBusy(true);
    setSaleError(null);
    // The exit beat (issue #215): where the Equity strip is and the
    // spendable Equity, BEFORE the sale (its restore swaps the game for
    // the store screen).
    const beatFrom = { stripRect: measureEquityStrip(), fromEquity: spendable };
    try {
      const result = await sellCompany();
      if (result.ok) {
        // A successful sale response: the merge beat plays over the
        // store screen (a presentation layer; the sale is done).
        startExitBeat(beatFrom);
        // The engine restored the post-sale state; the closing screen
        // reads the preview snapshot, not the reset live state.
        setStep("complete");
      } else if (result.error === "SALE") {
        setSaleError(
          "No new Equity to claim yet. Keep building and try again."
        );
      } else if (result.error === "WIPE") {
        // Funding Rounds save wipe (issue #170): the server reset an
        // old-schema save and the engine already loaded the fresh one.
        setSaleError(
          "This save was reset for the Funding Rounds update. A fresh company is ready for you."
        );
      } else if (result.error === "network") {
        setSaleError(
          "Could not reach the save server. Your company is untouched. Try again."
        );
      } else if (result.error === "not-initialized") {
        setSaleError(
          "No save loaded yet. Play a little first, then sell."
        );
      } else {
        setSaleError(
          `Sale failed (${result.error ?? "unknown"}). Your company is untouched. Try again.`
        );
      }
    } catch (err) {
      setSaleError(
        `Sale failed (${String(err?.message ?? err)}). Your company is untouched. Try again.`
      );
    } finally {
      setSaleBusy(false);
    }
  }

  // Permanent store (Slice 2): the post-sale intermission is saved
  // state, not a local step — when it is open, the store renders
  // instead of this panel, so a reload mid-intermission lands back
  // in the store with the same frozen quote and the same ranks. The
  // intermission clears only when the player starts the next company
  // (or the server already completed it, in which case the "complete"
  // step below is the closing screen for the retried sale).
  if (state.prestigeIntermission) {
    return <PermanentStore />;
  }

  return (
    <Panel as="section" className="flex flex-col gap-2 p-3">
      <h3 className="m-0 text-sm text-[#cccccc]">Sell the Company</h3>
      <p className="m-0 text-sm">
        The buyer has reviewed your total lines of code and declined to
        review any of them.
      </p>

      {/* Founder boost per Equity (issue #131): what one Equity is
          worth, what the player's Equity is worth now, and what the
          next one adds, from the real curve. */}
      <div className="flex flex-col gap-1 text-sm">
        <p className="m-0">
          <strong>
            Each Equity: {shared.formatBoostPercent(
              shared.FOUNDER_BOOST_PER_EQUITY * 100
            )}{" "}
            to all LOC
          </strong>{" "}
          (clicks and employees), up to{" "}
          {shared.FOUNDER_LINEAR_EQUITY_CAP} Equity. Past{" "}
          {shared.FOUNDER_LINEAR_EQUITY_CAP}, each one adds less:{" "}
          {[50, 100, 200]
            .map(
              (p) => `${formatMultiplier(shared.founderMultiplier(p))} at ${p}`
            )
            .join(", ")}
          .
        </p>
        <p className="m-0">
          <strong>
            Your {lifetimeEquityEarned} Equity:{" "}
            {shared.formatBoostPercent(boostNow)} (
            {formatMultiplier(founderBefore)})
          </strong>
          . Counts every Equity you have earned, even the ones you spent.
        </p>
        <p className="m-0">
          Your next Equity adds {shared.formatBoostPercent(boostNext)}
          {pastLinear ? " (diminishing returns past 50)" : ""}.
          {claimable > 0
            ? ` Selling now (+${claimable} Equity) takes you to ${shared.formatBoostPercent(boostAfterSale)} (${formatMultiplier(founderAfter)}).`
            : ""}
        </p>
        <p className="m-0 text-gray-400">
          With your achievement buff ({formatMultiplier(achievementMult)}),
          every LOC you earn is multiplied by{" "}
          {formatMultiplier(totalPermanent)} in total.
        </p>
      </div>

      {step === "complete" && preview ? (
        <>
          <p className="m-0 text-sm">
            The acquisition is complete. Your team has been synergized.
            Your laptop remains personally owned.
          </p>
          <p className="m-0 text-sm">
            Same founder. New logo. Completely unrelated technical debt.
          </p>
          <p className="m-0 text-sm">
            You sold the company for +{preview.gainedEquity} Equity. Your
            Founder multiplier is now{" "}
            {formatMultiplier(preview.founderAfter)} (was{" "}
            {formatMultiplier(preview.founderBefore)}). Unspent Equity:{" "}
            {preview.unspentAfter}.
          </p>
          {preview.subWiped && (
            <p className="m-0 text-sm">{subFraming.saleNote}</p>
          )}
          <div>
            <Button type="button" onClick={() => setStep("overview")}>
              Keep Building
            </Button>
          </div>
        </>
      ) : step === "confirm" && preview ? (
        <>
          <p className="m-0 text-sm">
            Sell now: +{preview.gainedEquity} Equity. Unspent Equity
            afterward: {preview.unspentAfter}. Founder multiplier:{" "}
            {formatMultiplier(preview.founderBefore)} to{" "}
            {formatMultiplier(preview.founderAfter)}.
          </p>
          <p className="m-0 text-sm">
            Lost in the sale: {formatMoney(preview.moneyLost)},{" "}
            {formatNumber(preview.locLost)} LOC,{" "}
            {preview.totalEmployees} employees
            {preview.ownedEmployeeLines.length > 0
              ? ` (${preview.ownedEmployeeLines.join(", ")})`
              : ""}
            , {preview.totalProjectLevels} run upgrade levels
            {preview.ownedProjectLines.length > 0
              ? ` (${preview.ownedProjectLines.join(", ")})`
              : ""}
            {preview.assignedManagers > 0
              ? `, including ${preview.assignedManagers} assigned Release Manager${preview.assignedManagers === 1 ? "" : "s"}`
              : ""}
            {preview.activeStarCount > 0
              ? `, ${preview.activeStarCount} active star effect${preview.activeStarCount === 1 ? "" : "s"}`
              : ", no active star effects"}
            {preview.farmOwned
              ? `, and the farm with ${preview.farmLlamas} llama${preview.farmLlamas === 1 ? "" : "s"}`
              : ", and the farm (not owned)"}
            .
          </p>
          <p className="m-0 text-sm">
            Kept: {formatNumber(preview.lifetimeLoc)} lifetime LOC,{" "}
            {preview.cosmeticsKept} cosmetic unlock
            {preview.cosmeticsKept === 1 ? "" : "s"},{" "}
            {preview.emailsKept} email{preview.emailsKept === 1 ? "" : "s"}
            {preview.discoveredTypesKept > 0
              ? `, ${preview.discoveredTypesKept} discovered llama type${preview.discoveredTypesKept === 1 ? "" : "s"}`
              : ""}
            , and your preferences.
          </p>
          <p className="m-0 text-sm">
            The company changes hands. The founder&apos;s obligations do
            not.{" "}
            {preview.subWiped
              ? subFraming.saleNote
              : `${subFraming.name}: no active phase. The new company starts the count again at zero.`}{" "}
            After the sale, the permanent store opens: spend Equity on
            permanent upgrades before starting the next company.
          </p>
          {saleError && (
            <p className="m-0 text-sm text-[#f48771]">{saleError}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={saleBusy}
              onClick={handleSellConfirm}
              className="game-button--danger"
            >
              {saleBusy ? "Selling…" : "Sell and Start Again"}
            </Button>
            <Button
              type="button"
              disabled={saleBusy}
              onClick={() => setStep("overview")}
            >
              Keep Building
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-sm">
            Next Equity ({estimate.nextEquity}): {formatNumber(lifetimeLoc)} /{" "}
            {formatNumber(estimate.nextThresholdLoc)} lifetime LOC
          </p>
          {showMeter && (
            <div
              className="h-4 bg-gray-700 rounded relative"
              role="progressbar"
              aria-valuenow={Math.round(bracketPct)}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="Progress to next Equity"
            >
              <div
                className="h-4 bg-green-500 rounded"
                style={{ width: `${bracketPct}%` }}
              />
            </div>
          )}
          <p className="m-0 text-sm">
            Sell now: +{claimable} Equity
            {estimate.seconds !== null
              ? ` · About ${shared.formatEstimateDuration(estimate.seconds)} to the next Equity at your current rate`
              : " · Requires production to reach the next Equity"}
          </p>
          <p className="m-0 text-sm">
            Current-rate estimate, excluding future clicks, stars and
            rebuilds.
          </p>
          <p className="m-0 text-sm">
            Lifetime LOC: {formatNumber(lifetimeLoc)} · Company LOC earned:{" "}
            {formatNumber(companyLoc)} · Equity claimed:{" "}
            {lifetimeEquityEarned} · Equity spendable: {spendable} · Sales:{" "}
            {state.saleCount ?? 0} · Founder multiplier:{" "}
            {formatMultiplier(founderBefore)}
          </p>
          {ownedStoreLines.length > 0 && (
            <p className="m-0 text-sm">
              Permanent store: {ownedStoreLines.join(", ")}.
            </p>
          )}
          <div>
            <Button
              type="button"
              disabled={claimable < 1 || saleBusy || !savePlayerId}
              onClick={openConfirm}
            >
              {claimable < 1
                ? "No Equity to claim yet"
                : "Sell the Company"}
            </Button>
          </div>
          {!savePlayerId && (
            <p className="m-0 text-sm">
              No save loaded yet. Play a little first, then sell.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
