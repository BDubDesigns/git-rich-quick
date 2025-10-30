import { useState } from "react";

/**
 * Manages floating text animations and button bounce effects on click.
 *
 * @param {Function} onClickAction - Optional callback fired after animation setup.
 *                                   Called with (event) parameter.
 * @returns {Object} Animation state and handlers:
 *   - floatingTexts: Array of { id, text, icon, x, y }
 *   - bounceKey: Number (use as React key to force re-trigger)
 *   - transformOrigin: String (use as CSS style for bounce center)
 *   - handleClick: Function(event, floatText, icon) - Fire on button click
 *   - handleAnimationEnd: Function(id) - Fire when animation ends
 *
 * @example
 * const { floatingTexts, bounceKey, handleClick } = useClickAnimation(
 *   () => dispatch({ type: "MY_ACTION" })
 * );
 */
export function useClickAnimation(onClickAction) {
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [bounceKey, setBounceKey] = useState(0);
  const [transformOrigin, setTransformOrigin] = useState("center center");

  const handleClick = (event, floatText = "+1", icon = null) => {
    // Extract click coordinates from the browser event
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;

    // Get button element and its position
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();

    // Create unique identifier for this floating text
    const id = Date.now() + Math.random();

    // Create the floating text object
    const newFloatingText = { id, text: floatText, icon, x, y };

    // Add to floating texts array (immutably)
    setFloatingTexts([...floatingTexts, newFloatingText]);

    // Calculate transform origin relative to button
    setTransformOrigin(`${x - rect.left}px ${y - rect.top}px`);

    // Increment bounce key to force animation re-trigger
    setBounceKey(bounceKey + 1);

    // Call the parent's onClick handler (game action)
    if (onClickAction) {
      onClickAction(event);
    }
  };

  const handleAnimationEnd = (id) => {
    // Remove floating text with matching id from state
    setFloatingTexts(floatingTexts.filter((ft) => ft.id !== id));
  };

  return {
    floatingTexts,
    bounceKey,
    transformOrigin,
    handleClick,
    handleAnimationEnd,
  };
}
