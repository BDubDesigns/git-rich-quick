import { FloatingText } from "./FloatingText";
import { useFloatingText } from "../hooks/useFloatingText.js";
import "./KeyPressButton.css";

/**
 * KeyPressButton Component
 *
 * A button component that triggers floating text animations on click.
 * Keyboard-css provides built-in pressed state styling.
 *
 * @component
 * @param {Object} props - Component props
 * @param {Function} props.onClick - Callback function triggered on button click
 * @param {boolean} [props.disabled=false] - Whether the button is disabled
 * @param {React.ReactNode} props.children - Button label/content
 * @param {string} [props.floatText="+10"] - Text to display in floating animation
 * @param {React.ReactNode} [props.icon] - Icon to display in floating animation
 *
 * @returns {React.ReactElement} Button element with floating text animations
 *
 * @example
 * <KeyPressButton
 *   onClick={() => console.log('clicked')}
 *   floatText="+50"
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
}) {
  const { floatingTexts, triggerFloatingText, handleAnimationEnd } =
    useFloatingText();

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
        disabled={disabled}
        className="kbc-button kbc-button-lg"
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
