import { calculateLOCPerClick, useGameContext } from "../context/GameContext";
import { HiMiniCodeBracket } from "react-icons/hi2";
import { useState } from "react";
import { FloatingText } from "./FloatingText";
import "./ClickButton.css";

export function ClickButton() {
  const { dispatch, state } = useGameContext();

  // State management for floating texts and bounce animation
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [bounceKey, setBounceKey] = useState(0);
  const [transformOrigin, setTransformOrigin] = useState("center center");

  const handleClick = (event) => {
    // Get click position
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;
    // Calculate transform origin for bounce effect
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    // create unique id for floating text
    const id = Date.now() + Math.random();
    // Create icon element
    const icon = <HiMiniCodeBracket size={20} />;
    // get loc per click value
    const locPerClick = calculateLOCPerClick(state);
    // Add new floating text
    const newFloatingText = { id, text: `+${locPerClick}`, icon, x, y };
    setFloatingTexts([...floatingTexts, newFloatingText]);

    // Store these values in state
    setTransformOrigin(`${x - rect.left}px ${y - rect.top}px`);
    setBounceKey(bounceKey + 1);

    // Dispatch the WRITE_CODE action
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
