/**
 * IPO Roadshow (issue #266): six milestones on the Series C to IPO
 * climb that pay 100 bonus Equity. In Settings, right under Sell the
 * Company, where the Funding Rounds rank is shown during a run (the
 * permanent store itself only opens after a sale, and the Roadshow is
 * bought mid-run with this company's LOC and cash).
 *
 * Styled in the employee cards' JSDoc language and collapsible like
 * the Hire cards (PR #262): the header row is always shown (chevron,
 * bell, "IPO Roadshow", the "2/6" chip and, collapsed, the reason the
 * buy button is disabled) with the next milestone's buy button on the
 * right. Expanded, a JSDoc block lists every milestone: its run LOC
 * gate as a progress bar, its price and its Equity. Collapsed by
 * default; the choice is a device preference (`grq:roadshowOpen`,
 * utils/roadshowCard.js), never the save. An email link to the card
 * (tab "settings", item "roadshow") opens it for the session before
 * its HighlightAnchor scrolls and flashes.
 *
 * The purchase goes through the server (buyRoadshowMilestone): it
 * checks the order, the gate and the cash, deducts the price and
 * raises the stage, and the engine restores the result. Every number
 * comes from shared/game-balance.js (ROADSHOW_CONFIG and its helpers).
 *
 * Copy rules: no em or en dashes in player-facing copy; the box is the
 * shared Panel component.
 */

import { useEffect, useId, useState } from "react";
import { BsBellFill } from "react-icons/bs";
import { useGameContext } from "../context/useGameContext.js";
import { getBaseLocPerSecond } from "../context/gameLogic.js";
import * as shared from "../../../shared/game-balance.js";
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { highlightMatches } from "../navigation/highlight.js";
import {
  readRoadshowOpen,
  roadshowCardModel,
  writeRoadshowOpen,
} from "../utils/roadshowCard.js";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";
import { Panel } from "./Panel.jsx";
import { Button } from "./Button.jsx";
import { JsDocLine } from "./JsDocBlock.jsx";
import { ProgressBar } from "./ProgressBar.jsx";

/** The bell's color: the gold of the golden star. */
const BELL_COLOR = "#FFD700";

/** The error line for a failed purchase. */
function buyErrorText(result) {
  switch (result?.error) {
    case "network":
      return "Could not reach the save server. No cash was spent. Try again.";
    case "ROADSHOW":
      return "That milestone is not available right now. Try again in a moment.";
    case "new-version":
      return "A new version is out. Reload to keep playing.";
    case "not-initialized":
      return "No save loaded yet. Try again.";
    default:
      return `Purchase failed (${result?.error ?? "unknown"}). No cash was spent. Try again.`;
  }
}

/** One milestone's row inside the JSDoc block. */
function MilestoneRow({ row, showBar }) {
  const head = `${row.n}. ${row.name}`;
  if (row.state === "bought") {
    return (
      <div className="pb-1">
        <span className="text-green-400">{`✓ ${head}`}</span>
        <span className="text-gray-400">{` +${row.equity} Equity`}</span>
      </div>
    );
  }
  if (row.state === "missed") {
    return (
      <div className="pb-1 text-gray-400">
        {head}: the IPO happened first.
      </div>
    );
  }
  const next = row.state === "next";
  return (
    <div className={`pb-2 ${next ? "" : "opacity-70"}`}>
      <span className={`text-sm font-bold ${next ? "text-[#cccccc]" : "text-gray-400"}`}>
        {head}
      </span>
      <br />
      <span className="text-gray-400">{row.quip}</span>
      <br />
      <JsDocLine
        tag="@returns"
        type="Equity"
        value={`+${row.equity} bonus Equity`}
        valueClassName="text-green-400"
      />
      <JsDocLine
        tag="@param"
        type="Cost"
        value={`${row.priceMinutes} minutes of shipping income`}
        suffix={` (${formatMoney(row.priceCents)} at your current LOC/s)`}
        suffixClassName="text-gray-400"
      />
      <span className="text-blue-400">@requires</span>
      <span className="text-cyan-300">{" {LOC}"}</span>
      <div>
        <ProgressBar
          label={`Write ${formatNumber(row.gate.target)} LOC this company`}
          current={Math.floor(row.gate.current)}
          target={row.gate.target}
          showBar={showBar}
        />
      </div>
      {!next && (
        <span className="text-gray-400">After milestone {row.n - 1}.</span>
      )}
    </div>
  );
}

