import { useState } from "react";
import { FloatingText } from "./FloatingText";
import { useFloatingText } from "../hooks/useFloatingText.js";
import "./BouncyButton.css";

/**
 * BouncyButton
 *
 * A clickable button that briefly "bounces" (re-renders with a new key to retrigger CSS animation)
 * and triggers a floating text/graphic at the click coordinates via the useFloatingText hook.
 *
 * Clicking the button will:
 * - call the provided onClick handler (if any),
 * - invoke triggerFloatingText(x, y, floatText, icon) using the pointer coordinates,
 * - increment an internal bounce key to restart the button's CSS animation.
 *
 * The component also renders any active floating texts returned by useFloatingText and
 * forwards animation end events to the hook for cleanup.
 *
 * @param {Object} props - Component props.
 * @param {(event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void} [props.onClick] - Optional click handler invoked after floating text is triggered.
 * @param {boolean} [props.disabled=false] - When true, disables the button and prevents interaction.
 * @param {React.ReactNode} [props.children] - Content to display inside the button.
 * @param {string} [props.floatText="+10"] - Text to show in the floating text when the button is clicked.
 * @param {React.ReactNode} [props.icon] - Optional icon to include in the floating text element.
 * @param {"blue"|"green"} [props.variant="blue"] - Visual variant for the button; controls CSS class selection.
 * @returns {JSX.Element} The rendered button and any active FloatingText components.
 */

export function BouncyButton({
  onClick,
  disabled = false,
  children,
  floatText = "+10",
  icon,
  variant = "blue",
}) {
  const [bounceKey, setBounceKey] = useState(0);
  const [transformOrigin, setTransformOrigin] = useState("center");
  const { floatingTexts, triggerFloatingText, handleAnimationEnd } =
    useFloatingText();

  const handleButtonClick = (event) => {
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;

    // Calculate click position relative to the button element
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const relativeX = x - buttonRect.left;
    const relativeY = y - buttonRect.top;

    // Store transform origin for this click
    setTransformOrigin(`${relativeX}px ${relativeY}px`);

    triggerFloatingText(x, y, floatText, icon);
    setBounceKey((prev) => prev + 1);

    if (onClick) {
      onClick(event);
    }
  };

  return (
    <>
      <button
        key={bounceKey}
        onClick={handleButtonClick}
        disabled={disabled}
        style={{ transformOrigin }}
        className={`
          bouncy-button
          ${
            variant === "green" ? "bouncy-button--green" : "bouncy-button--blue"
          }
          ${disabled ? "bouncy-button--disabled" : ""}
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
