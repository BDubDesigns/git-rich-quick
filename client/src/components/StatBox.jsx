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
import { StatDisplay } from "./StatDisplay.jsx";
import { EmployeeCountIcon } from "./EmployeeCountIcon.jsx";
import { PassiveAnimationLayer } from "./PassiveAnimationLayer.jsx";

/**
 * StatBox Component
 *
 * Displays all real-time game statistics in a horizontal panel. Renders:
 * 1. Current LOC (Lines of Code) balance
 * 2. Current Money balance
 * 3. Total employee count
 * 4. Passive LOC generation rate (LOC/sec)
 * 5. Floating text animations for passive LOC generation
 *
 * Uses the ref pattern to position floating text animations relative to the LOC/sec display.
 * This component calculates all derived game values once to avoid prop drilling and
 * ensure consistent calculations across child components.
 */
export function StatBox() {
  const { state } = useGameContext();

  // Calculate all derived game values from the current game state
  // These are computed once here and passed down to avoid redundant calculations in child components
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
        <div className="flex justify-items-normal items-center gap-4 mt-2 p-2 w-full panel mb-2">
          {/* Game stat displays: LOC currency */}
          <StatDisplay
            label="LOC"
            icon={
              <HiMiniCodeBracket
                size={30}
                color="var(--active-button-bg-color)"
              />
            }
            value={displayLoc}
          />

          {/* Game stat displays: Money currency (in dollars) */}
          <StatDisplay
            label="Money"
            icon={<LiaMoneyBillWaveAltSolid color="green" size={30} />}
            value={`$${displayMoney}`}
          />

          {/* Game stat displays: Total employee count across all job levels */}
          <StatDisplay
            label="Employees"
            icon={
              <EmployeeCountIcon
                color="var(--classes-text-color)"
                count={totalEmployees}
                size={30}
              />
            }
            value={totalEmployees}
          />

          {/* Game stat displays: Passive LOC generation per second (employees' production)
              This element has a ref attached so PassiveAnimationLayer can position 
              floating text animations relative to it */}
          <StatDisplay
            ref={locPerSecondRef}
            label="LOC/sec"
            icon={<TbUserCode size={36} color="var(--comment-text-color)" />}
            value={locPerSecond + "/s"}
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
