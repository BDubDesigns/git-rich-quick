import { useState } from "react";

/**
 * Manages button bounce (scale) animations triggered on click.
 *
 * This hook is specific to clickable buttons that need a "press" animation.
 * Use this when you want a button to scale/bounce when clicked.
 *
 * @param {Function} onClickAction - Optional callback fired after animation setup.
 *                                   Called with (event) parameter.
 *                                   Use for dispatching game actions.
 *
 * @returns {Object} Button bounce management:
 *   - bounceKey: Number (use as React key to force re-render and re-trigger CSS animation)
 *   - transformOrigin: String (use as CSS style on button element)
 *   - handleClick: Function(event) - Call from button onClick handler
 *
 * @example
 * const { bounceKey, transformOrigin, handleClick } = useButtonBounce(() => {
 *   dispatch({ type: "MY_ACTION" });
 * });
 *
 * return (
 *   <button
 *     key={bounceKey}
 *     onClick={handleClick}
 *     style={{ transformOrigin }}
 *     className="button-bounce"
 *   >
 *     Click me
 *   </button>
 * );
 */
export function useButtonBounce(onClickAction) {
  const [bounceKey, setBounceKey] = useState(0);
  const [transformOrigin, setTransformOrigin] = useState("center center");

  const handleClick = (event) => {
    // Extract click coordinates from the browser event
    const x = event.nativeEvent.clientX;
    const y = event.nativeEvent.clientY;

    // Get button element and its bounding box
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();

    // Calculate transform origin relative to button (where bounce emanates from)
    setTransformOrigin(`${x - rect.left}px ${y - rect.top}px`);

    // Increment bounce key to force React to re-mount and re-trigger CSS animation
    setBounceKey((prev) => prev + 1);

    // Call parent's callback (e.g., game action dispatch)
    if (onClickAction) {
      onClickAction(event);
    }
  };

  return {
    bounceKey,
    transformOrigin,
    handleClick,
  };
}
