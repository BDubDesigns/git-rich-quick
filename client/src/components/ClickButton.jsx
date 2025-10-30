import { calculateLOCPerClick, useGameContext } from "../context/GameContext";
import { HiMiniCodeBracket } from "react-icons/hi2";
import { FloatingText } from "./FloatingText";
import { useClickAnimation } from "../hooks/useClickAnimation.js";
import "./ClickButton.css";

export function ClickButton() {
  const { dispatch, state } = useGameContext();

  const {
    floatingTexts,
    bounceKey,
    transformOrigin,
    handleClick,
    handleAnimationEnd,
  } = useClickAnimation((event) => {
    dispatch({ type: "WRITE_CODE" });
  });

  const handleButtonClick = (event) => {
    const locPerClick = calculateLOCPerClick(state);
    const icon = <HiMiniCodeBracket size={20} />;
    handleClick(event, `+${locPerClick}`, icon);
  };

  return (
    <>
      <button
        key={bounceKey}
        onClick={handleButtonClick}
        style={{ transformOrigin }}
        className="
        select-none
        cursor-pointer
        inline-flex items-center justify-center
        px-4 py-2 ml-2
        border border-transparent
        text-sm font-bold leading-5
        rounded-md
        text-white
        bg-green-700
        hover:bg-green-500
        focus:outline-none 
        disabled:opacity-60 disabled:cursor-not-allowed
        transition ease-in-out duration-150
        button-bounce
      "
      >
        <span>Commit Code &nbsp;</span>
        <HiMiniCodeBracket size={24} />
      </button>
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
