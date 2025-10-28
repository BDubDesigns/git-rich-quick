import { HiMiniCodeBracket } from "react-icons/hi2";
import { LiaMoneyBillWaveAltSolid } from "react-icons/lia";
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

export function ButtonBox() {
  const { state } = useGameContext();
  const totalEmployees = getTotalEmployeeCount(state);
  const PeopleIcon =
    totalEmployees > 99
      ? FaPeopleGroup
      : totalEmployees > 9
      ? IoPeople
      : MdOutlineEmojiPeople;

  return (
    <div className="mx-2 select-none">
      <div className="flex justify-items-normal items-center gap-4 mt-2 w-full border border-gray-300 p-2 rounded-2xl">
        <div className="flex-2 flex flex-col items-center">
          <p>LOC Per Click: {calculateLOCPerClick(state)}</p>
          <ClickButton />
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
          <p>{getCurrentLOCPerSecond(state)} / sec</p>
        </p>
      </div>
    </div>
  );
}
