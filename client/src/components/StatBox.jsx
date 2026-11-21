import { useRef } from "react";
import { HiMiniCodeBracket } from "react-icons/hi2"; // Lines of Code icon
import { LiaMoneyBillWaveAltSolid } from "react-icons/lia"; // Currency icon
import { TbUserCode } from "react-icons/tb"; // Employee/passive generation icon

import {
  getTotalEmployeeCount,
  calculateLOCPerSecond,
} from "../context/gameLogic.js";
import { useGameContext } from "../context/useGameContext.js";
import { useStatBump } from "../hooks/useStatBump.js";
import { useProductionTick } from "../hooks/useProductionTick.js";
import { tickBarVisible } from "../utils/tickBar.js";
import { GAME_BALANCE_CONFIG } from "../context/gameConfig.js";
import "./TickBar.css";
// Number abbreviation (issue #42) — the shared formatter. formatMoney
// returns the string WITH the "$" attached, so callers do not prepend it.
import {
  formatMoney,
  formatNumber,
} from "../../../shared/formatNumber.js";

// UI Components for the button box layout
import { StatDisplay } from "./StatDisplay.jsx";
import { EmployeeCountIcon } from "./EmployeeCountIcon.jsx";
import { PassiveAnimationLayer } from "./PassiveAnimationLayer.jsx";
import { Panel } from "./Panel.jsx";

/**
 * StatBox Component
 *
 * Displays all real-time game statistics in a horizontal panel. Renders:
 * 1. Current LOC (Lines of Code) balance
 * 2. Current Money balance
 * 3. Total employee count
 * 4. Passive LOC generation rate (LOC/sec)
 * 5. The tick bar (issue #229): a slim bar along the panel's bottom
 *    edge that fills over each production tick, with a quiet flash on
 *    the LOC total when the tick lands
 *
 * The passive layer stays mounted for the Night Shift report's one-off
 * float (an event); the per-second tick no longer launches a float.
 * This component calculates all derived game values once to avoid prop drilling and
 * ensure consistent calculations across child components.
 */
export function StatBox() {
  const { state } = useGameContext();

  // Calculate all derived game values from the current game state
  // These are computed once here and passed down to avoid redundant calculations in child components
  const locPerSecond = calculateLOCPerSecond(state);
  const totalEmployees = getTotalEmployeeCount(state);

  // Format display values for human-readable output (issue #42: every
  // number display goes through the shared formatter).
  const displayMoney = formatMoney(state.money);
  const displayLoc = formatNumber(Math.floor(state.linesOfCode));

  // Create ref for the LOC/sec stat display element
  // This is used by PassiveAnimationLayer to position the Night Shift
  // report's floating text at the passive LOC generation indicator
  const locPerSecondRef = useRef(null);

  // The numbers react (issue #214): each stat bumps on a big gain of
  // its own (state.statGain, set by the reducer; see utils/statGain.js).
  const locBump = useStatBump(state.statGain, "loc");
  const moneyBump = useStatBump(state.statGain, "money");
  const rateBump = useStatBump(state.statGain, "rate");

  // The tick bar (issue #229): a new key on every production tick.
  const tick = useProductionTick();

  return (
    <>
      <div className="mx-2 select-none">
        <Panel className="relative flex justify-items-normal items-center gap-6 mt-2 py-2 px-6 w-full mb-2">
          {/* Game stat displays: LOC currency */}
          <StatDisplay
            icon={
              <HiMiniCodeBracket
                size={24}
                color="var(--active-button-bg-color)"
              />
            }
            value={displayLoc}
            label="LOC"
            bump="loc"
            bumpKey={locBump}
            flashKey={tick}
          />

          {/* Game stat displays: Money currency (in dollars) */}
          <StatDisplay
            icon={<LiaMoneyBillWaveAltSolid color="green" size={24} />}
            value={displayMoney}
            label="Money"
            bump="money"
            bumpKey={moneyBump}
          />

          {/* Game stat displays: Total employee count across all job levels */}
          <StatDisplay
            icon={
              <EmployeeCountIcon
                color="var(--classes-text-color)"
                count={totalEmployees}
                size={24}
              />
            }
            value={formatNumber(totalEmployees)}
            label="Devs"
          />

          {/* Game stat displays: Passive LOC generation per second (employees' production)
              This element has a ref attached so PassiveAnimationLayer can position
              the Night Shift report's floating text relative to it */}
          <StatDisplay
            ref={locPerSecondRef}
            icon={<TbUserCode size={24} color="var(--comment-text-color)" />}
            value={`${formatNumber(locPerSecond)}/s`}
            label="LOC/s"
            bump="rate"
            bumpKey={rateBump}
          />

          {/* The tick bar (issue #229, TickBar.css): fills over one
              production tick along the panel's bottom edge, covering
              no label. Keyed by the tick, so each tick restarts it. */}
          {tickBarVisible(tick, locPerSecond) && (
            <span
              key={tick}
              className="tick-bar"
              aria-hidden="true"
              style={{ animationDuration: `${GAME_BALANCE_CONFIG.TICK_INTERVAL}ms` }}
            />
          )}
        </Panel>
      </div>

      {/* Floating text layer, now only for the Night Shift report's
          credited LOC (a one-off event on load). The per-second passive
          float is gone (issue #229): ticks drive the tick bar above. */}
      <PassiveAnimationLayer locPerSecondRef={locPerSecondRef} />
    </>
  );
}
