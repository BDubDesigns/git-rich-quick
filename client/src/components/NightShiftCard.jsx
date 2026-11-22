/**
 * Night Shift (issue #149): the offline-production upgrade, at the top
 * of the Hire tab. Styled in the employee cards' JSDoc language and
 * collapsible (Brandon's Nov 21 playtest: plain, and too tall for the
 * top of the tab).
 *
 * - The header row is always shown: a disclosure button (chevron, moon,
 *   "Night Shift", the "L1/5" chip, and the reason the buy button is
 *   disabled, if it is) and, on the right, the buy button with the next
 *   level's price. At max level the chip reads "L5/5 Maxed" and there
 *   is no buy button.
 * - Expanded, a JSDoc block follows: the current level's rate and cap,
 *   the next level's, the price (minutes of shipping income plus the
 *   cash figure at the current LOC/s), the gate as @requires progress
 *   bars, then the Night Shift Contract note.
 * - Collapsed by default. The choice is a device preference
 *   (utils/nightShiftCard.js, `grq:nightShiftOpen`), never the save.
 *   An email link that targets the card (item id "nightShift") opens it
 *   before its HighlightAnchor scrolls and flashes, so the link lands
 *   on the requirements it talks about.
 *
 * Every number comes from shared/game-balance.js (NIGHT_SHIFT_CONFIG and
 * its helpers). The purchase goes through the reducer
 * (BUY_NIGHT_SHIFT_LEVEL), which re-checks the gate and the price. The
 * offline credit itself is settled by the server on load, never here.
 *
 * Copy rules: no em or en dashes in player-facing copy; the box is the
 * shared Panel component.
 */

import { useId, useState } from "react";
import { BsMoonStarsFill } from "react-icons/bs";
import { useGameContext } from "../context/useGameContext";
import {
  flatEmployeeCounts,
  getBaseLocPerSecond,
} from "../context/gameLogic.js";
import * as shared from "../../../shared/game-balance.js";
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { formatCondition } from "../utils/formatCondition.js";
import {
  nightShiftRowModel,
  readNightShiftOpen,
  writeNightShiftOpen,
} from "../utils/nightShiftCard.js";
import { highlightMatches } from "../navigation/highlight.js";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";
import { Panel } from "./Panel.jsx";
import { Button } from "./Button.jsx";
import { JsDocLine } from "./JsDocBlock.jsx";
import { ProgressBar } from "./ProgressBar.jsx";

/** The moon's color: the platinum already in the cosmetics palette. */
const MOON_COLOR = "#E5E4E2";

/** "10% of your passive LOC/s while away, for up to 4 hours per absence." */
function levelTerms(level) {
  const config = shared.nightShiftLevelConfig(level);
  if (!config) return "";
  return `${Math.round(config.rate * 100)}% of your passive LOC/s while away, for up to ${config.capHours} hours per absence.`;
}

/** "8 hours away gets you 1.6 hours of production." */
function overnightLine(level) {
  const hours = shared.nightShiftHoursOfProduction(level, 8);
  return `8 hours away gets you ${Math.round(hours * 10) / 10} hours of production.`;
}

