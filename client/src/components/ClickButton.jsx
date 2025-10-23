import { useGameContext } from "../context/GameContext";
import { HiMiniCodeBracket } from "react-icons/hi2";
import { useState } from "react";
import { FloatingText } from "./FloatingText";

export function ClickButton() {
  const { dispatch } = useGameContext();

  const [floatingTexts, setFloatingTexts] = useState([]);

  const handleClick = (event) => {
    // Get click position
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;

    // create unique id for floating text
    const id = Date.now() + Math.random();
    const newFloatingText = { id, text: "+10", x, y };
    setFloatingTexts([...floatingTexts, newFloatingText]);

    dispatch({ type: "WRITE_CODE" });
  };

  const handleAnimationEnd = (id) => {
    setFloatingTexts(floatingTexts.filter((ft) => ft.id !== id));
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="
        ml-2
        inline-flex items-center justify-center
        px-4 py-2
        border border-transparent
        text-sm font-bold leading-5
        rounded-md
        text-white
        bg-green-600
        hover:bg-green-700
        focus:outline-none 
        disabled:opacity-60 disabled:cursor-not-allowed
        transition ease-in-out duration-150
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
          onAnimationEnd={() => handleAnimationEnd(floatingText.id)}
        />
      ))}
    </>
  );
}