export function RoadshowCard() {
  const { state, buyRoadshowMilestone } = useGameContext();
  const showBar = useProgressBarEnabled("unlock");
  const detailId = useId();
  const [savedOpen, setSavedOpen] = useState(() => readRoadshowOpen());
  const [sessionOpen, setSessionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buyError, setBuyError] = useState(null);

  // An email link to the card opens it during render (so the expanded
  // card is in the DOM when the HighlightAnchor scrolls), then keeps it
  // open for the session without changing the remembered choice.
  const targeted = highlightMatches(
    state.highlightTarget,
    "settings",
    shared.ROADSHOW_EMAIL_ITEM_ID
  );
  useEffect(() => {
    if (targeted) setSessionOpen(true);
  }, [targeted]);
  const open = targeted || sessionOpen || savedOpen;
  function toggle() {
    const nextOpen = !open;
    setSessionOpen(false);
    setSavedOpen(nextOpen);
    writeRoadshowOpen(nextOpen);
  }

  const model = roadshowCardModel(state, getBaseLocPerSecond(state));
  if (!model) return null;
  const { next } = model;
  const price = next ? formatMoney(next.priceCents) : "";

  async function handleBuy() {
    if (busy || !next?.canBuy) return;
    setBusy(true);
    setBuyError(null);
    try {
      const result = await buyRoadshowMilestone();
      if (!result.ok) setBuyError(buyErrorText(result));
    } catch (err) {
      setBuyError(buyErrorText({ error: String(err?.message ?? err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel as="section" className="px-3 py-1.5 m-0" aria-label="IPO Roadshow">
      <div className="flex items-center gap-2 min-h-10">
        <button
          type="button"
          className="flex flex-1 min-w-0 items-center gap-2 min-h-10 py-1 text-left bg-transparent border-0 p-0 text-[#cccccc] cursor-pointer rounded outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[#0078d4]"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={open ? "Hide IPO Roadshow details" : "Show IPO Roadshow details"}
        >
          <span
            className={`info-toggle-chevron shrink-0 text-base leading-none${open ? " info-toggle-chevron--open" : ""}`}
            aria-hidden="true"
          >
            ▸
          </span>
          <BsBellFill size={18} color={BELL_COLOR} className="shrink-0" aria-hidden="true" />
          <span className="flex min-w-0 flex-col font-mono">
            <span className="flex items-baseline gap-2">
              <span className="text-sm font-bold whitespace-nowrap">IPO Roadshow</span>
              <span
                className={`text-xs whitespace-nowrap ${model.status === "open" ? "text-cyan-300" : "text-green-400"}`}
              >
                {model.chip}
              </span>
            </span>
            {!open && (
              <span className="text-xs text-gray-400 truncate">
                {model.shortReason
                  ? `${model.shortReason} · +${model.bonusEquity} of ${model.totalEquity} Equity`
                  : `+${model.bonusEquity} of ${model.totalEquity} bonus Equity`}
              </span>
            )}
          </span>
        </button>
        {next && (
          <Button
            className="shrink-0 whitespace-nowrap tap-target-40"
            disabled={busy || !next.canBuy}
            onClick={handleBuy}
            aria-label={`Buy roadshow milestone ${next.stage}, ${next.milestone.name}, for ${price}`}
          >
            {busy ? "Buying…" : `Buy (${price})`}
          </Button>
        )}
      </div>

      <div id={detailId} hidden={!open} className="pt-1 pb-1">
        <div className="text-xs font-mono">
          <span className="comment-text">{`/** `}</span>
          <br />
          <span>Six stops between Series C and ringing the bell.</span>
          <br />
          <span className="text-gray-400">
            Each milestone pays bonus Equity you can spend in the permanent
            store. Bonus Equity never counts toward Equity earned, so your
            next sale and your Founder multiplier stay exactly the same.
            Milestones are bought once and survive every sale.
          </span>
          <br />
          <JsDocLine
            tag="@stage"
            type="Roadshow"
            value={`${model.stage} of ${model.maxStage}`}
          />
          <JsDocLine
            tag="@returns"
            type="Equity"
            value={`+${model.bonusEquity} of ${model.totalEquity} bonus Equity so far`}
            valueClassName="text-green-400"
          />
          {model.status === "done" && (
            <>
              <span className="text-green-400">
                Every stop is done. The bell is waiting: buy the IPO in the
                permanent store after your next sale.
              </span>
              <br />
            </>
          )}
          {model.status === "closed" && (
            <>
              <span className="text-green-400">
                The bell has rung. The roadshow is over.
              </span>
              <br />
            </>
          )}
          <div className="pt-1">
            {model.rows.map((row) => (
              <MilestoneRow key={row.id} row={row} showBar={showBar} />
            ))}
          </div>
          {model.blockedReason && (
            <>
              <span className="text-gray-400">{model.blockedReason}</span>
              <br />
            </>
          )}
          <span className="comment-text">{`*/`}</span>
        </div>
        {next && (
          <div className="mt-1">
            <Button
              type="button"
              disabled={busy || !next.canBuy}
              onClick={handleBuy}
            >
              {busy
                ? "Buying…"
                : next.canBuy
                  ? `Buy milestone ${next.stage} for ${price}`
                  : !next.gate.met
                    ? `Milestone ${next.stage}: needs ${formatNumber(next.gate.target - next.gate.current)} more LOC`
                    : `Milestone ${next.stage}: needs ${formatMoney(next.priceCents - (state.money ?? 0))} more cash`}
            </Button>
          </div>
        )}
        {buyError && <p className="m-0 mt-1 text-xs text-[#f48771]">{buyError}</p>}
      </div>
    </Panel>
  );
}
