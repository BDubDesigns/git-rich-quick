import { useEffect } from "react";
import { HiMiniCodeBracket } from "react-icons/hi2";
import { useFloatingText } from "../hooks/useFloatingText.js";
import { FloatingText } from "./FloatingText.jsx";

/**
 * PassiveAnimationLayer
 *
 * Renders floating text animations that appear above the Passive LOC Generation when passive LOC is generated.
 * Listens for custom "gameTickAnimation" events and triggers floating text animations with the
 * amount of LOC generated per second.
 *
 * @param {Object} props - Component props
 * @param {React.RefObject} props.locPerSecondRef - Reference to the CPS meter element for positioning animations
 */
export function PassiveAnimationLayer({ locPerSecondRef }) {
  // Get floating text management functions from the custom hook
  const { floatingTexts, triggerFloatingText, handleAnimationEnd } =
    useFloatingText();

  // Listen for game tick animation events and trigger floating text
  useEffect(() => {
    const handleGameTick = (event) => {
      const { amount } = event.detail;

      // Use the ref passed from parent to position floating text
      if (locPerSecondRef.current) {
        // Get the bounding rectangle of the CPS meter to calculate animation start position
        const rect = locPerSecondRef.current.getBoundingClientRect();
        // Position the floating text near the top-left of the CPS meter
        const startX = rect.left;
        const startY = rect.top + 20;

        // Create a code bracket icon to display alongside the LOC amount
        const icon = <HiMiniCodeBracket size={20} color="gray" />;
        // Trigger the floating text animation with the LOC amount and icon
        triggerFloatingText(startX, startY, `+${amount}`, icon);
      }
    };

    // Register listener for custom gameTickAnimation events
    window.addEventListener("gameTickAnimation", handleGameTick);
    // Clean up event listener on component unmount or dependency change
    return () =>
      window.removeEventListener("gameTickAnimation", handleGameTick);
  }, [triggerFloatingText, locPerSecondRef]);

  return (
    <>
      {/* Render all active floating text animations */}
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
