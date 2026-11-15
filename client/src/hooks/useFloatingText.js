import { useState } from "react";

// At most this many floats alive at once (issue #106). At high tap
// rates a new float arrives every ~180ms while each one lives ~1.25s,
// so without a cap they pile into a dense cluster over the header
// stats, the Clicks/sec label, and hire buttons. When a new float
// arrives past the cap, the oldest is dropped early. It just
// disappears from the DOM, and its animation-end is a no-op.
const MAX_FLOATING_TEXTS = 6;

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

    // Add to array (immutably) so React detects the change. Keep only
    // the newest MAX_FLOATING_TEXTS, so a burst of taps cannot pile
    // up an unbounded cluster (issue #106).
    setFloatingTexts((prevTexts) =>
      [...prevTexts, newFloatingText].slice(-MAX_FLOATING_TEXTS)
    );
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
