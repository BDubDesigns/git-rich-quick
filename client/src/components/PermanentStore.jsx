/**
 * The permanent store (prestige, Slice 2).
 *
 * Rendered by SellCompany whenever the post-sale intermission is
 * open (state.prestigeIntermission is non-null). Purchases are
 * available ONLY here, after selling and before starting the next
 * company: five upgrade tracks, ranks bought in order, prices are
 * per rank (not cumulative), no prerequisites between tracks. The
 * total cost of every rank is 85 Equity, and Equity prices are
 * fixed — they are never multiplied by LOC/s.
 *
 * The Starting Capital grant is priced from the FROZEN quote stored
 * on the intermission (the sold company's healthy passive LOC/s and
 * best payout per LOC), never from the empty new company: the player
 * can buy or increase the rank during the intermission and the grant
 * uses the same outgoing quote with the rank they end up with. The
 * grant applies once, when the player starts the next company.
 *
 * State-driven: the intermission lives in the save, so a reload
 * mid-intermission lands back here with the same frozen quote and
 * the same ranks. The intermission clears only when the player
 * starts the next company (or the server already completed it).
 *
 * Copy rules: no em dashes anywhere in player-facing copy, and
 * every content box is the shared Panel component. Body copy is
 * text-sm (14px, the Farm tab standard) for phone-size legibility.
 */

import { useState } from "react";
import { useGameContext } from "../context/useGameContext.js";
import * as shared from "../../../shared/game-balance.js";
import { formatMoney } from "../../../shared/formatNumber.js";
import { Panel } from "./Panel.jsx";
import { Button } from "./Button.jsx";

/** The effect line for a track at a given total rank. */
function effectLine(storeId, rank, intermission, money) {
  if (rank < 1) return "Not owned yet.";
  switch (storeId) {
    case "startingCapital": {
      const grant = shared.startingCapitalGrantCents(
        money ?? 0,
        intermission?.frozenHealthyPassiveLocPerSec ?? 0,
        intermission?.frozenBestPayoutPerLocCents ?? 0,
        rank
      );
      return `The next company starts with ${formatMoney(grant)}.`;
    }
    case "keyboard":
      return `+${shared.keyboardClickBonus({ keyboard: rank })} base LOC per click.`;
    case "engineeringHandbook":
      return `+${Math.round((shared.handbookProductionMultiplier({ engineeringHandbook: rank }) - 1) * 100)}% all production.`;
    case "clientNetwork":
      return `+${Math.round((shared.clientNetworkPayoutMultiplier({ clientNetwork: rank }) - 1) * 100)}% freelance cash payouts.`;
    case "companyTemplate":
      return "Favorited projects survive the next sale.";
    default:
      return "";
  }
}

/** The effect the NEXT rank adds, for the buy button's context line. */
function nextRankLine(storeId, nextRank, intermission, money) {
  switch (storeId) {
    case "startingCapital": {
      const grant = shared.startingCapitalGrantCents(
        money ?? 0,
        intermission?.frozenHealthyPassiveLocPerSec ?? 0,
        intermission?.frozenBestPayoutPerLocCents ?? 0,
        nextRank
      );
      return `Rank ${nextRank}: the next company starts with ${formatMoney(grant)}.`;
    }
    case "keyboard":
      return `Rank ${nextRank}: +${shared.keyboardClickBonus({ keyboard: nextRank })} base LOC per click.`;
    case "engineeringHandbook":
      return `Rank ${nextRank}: +${Math.round((shared.handbookProductionMultiplier({ engineeringHandbook: nextRank }) - 1) * 100)}% all production.`;
    case "clientNetwork":
      return `Rank ${nextRank}: +${Math.round((shared.clientNetworkPayoutMultiplier({ clientNetwork: nextRank }) - 1) * 100)}% freelance cash payouts.`;
    case "companyTemplate":
      return "Rank 1: favorited projects survive the next sale.";
    default:
      return "";
  }
}

