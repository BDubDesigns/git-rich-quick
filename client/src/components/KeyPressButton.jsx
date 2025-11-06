import { useState } from "react";
import { FloatingText } from "./FloatingText";
import { useFloatingText } from "../hooks/useFloatingText.js";
import "./KeyPressButton.css";

/**
 * KeyPressButton Component
 *
 * A button component that detects key presses and mouse interactions,
 * displaying visual feedback for pressed/released states and triggering
 * floating text animations on click.
 *
 * @component
 * @param {Object} props - Component props
 * @param {Function} props.onClick - Callback function triggered on button click
 * @param {boolean} [props.disabled=false] - Whether the button is disabled
 * @param {React.ReactNode} props.children - Button label/content
 * @param {string} [props.floatText="+10"] - Text to display in floating animation
 * @param {React.ReactNode} [props.icon] - Icon to display in floating animation
 * @param {string} [props.variant="green"] - Button style variant ("green" or "blue")
 *
 * @returns {React.ReactElement} Button element with floating text animations
 *
 * @example
 * <KeyPressButton
 *   onClick={() => console.log('clicked')}
 *   floatText="+50"
 *   variant="blue"
 * >
 *   Click Me
 * </KeyPressButton>
 */
export function KeyPressButton({
  onClick,
  disabled = false,
  children,
  floatText = "+10",
  icon,
  variant = "green",
}) {
  const [isPressed, setIsPressed] = useState(false);
  const { floatingTexts, triggerFloatingText, handleAnimationEnd } =
    useFloatingText();

  const handleMouseDown = () => {
    setIsPressed(true);
  };

  const handleMouseUp = () => {
    setIsPressed(false);
  };

  const handleMouseLeave = () => {
    setIsPressed(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === " " || e.key === "Enter") {
      setIsPressed(true);
    }
  };

  const handleKeyUp = (e) => {
    if (e.key === " " || e.key === "Enter") {
      setIsPressed(false);
    }
  };

  const handleButtonClick = (event) => {
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;

    triggerFloatingText(x, y, floatText, icon);

    if (onClick) {
      onClick(event);
    }
  };

  return (
    <>
      <button
        onClick={handleButtonClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        disabled={disabled}
        className={`
          key-press-button
          ${
            variant === "blue"
              ? "key-press-button--blue"
              : "key-press-button--green"
          }
          ${
            isPressed
              ? "key-press-button--pressed"
              : "key-press-button--released"
          }
          ${disabled ? "key-press-button--disabled" : ""}
        `}
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
    </>
  );
}
