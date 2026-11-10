import { useState } from "react";
import { FloatingText } from "./FloatingText";
import { useFloatingText } from "../hooks/useFloatingText.js";
import { Button } from "./Button.jsx";
import "./BouncyButton.css";

/**
 * BouncyButton
 *
 * A game-action button: the shared Button visual, plus a bounce (the
 * button remounts with a new key on each click, replaying the CSS
 * animation) and floating text at the click coordinates.
 *
 * The visual lives in Button (one place); this component only adds the
 * behavior. Plain buttons (Settings, LOCKED cards, the bulk-buy
 * selector) use Button directly and get no bounce or floating text.
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
 * @param {string} [props.className=""] - Extra classes forwarded to Button (layout only, e.g. shrink-0).
 * @returns {JSX.Element} The rendered button and any active FloatingText components.
 */

export function BouncyButton({
  onClick,
  disabled = false,
  children,
  floatText = "+10",
  icon,
  className = "",
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
      <Button
        key={bounceKey}
        onClick={handleButtonClick}
        disabled={disabled}
        style={{ transformOrigin }}
        className={`bouncy-button ${className}`}
      >
        {children}
      </Button>

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
