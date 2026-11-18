/**
 * Night Shift (issue #149): the offline-production upgrade, on the Hire
 * tab. One Panel showing the current level's rate and cap, the next
 * level's price (minutes of production plus the cash figure, quoted at
 * the current LOC/s), its gate with the same unlock progress bars as
 * every other unlock, and the "8 hours away gets you X hours of
 * production" line for the current and next level.
 *
 * Every number comes from shared/game-balance.js (NIGHT_SHIFT_CONFIG and
 * its helpers). The purchase goes through the reducer
 * (BUY_NIGHT_SHIFT_LEVEL), which re-checks the gate and the price. The
 * offline credit itself is settled by the server on load, never here.
 *
 * Copy rules: no em dashes in player-facing copy; the box is the shared
 * Panel component.
 */

import { useGameContext } from "../context/useGameContext";
import {
  flatEmployeeCounts,
  getBaseLocPerSecond,
} from "../context/gameLogic.js";
import * as shared from "../../../shared/game-balance.js";
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { formatCondition } from "../utils/formatCondition.js";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";
import { Panel } from "./Panel.jsx";
import { Button } from "./Button.jsx";
import { ProgressBar } from "./ProgressBar.jsx";

/** "+10% of passive LOC/s while away, for up to 4h per absence." */
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
  const level = shared.nightShiftLevelOf(state.nightShiftLevel);
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

  let blockedReason = "";
  if (next && !next.gate.met) {
    blockedReason = "Meet the requirements below to hire this shift.";
  } else if (next && !next.affordable) {
    blockedReason = "Not enough cash yet.";
  }

  const nextConfig = next ? shared.nightShiftLevelConfig(next.level) : null;
  const priceMinutes = nextConfig ? nextConfig.priceSeconds / 60 : 0;
  const employeeName = next
    ? shared.EMPLOYEE_DISPLAY_NAMES[next.gate.employees.employeeType]
    : "";

  return (
    <Panel as="section" className="flex flex-col gap-2 p-3" aria-label="Night Shift">
      <h3 className="m-0 text-sm text-[#cccccc]">
        Night Shift: level {level} of {shared.NIGHT_SHIFT_CONFIG.maxLevel}
      </h3>
      <p className="m-0 text-sm">
        The team keeps coding while the game is closed. You collect it the
        next time you open the game.
      </p>
      {level === 0 ? (
        <p className="m-0 text-sm">
          Right now everyone goes home when you do: no LOC while the game is
          closed.
        </p>
      ) : (
        <p className="m-0 text-sm">
          Level {level}: {levelTerms(level)} {overnightLine(level)}
        </p>
      )}

      {next ? (
        <>
          <p className="m-0 text-sm">
            Level {next.level}: {levelTerms(next.level)}{" "}
            {overnightLine(next.level)}
          </p>
          <p className="m-0 text-sm">
            Price: {priceMinutes} minutes of production (
            {formatMoney(next.priceCents)} at your current LOC/s).
          </p>
          <ProgressBar
            label={`Reach ${formatNumber(next.gate.locPerSecond.target)} passive LOC/s`}
            current={Math.floor(next.gate.locPerSecond.current)}
            target={next.gate.locPerSecond.target}
            showBar={showBar}
          />
          <ProgressBar
            label={formatCondition({
              type: "SPECIFIC_EMPLOYEE_COUNT",
              employeeName,
              target: next.gate.employees.target,
            })}
            current={next.gate.employees.current}
            target={next.gate.employees.target}
            showBar={showBar}
          />
          <div>
            <Button
              type="button"
              disabled={!next.canBuy}
              onClick={() => dispatch({ type: "BUY_NIGHT_SHIFT_LEVEL" })}
            >
              {level === 0 ? "Hire the night shift" : `Upgrade to level ${next.level}`}{" "}
              ({formatMoney(next.priceCents)})
            </Button>
          </div>
          {blockedReason && <p className="m-0 text-sm">{blockedReason}</p>}
        </>
      ) : (
        <p className="m-0 text-sm">
          Maxed: half your team works through the night.
        </p>
      )}

      <p className="m-0 text-xs text-gray-400">
        Away less than 5 minutes counts as still here. Night Shift resets when
        you sell the company.
        {contractOwned
          ? " Your Night Shift Contract starts every new company at level 1."
          : " The Night Shift Contract in the permanent store keeps level 1 through a sale."}
      </p>
    </Panel>
  );
}
