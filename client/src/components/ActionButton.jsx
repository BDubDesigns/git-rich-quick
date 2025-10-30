import "./ClickButton.css";
import { FloatingText } from "./FloatingText.jsx";
import { useClickAnimation } from "../hooks/useClickAnimation";

export function ActionButton({
  onClick,
  disabled,
  children,
  floatText = "+10",
  icon,
}) {
  const {
    floatingTexts,
    bounceKey,
    transformOrigin,
    handleClick,
    handleAnimationEnd,
  } = useClickAnimation((event) => {
    if (onClick) {
      onClick(event);
    }
  });

  const handleButtonClick = (event) => {
    handleClick(event, floatText, icon);
  };

  return (
    <div className="flex justify-center w-full mt-auto">
      <button
        key={bounceKey}
        onClick={handleButtonClick}
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
          icon={floatingText.icon}
          onAnimationEnd={() => handleAnimationEnd(floatingText.id)}
        />
      ))}
    </div>
  );
}
