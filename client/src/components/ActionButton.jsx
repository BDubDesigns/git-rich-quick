import { useState } from "react";
//import clickbutton.css for the bounce effect
import "./ClickButton.css";
//import the FloatingText component
import { FloatingText } from "./FloatingText.jsx";
export function ActionButton({
  onClick,
  disabled,
  children,
  floatText = "+10",
}) {
  // State management for floating texts and bounce animation
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [bounceKey, setBounceKey] = useState(0);
  const [transformOrigin, setTransformOrigin] = useState("center center");
  const handleClick = (event) => {
    //  Extract click coordinates from the browser event
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;

    // Get button element and its position
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();

    // Create unique identifier for this floating text
    const id = Date.now() + Math.random();

    // Create the floating text object
    const newFloatingText = { id, text: floatText, x, y };

    // Add to floating texts array (immutably)
    setFloatingTexts([...floatingTexts, newFloatingText]);

    // Calculate transform origin relative to button
    setTransformOrigin(`${x - rect.left}px ${y - rect.top}px`);

    // Increment bounce key to force animation re-trigger
    setBounceKey(bounceKey + 1);

    // Call the parent's onClick handler (game action)
    if (onClick) {
      onClick(event);
    }
  };

  const handleAnimationEnd = (id) => {
    // Remove floating text with matching id from state
    setFloatingTexts(floatingTexts.filter((ft) => ft.id !== id));
  };
  return (
    <div className="flex justify-center w-full mt-auto">
      <button
        key={bounceKey}
        onClick={handleClick}
        disabled={disabled}
        style={{ transformOrigin }}
        className={`${
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "opacity-100 cursor-pointer"
        } p-1 border border-blue-800 rounded-md bg-blue-700 text-white hover:bg-blue-500 transition duration-150 ease-in-out button-bounce`}
      >
        {children}
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
    </div>
  );
}
