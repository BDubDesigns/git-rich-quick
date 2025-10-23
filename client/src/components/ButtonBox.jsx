import { HiMiniCodeBracket } from "react-icons/hi2";
import { LiaMoneyBillWaveAltSolid } from "react-icons/lia";
import { MdOutlineEmojiPeople } from "react-icons/md"; // one person
import { IoPeople } from "react-icons/io5"; // 2 people
import { FaPeopleGroup } from "react-icons/fa6"; // 3 people
import { getTotalEmployeeCount } from "../context/GameContext.jsx";
import { useGameContext } from "../context/GameContext.jsx";
import { ClickButton } from "./ClickButton.jsx";

export function ButtonBox() {
  const { state } = useGameContext();

  return (
    <div className="flex items-center gap-4 mt-2 ml-2 mr-2 border border-gray-300 p-2 rounded-2xl">
      <ClickButton />

      <p>
        <b className="inline-flex items-center gap-1">
          LOC <HiMiniCodeBracket size={20} />:
        </b>{" "}
        {state.linesOfCode}
      </p>
      <p>
        <b className="inline-flex items-center gap-1">
          <LiaMoneyBillWaveAltSolid size={20} />:
        </b>{" "}
        ${state.money}
      </p>
      <p>
        <b className="inline-flex items-center gap-1">
          <MdOutlineEmojiPeople size={20} />:
        </b>{" "}
        {getTotalEmployeeCount(state)}
      </p>
    </div>
  );
}
