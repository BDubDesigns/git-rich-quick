import { calculateLOCPerClick, useGameContext } from "../context/GameContext";
import { HiMiniCodeBracket } from "react-icons/hi2";
import { KeyPressButton } from "./KeyPressButton";

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
  const { dispatch, state } = useGameContext();
  const locPerClick = calculateLOCPerClick(state);

  const handleClick = () => {
    dispatch({ type: "WRITE_CODE" });
  };

  return (
    <KeyPressButton
      onClick={handleClick}
      floatText={`+${locPerClick}`}
      icon={<HiMiniCodeBracket size={20} />}
      variant="green"
    >
      <span>Commit Code &nbsp;</span>
      <HiMiniCodeBracket size={24} />
    </KeyPressButton>
  );
}
