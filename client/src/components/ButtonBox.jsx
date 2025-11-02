import { HiMiniCodeBracket } from "react-icons/hi2"; // LOC icon
import { LiaMoneyBillWaveAltSolid } from "react-icons/lia"; // money icon
import { MdOutlineEmojiPeople } from "react-icons/md"; // one person
import { IoPeople } from "react-icons/io5"; // 2 people
import { FaPeopleGroup } from "react-icons/fa6"; // 3 people
import { TbUserCode } from "react-icons/tb"; // for the loc per second
import {
  calculateLOCPerClick,
  getTotalEmployeeCount,
} from "../context/GameContext.jsx";
import { useGameContext } from "../context/GameContext.jsx";
import { ClickButton } from "./ClickButton.jsx";
import { getCurrentLOCPerSecond } from "../context/GameContext.jsx";
import { formatMoney } from "../utils/currency.js";
import { CPSMeter } from "./CPSMeter.jsx";
import { useRef, useEffect } from "react";
import { FloatingText } from "./FloatingText.jsx";

export function ButtonBox({
  floatingTexts,
  triggerFloatingText,
  handleAnimationEnd,
}) {
  const { state } = useGameContext();
  const buttonBoxRef = useRef(null);
  const totalEmployees = getTotalEmployeeCount(state);
  const PeopleIcon =
    totalEmployees > 99
      ? FaPeopleGroup
      : totalEmployees > 9
      ? IoPeople
      : MdOutlineEmojiPeople;

  // Listen for game tick animation event
  useEffect(() => {
    const handleGameTick = (event) => {
      console.log("ButtonBox received gameTickAnimation event", event.detail);
      const { amount } = event.detail;

      if (buttonBoxRef.current) {
        const rect = buttonBoxRef.current.getBoundingClientRect();
        const startX = rect.left;
        const startY = rect.top - 10;

        const icon = <HiMiniCodeBracket size={20} color="gray" />;
        console.log(
          "Calling triggerFloatingText with:",
          startX,
          startY,
          `+${amount}`
        );
        triggerFloatingText(startX, startY, `+${amount}`, icon);
      }
    };

    console.log("ButtonBox: Setting up gameTickAnimation listener");
    window.addEventListener("gameTickAnimation", handleGameTick);
    return () => {
      console.log("ButtonBox: Removing gameTickAnimation listener");
      window.removeEventListener("gameTickAnimation", handleGameTick);
    };
  }, [triggerFloatingText]);

  return (
    <>
      <div className="mx-2 select-none">
        <div className="flex justify-items-normal items-center gap-4 mt-2 w-full border border-gray-300 p-2 rounded-2xl">
          <div className="flex-2 flex flex-col items-center">
            <p>LOC Per Click: {calculateLOCPerClick(state)}</p>
            <ClickButton triggerFloatingText={triggerFloatingText} />
            <CPSMeter />
          </div>

          <p className="flex-1">
            <b className="inline-flex items-center gap-1">
              LOC <HiMiniCodeBracket size={20} />:
            </b>{" "}
            <p>{Math.floor(state.linesOfCode)}</p>
          </p>
          <p className="flex-1">
            <b className="inline-flex items-center gap-1">
              <LiaMoneyBillWaveAltSolid size={20} />:
            </b>{" "}
            <p>${formatMoney(state.money)}</p>
          </p>
          <p className="flex-1">
            <b className="inline-flex items-center gap-1">
              <PeopleIcon size={20} />:
            </b>{" "}
            <p>{totalEmployees}</p>
          </p>
          <p className="flex-1">
            <b className="inline-flex items-center gap-1">
              <TbUserCode size={20} />:
            </b>{" "}
            <p ref={buttonBoxRef}>{getCurrentLOCPerSecond(state)} / sec</p>
          </p>
        </div>
      </div>

      {floatingTexts.map((floatingText) => (
        <FloatingText
          key={floatingText.id}
          x={floatingText.x}
          y={floatingText.y}
          text={floatingText.text}
          icon={floatingText.icon}
          onAnimationEnd={() => handleAnimationEnd(floatingText.id)}
        />
      ))}
    </>
  );
}
