import { calculateLOCPerClick } from "../context/gameLogic";
import { useGameContext } from "../context/useGameContext";
import { HiMiniCodeBracket } from "react-icons/hi2";
import { KeyPressButton } from "./KeyPressButton";
import { formatNumber } from "../../../shared/formatNumber.js";

/**
 * ClickButton component that dispatches a WRITE_CODE action when clicked.
 * Displays the lines of code earned per click and renders a commit button with code icon.
 *
 * @component
 * @returns {React.ReactElement} A KeyPressButton component with commit action
 *
 * @example
 * return <ClickButton />
 */
export function ClickButton() {
  const { dispatch, state, measureTapLatency } = useGameContext();
  const locPerClick = calculateLOCPerClick(state);

  const handleClick = (event) => {
    // Tap-latency diagnostics (PR #101): measure the tap before the
    // dispatch, so the captured context (star on screen, save status)
    // is the pre-tap state. The instrument counts the tap and checks
    // the frame after the dispatch, when the new LOC is painted.
    // event.timeStamp is when the browser created the tap event; a
    // missing event falls back to the handler time inside the
    // instrument. This call only records; the game plays identically.
    measureTapLatency(event?.timeStamp);
    dispatch({ type: "WRITE_CODE" });
  };

  return (
    <KeyPressButton
      onClick={handleClick}
      floatText={`+${formatNumber(locPerClick)}`}
      icon={<HiMiniCodeBracket size={20} />}
      variant="green"
    >
      <span>Commit Code &nbsp;</span>
      <HiMiniCodeBracket size={24} />
    </KeyPressButton>
  );
}
