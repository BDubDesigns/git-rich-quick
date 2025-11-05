import { ClickButton } from "./ClickButton.jsx";
import { CPSMeter } from "./CPSMeter.jsx";

/**
 * ClickSection
 *
 * Container for the main click button and CPS meter.
 *
 * This is separated because:
 * 1. Groups related UI (clicking and click-based stats)
 * 2. Reduces visual clutter in ButtonBox
 * 3. Makes the intent clearer (this is the "click area")
 *
 * @param {number} locPerClick - Lines of code earned per click
 * @returns {React.ReactNode} - The click section UI
 */
export function ClickSection({ locPerClick }) {
  return (
    <div className="flex-2 flex flex-col items-center">
      <p>LOC Per Click: {locPerClick}</p>
      <ClickButton />
      <CPSMeter />
    </div>
  );
}
