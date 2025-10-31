import { useState } from "react";

/**
 * Manages floating text animations that appear and fade away at arbitrary positions.
 *
 * This hook is general-purpose: use it for click feedback, passive income display,
 * tooltips, damage numbers, or any floating text animation.
 *
 * @returns {Object} Floating text management:
 *   - floatingTexts: Array of { id, text, icon, x, y }
 *   - triggerFloatingText: Function(x, y, text, icon?) - Show floating text at position
 *   - handleAnimationEnd: Function(id) - Remove floating text when animation ends
 *
 * @example
 * const { floatingTexts, triggerFloatingText, handleAnimationEnd } = useFloatingText();
 *
 * // Trigger from a click
 * triggerFloatingText(event.clientX, event.clientY, "+10 LOC", icon);
 *
 * // Trigger from a passive effect
 * triggerFloatingText(rect.left + rect.width/2, rect.top + rect.height/2, "+5 LOC", icon);
 */
export function useFloatingText() {
  const [floatingTexts, setFloatingTexts] = useState([]);

  const triggerFloatingText = (x, y, text, icon = null) => {
    // Create unique identifier for this floating text
    const id = Date.now() + Math.random();

    // Create floating text object with coordinates and content
    const newFloatingText = { id, text, icon, x, y };

    // Add to array (immutably) so React detects the change
    setFloatingTexts((prevTexts) => [...prevTexts, newFloatingText]);
  };

  const handleAnimationEnd = (id) => {
    // Remove the floating text from state when its animation completes
    setFloatingTexts((prevTexts) => prevTexts.filter((ft) => ft.id !== id));
  };

  return {
    floatingTexts,
    triggerFloatingText,
    handleAnimationEnd,
  };
}
