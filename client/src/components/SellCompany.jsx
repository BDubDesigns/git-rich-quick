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
 * the post-sale state locally; the closing screen is this component's
 * local step, from the preview snapshot taken at confirm time.
 *
 * Slice 1 has no permanent store, so the sale goes straight from the
 * confirm step to starting the next company: there is no starting
 * grant to double-apply, and a reload after the sale lands on the new
 * company with the Equity already claimed (the sale is idempotent by
 * saleId on the server). The closing screen is transient UI, not a
 * saved intermission.
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
  const estimate = shared.nextEquityEstimate(lifetimeLoc, healthyRate);
  const companyLoc = shared.companyLocEarned(state);

  // The meter spans the current bracket: entitlement n means the bar
  // runs from n^2 million through (n+1)^2 million lifetime LOC. It
  // rolls over when an Equity is earned, while the claimable count
  // stays visible next to it. A filled bar is progress, never a
  // deadline.
  const bracketLow = shared.equityThresholdLoc(estimate.entitled);
  const bracketSpan = Math.max(
    1,
    estimate.nextThresholdLoc - bracketLow
  );
  const bracketPct = Math.min(
    100,
    Math.max(0, ((lifetimeLoc - bracketLow) / bracketSpan) * 100)
  );

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

  function openConfirm() {
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
    });
    setSaleError(null);
    setStep("confirm");
  }

  async function handleSellConfirm() {
    if (saleBusy) return;
    setSaleBusy(true);
    setSaleError(null);
    try {
      const result = await sellCompany();
      if (result.ok) {
        // The engine restored the post-sale state; the closing screen
        // reads the preview snapshot, not the reset live state.
        setStep("complete");
      } else if (result.error === "SALE") {
        setSaleError(
          "No new Equity to claim yet. Keep building and try again."
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

  return (
    <Panel as="section" className="flex flex-col gap-2 p-3">
      <h3 className="m-0 text-sm text-[#cccccc]">Sell the Company</h3>
      <p className="m-0 text-sm">
        The buyer has reviewed your total lines of code and declined to
        review any of them.
      </p>

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
            , and your preferences.
          </p>
          <p className="m-0 text-sm">
            SUBTRACTERALL: no active phase. Starting cash from permanent
            upgrades: {formatMoney(0)}. The permanent store is not open
            yet.
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
            Next Equity: {formatNumber(lifetimeLoc)} /{" "}
            {formatNumber(estimate.nextThresholdLoc)} lifetime LOC
          </p>
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
