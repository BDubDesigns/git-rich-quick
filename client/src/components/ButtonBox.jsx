import { useGameContext } from "../context/GameContext.jsx";
import { ClickButton } from "./ClickButton.jsx";
export function ButtonBox() {
  const { state } = useGameContext();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
      }}
    >
      <ClickButton />
      <span>
        <p>
          <b>Lines of Code:</b> {state.linesOfCode}
        </p>
        <p>
          <b>Money:</b> ${state.money}
        </p>
      </span>
    </div>
  );
}
