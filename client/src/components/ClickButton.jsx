import { useGameContext } from "../context/GameContext";
import { HiMiniCodeBracket } from "react-icons/hi2";
import { useState } from "react";
import { FloatingText } from "./FloatingText";
import "./ClickButton.css";

export function ClickButton() {
  const { dispatch } = useGameContext();

  // State management for floating texts and bounce animation
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [bounceKey, setBounceKey] = useState(0);

  const handleClick = (event) => {
    // Get click position
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;

    // create unique id for floating text
    const id = Date.now() + Math.random();
    const newFloatingText = { id, text: "+10", x, y };
    setFloatingTexts([...floatingTexts, newFloatingText]);
    setBounceKey(bounceKey + 1);
    dispatch({ type: "WRITE_CODE" });
  };

  // Remove floating text after animation ends
  const handleAnimationEnd = (id) => {
    setFloatingTexts(floatingTexts.filter((ft) => ft.id !== id));
  };

  return (
    <>
      {/* We set a key and increment it each click so that the button re-renders and re-triggers the animation on each click */}
      <button
        key={bounceKey}
        onClick={handleClick}
        className="
        ml-2
        inline-flex items-center justify-center
        px-4 py-2
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
          onAnimationEnd={() => handleAnimationEnd(floatingText.id)}
        />
      ))}
    </>
  );
}