export function PermanentStore() {
  const { state, buyStoreRank, completeIntermission } = useGameContext();
  const [busy, setBusy] = useState(false);
  const [storeError, setStoreError] = useState(null);

  const intermission = state.prestigeIntermission ?? null;
  const ranks = state.permanentStoreRanks ?? shared.zeroStoreRanks();
  const lifetimeEquityEarned = state.lifetimeEquityEarned ?? 0;
  const spendable = shared.availableEquity(
    lifetimeEquityEarned,
    state.equitySpent ?? 0
  );
  const lifetimeLoc = state.totalLinesOfCode ?? 0;
  const frozenRate = intermission?.frozenHealthyPassiveLocPerSec ?? 0;
  const money = state.money ?? 0;

  // The Starting Capital grant at the rank owned right now: what
  // the next company starts with if the player starts it without
  // buying more.
  const currentGrant = shared.startingCapitalGrantCents(
    money,
    intermission?.frozenHealthyPassiveLocPerSec ?? 0,
    intermission?.frozenBestPayoutPerLocCents ?? 0,
    ranks.startingCapital ?? 0
  );

  async function handleBuy(storeId) {
    if (busy) return;
    setBusy(true);
    setStoreError(null);
    try {
      const result = await buyStoreRank(storeId);
      if (!result.ok) {
        if (result.error === "STORE") {
          setStoreError(
            "That purchase is not available. The store may have changed, try again."
          );
        } else if (result.error === "network") {
          setStoreError(
            "Could not reach the save server. No Equity was spent. Try again."
          );
        } else if (result.error === "not-initialized") {
          setStoreError("No save loaded yet. Try again.");
        } else {
          setStoreError(
            `Purchase failed (${result.error ?? "unknown"}). No Equity was spent. Try again.`
          );
        }
      }
    } catch (err) {
      setStoreError(
        `Purchase failed (${String(err?.message ?? err)}). No Equity was spent. Try again.`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    if (busy) return;
    setBusy(true);
    setStoreError(null);
    try {
      const result = await completeIntermission();
      if (!result.ok) {
        if (result.error === "network") {
          setStoreError(
            "Could not reach the save server. The intermission is still open. Try again."
          );
        } else if (result.error === "not-initialized") {
          setStoreError("No save loaded yet. Try again.");
        } else {
          setStoreError(
            `Could not start the next company (${result.error ?? "unknown"}). The intermission is still open. Try again.`
          );
        }
      }
      // On success the intermission clears in the restored state and
      // SellCompany returns to the overview on its own.
    } catch (err) {
      setStoreError(
        `Could not start the next company (${String(err?.message ?? err)}). The intermission is still open. Try again.`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel as="section" className="flex flex-col gap-2 p-3">
      <h3 className="m-0 text-sm text-[#cccccc]">The Permanent Store</h3>
      <p className="m-0 text-sm">
        The old company is sold. Spend your Equity on permanent
        upgrades before starting the next company. These upgrades
        survive every future sale.
      </p>
      <p className="m-0 text-sm">
        Equity spendable: {spendable} · Equity earned:{" "}
        {lifetimeEquityEarned} · The next company starts with{" "}
        {formatMoney(currentGrant)}.
      </p>

      {shared.PRESTIGE_STORE_IDS.map((storeId) => {
        const config = shared.PRESTIGE_STORE_CONFIG[storeId];
        const rank = ranks[storeId] ?? 0;
        const maxRank = shared.storeMaxRank(storeId);
        const nextRank = rank + 1;
        const price = shared.storeNextRankCost(storeId, rank);
        const isMaxed = price === null;
        const canAfford = !isMaxed && price <= spendable;
        const shortfall = isMaxed ? 0 : Math.max(0, price - spendable);
        const estimate = !isMaxed
          ? shared.storePurchaseEstimate(
              lifetimeEquityEarned,
              lifetimeLoc,
              shortfall,
              frozenRate
            )
          : null;
        return (
          <Panel key={storeId} className="flex flex-col gap-1 p-3">
            <h4 className="m-0 text-sm text-[#cccccc]">
              {config.displayName} · Rank {rank} of {maxRank}
            </h4>
            <p className="m-0 text-sm">{config.description}</p>
            <p className="m-0 text-sm">
              {effectLine(storeId, rank, intermission, money)}
            </p>
            {!isMaxed && (
              <p className="m-0 text-sm">
                {nextRankLine(storeId, nextRank, intermission, money)}
              </p>
            )}
            {isMaxed ? (
              <p className="m-0 text-sm">Maxed out.</p>
            ) : (
              <>
                <p className="m-0 text-sm">
                  Rank {nextRank} costs {price} Equity.
                  {!canAfford && shortfall > 0 && (
                    <>
                      {" "}
                      Shortfall: {shortfall} Equity.
                      {estimate.seconds === 0
                        ? " Available after sale."
                        : estimate.seconds === null
                          ? " Requires production to earn."
                          : ` About ${shared.formatEstimateDuration(estimate.seconds)} at the sold company's rate.`}
                    </>
                  )}
                </p>
                <div>
                  <Button
                    type="button"
                    disabled={busy || !canAfford}
                    onClick={() => handleBuy(storeId)}
                  >
                    {canAfford
                      ? `Buy rank ${nextRank} for ${price} Equity`
                      : `Need ${shortfall} more Equity`}
                  </Button>
                </div>
              </>
            )}
          </Panel>
        );
      })}

      {storeError && (
        <p className="m-0 text-sm text-[#f48771]">{storeError}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={handleComplete}>
          {busy ? "Starting…" : "Start the Next Company"}
        </Button>
      </div>
      <p className="m-0 text-sm">
        Starting the next company applies your Starting Capital grant
        once and closes the store until the next sale.
      </p>
    </Panel>
  );
}