export function NightShiftCard() {
  const { state, dispatch } = useGameContext();
  const showBar = useProgressBarEnabled("unlock");
  const detailId = useId();
  const [open, setOpen] = useState(() => readNightShiftOpen());

  // An email link to this card opens it, during render so the expanded
  // card is already in the DOM when the HighlightAnchor around it
  // scrolls and flashes (its effect runs after this commit). Not saved
  // as the device choice: only the chevron changes that.
  const targeted = highlightMatches(
    state.highlightTarget,
    "shop",
    shared.NIGHT_SHIFT_EMAIL_ITEM_ID
  );
  if (targeted && !open) setOpen(true);

  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    writeNightShiftOpen(nextOpen);
  };

  const level = shared.nightShiftLevelOf(state.nightShiftLevel);
  const maxLevel = shared.NIGHT_SHIFT_CONFIG.maxLevel;
  const buffedLocPerSec = getBaseLocPerSecond(state);
  const employeeCounts = flatEmployeeCounts(state);
  const next = shared.nightShiftNextPurchase({
    level,
    money: state.money,
    buffedLocPerSec,
    employeeCounts,
  });
  const contractOwned =
    shared.nightShiftStartLevel(state.permanentStoreRanks) >= 1;
  const row = nightShiftRowModel(level, next, maxLevel);

  const nextConfig = next ? shared.nightShiftLevelConfig(next.level) : null;
  const priceMinutes = nextConfig ? nextConfig.priceSeconds / 60 : 0;
  const employeeName = next
    ? shared.EMPLOYEE_DISPLAY_NAMES[next.gate.employees.employeeType]
    : "";
  const price = next ? formatMoney(next.priceCents) : "";

  return (
    <Panel as="section" className="px-3 py-1.5 m-0" aria-label="Night Shift">
      {/* Header row: the disclosure on the left, the buy button on the
          right (the employee cards' side). */}
      <div className="flex items-center gap-2 min-h-10">
        <button
          type="button"
          className="flex flex-1 min-w-0 items-center gap-2 py-1 text-left bg-transparent border-0 p-0 text-[#cccccc] cursor-pointer rounded outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[#0078d4]"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={open ? "Hide Night Shift details" : "Show Night Shift details"}
        >
          <span
            className={`info-toggle-chevron shrink-0 text-base leading-none${open ? " info-toggle-chevron--open" : ""}`}
            aria-hidden="true"
          >
            ▸
          </span>
          <BsMoonStarsFill
            size={20}
            color={MOON_COLOR}
            className="shrink-0"
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-col font-mono">
            <span className="flex items-baseline gap-2">
              <span className="text-sm font-bold whitespace-nowrap">
                Night Shift
              </span>
              <span
                className={`text-xs whitespace-nowrap ${row.maxed ? "text-green-400" : "text-cyan-300"}`}
              >
                {row.chip}
              </span>
            </span>
            {!open && row.shortReason && (
              <span className="text-xs text-gray-400 truncate">
                {row.shortReason}
              </span>
            )}
          </span>
        </button>
        {!row.maxed && (
          <Button
            className="shrink-0 whitespace-nowrap"
            disabled={!next.canBuy}
            onClick={() => dispatch({ type: "BUY_NIGHT_SHIFT_LEVEL" })}
            aria-label={`${row.buyLabel} (${price})`}
          >
            {row.shortBuyLabel} ({price})
          </Button>
        )}
      </div>

      {/* Expanded: the JSDoc block, the card language of the Hire tab. */}
      <div id={detailId} hidden={!open} className="pt-1 pb-1">
        <div className="text-xs font-mono">
          <span className="comment-text">{`/** `}</span>
          <br />
          {/* The quip, like every employee card's one-liner. */}
          <span>Runs on cold pizza and the glow of a monitor at 3am.</span>
          <br />
          <span className="text-gray-400">
            The team keeps coding while the game is closed. You collect it
            the next time you open the game.
          </span>
          <br />
          <JsDocLine tag="@level" type="Shift" value={`${level} of ${maxLevel}`} />
          {level === 0 ? (
            <JsDocLine
              tag="@returns"
              type="LOC"
              value="Right now everyone goes home when you do: no LOC while the game is closed."
            />
          ) : (
            <JsDocLine
              tag="@returns"
              type="LOC"
              value={`Level ${level}: ${levelTerms(level)}`}
              valueClassName="text-green-400"
              suffix={` ${overnightLine(level)}`}
              suffixClassName="text-gray-400"
            />
          )}
          {next ? (
            <>
              <JsDocLine
                tag="@next"
                type="LOC"
                value={`Level ${next.level}: ${levelTerms(next.level)}`}
                valueClassName="text-green-400"
                suffix={` ${overnightLine(next.level)}`}
                suffixClassName="text-gray-400"
              />
              <JsDocLine
                tag="@param"
                type="Cost"
                value={`Price: ${priceMinutes} minutes of shipping income`}
                suffix={` (${price} at your current LOC/s).`}
                suffixClassName="text-gray-400"
              />
              {/* The gate: one @requires line per condition, each with
                  the same unlock progress bar every other unlock uses. */}
              {[
                {
                  type: "LOC/s",
                  label: `Reach ${formatNumber(next.gate.locPerSecond.target)} passive LOC/s`,
                  current: Math.floor(next.gate.locPerSecond.current),
                  target: next.gate.locPerSecond.target,
                },
                {
                  type: "Team",
                  label: formatCondition({
                    type: "SPECIFIC_EMPLOYEE_COUNT",
                    employeeName,
                    target: next.gate.employees.target,
                  }),
                  current: next.gate.employees.current,
                  target: next.gate.employees.target,
                },
              ].map((gate) => (
                <div key={gate.type} className="pb-1">
                  <span className="text-blue-400">@requires</span>
                  <span className="text-cyan-300">{` {${gate.type}}`}</span>
                  <div>
                    <ProgressBar
                      label={gate.label}
                      current={gate.current}
                      target={gate.target}
                      showBar={showBar}
                    />
                  </div>
                </div>
              ))}
              {row.blockedReason && (
                <>
                  <span className="text-gray-400">{row.blockedReason}</span>
                  <br />
                </>
              )}
            </>
          ) : (
            <>
              <span className="text-green-400">
                Maxed: half your team works through the night.
              </span>
              <br />
            </>
          )}
          <span className="comment-text">{`*/`}</span>
        </div>
        <p className="m-0 mt-1 text-xs text-gray-400">
          Away less than 5 minutes counts as still here. Night Shift resets when
          you sell the company.
          {contractOwned
            ? " Your Night Shift Contract starts every new company at level 1."
            : " The Night Shift Contract in the permanent store keeps level 1 through a sale."}
        </p>
      </div>
    </Panel>
  );
}
