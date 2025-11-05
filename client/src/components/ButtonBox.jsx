import { useRef } from "react";
import { HiMiniCodeBracket } from "react-icons/hi2"; // Lines of Code icon
import { LiaMoneyBillWaveAltSolid } from "react-icons/lia"; // Currency icon
import { TbUserCode } from "react-icons/tb"; // Employee/passive generation icon

import {
  calculateLOCPerClick,
  getTotalEmployeeCount,
  calculateLOCPerSecond,
} from "../context/GameContext.jsx";
import { useGameContext } from "../context/GameContext.jsx";
import { formatMoney } from "../utils/currency.js";

// UI Components for the button box layout
import { ClickSection } from "./ClickSection.jsx";
import { StatDisplay } from "./StatDisplay.jsx";
import { EmployeeCountIcon } from "./EmployeeCountIcon.jsx";
import { PassiveAnimationLayer } from "./PassiveAnimationLayer.jsx";

/**
 * ButtonBox Component
 *
 * Main control center for the game's primary interactions. Renders:
 * 1. The "Commit Code" click button and CPS (LOC/sec) indicator
 * 2. Real-time game stats (LOC, Money, Employees, LOC/sec)
 * 3. Floating text animations for passive LOC generation
 *
 * Uses the ref pattern to position floating text animations relative to the LOC/sec display.
 * This component calculates all derived game values once to avoid prop drilling and
 * ensure consistent calculations across child components.
 */
export function ButtonBox() {
  const { state } = useGameContext();

  // Calculate all derived game values from the current game state
  // These are computed once here and passed down to avoid redundant calculations in child components
  const locPerClick = calculateLOCPerClick(state);
  const locPerSecond = calculateLOCPerSecond(state);
  const totalEmployees = getTotalEmployeeCount(state);

  // Format display values for human-readable output
  const displayMoney = formatMoney(state.money);
  const displayLoc = Math.floor(state.linesOfCode);

  // Create ref for the LOC/sec stat display element
  // This is used by PassiveAnimationLayer to position floating text animations
  // relative to where the passive LOC generation indicator is displayed
  const locPerSecondRef = useRef(null);

  return (
    <>
      <div className="mx-2 select-none">
        <div className="flex justify-items-normal items-center gap-4 mt-2 w-full border border-gray-300 p-2 rounded-2xl">
          {/* Primary interaction zone: Click button and CPS meter */}
          <ClickSection locPerClick={locPerClick} />

          {/* Game stat displays: LOC currency */}
          <StatDisplay
            label="LOC"
            icon={<HiMiniCodeBracket size={20} />}
            value={displayLoc}
          />

          {/* Game stat displays: Money currency (in dollars) */}
          <StatDisplay
            label="Money"
            icon={<LiaMoneyBillWaveAltSolid size={20} />}
            value={`$${displayMoney}`}
          />

          {/* Game stat displays: Total employee count across all job levels */}
          <StatDisplay
            label="Employees"
            icon={<EmployeeCountIcon count={totalEmployees} />}
            value={totalEmployees}
          />

          {/* Game stat displays: Passive LOC generation per second (employees' production)
              This element has a ref attached so PassiveAnimationLayer can position 
              floating text animations relative to it */}
          <StatDisplay
            ref={locPerSecondRef}
            label="LOC/sec"
            icon={<TbUserCode size={20} />}
            value={locPerSecond}
          />
        </div>
      </div>

      {/* Floating text animation layer for passive LOC generation
          Displays "+X LOC" animations that originate from the LOC/sec stat display.
          Uses the ref to calculate animation start position */}
      <PassiveAnimationLayer locPerSecondRef={locPerSecondRef} />
    </>
  );
}
