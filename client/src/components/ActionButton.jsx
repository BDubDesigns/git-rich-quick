import "./ClickButton.css";
import { FloatingText } from "./FloatingText.jsx";
import { useFloatingText } from "../hooks/useFloatingText.js";

export function ActionButton({
  onClick,
  disabled,
  children,
  floatText = "+10",
  icon,
}) {
  // Initialize floating text hook
  const { floatingTexts, triggerFloatingText, handleAnimationEnd } =
    useFloatingText();

  const handleButtonClick = (event) => {
    // Extract click coordinates
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;

    // Trigger floating text at click position
    triggerFloatingText(x, y, floatText, icon);

    // Call parent's onClick handler
    if (onClick) {
      onClick(event);
    }
  };

  return (
    <div className="flex justify-center w-full mt-auto">
      <button
        onClick={handleButtonClick}
        disabled={disabled}
        className={`${
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "opacity-100 cursor-pointer"
        } p-1 border border-blue-800 rounded-md bg-blue-700 text-white hover:bg-blue-500 transition duration-150 ease-in-out`}
      >
        {children}
      </button>

      {/* Render floating text animations */}
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
    </div>
  );
}
