import { useEffect, useRef } from "react";
// Import game context
import { useGameContext } from "./context/GameContext";
// Import game balance and LOC calculation
import { GAME_BALANCE_CONFIG } from "./context/GameContext";
import { calculateLOCPerSecond } from "./context/GameContext";
// Import components
import { Shop } from "./components/Shop";
import { Projects } from "./components/Projects";
import { OpenSource } from "./components/OpenSource";
import { GameLayout } from "./components/GameLayout";

function App() {
  // Access game context
  const { dispatch, state } = useGameContext();
  // Create ref to hold current state without triggering re-runs
  const stateRef = useRef(state);

  // Keep the ref updated whenever state changes
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Game tick effect
  useEffect(() => {
    const interval = setInterval(() => {
      // Calculate LOC amount BEFORE dispatching - use ref to get current state
      const locAmount = calculateLOCPerSecond(stateRef.current);

      // Dispatch the game tick
      dispatch({ type: "GAME_TICK" });

      // Emit animation event if there's passive LOC
      if (locAmount > 0) {
        window.dispatchEvent(
          new CustomEvent("gameTickAnimation", {
            detail: { amount: locAmount },
          })
        );
      }
    }, GAME_BALANCE_CONFIG.TICK_INTERVAL);

    return () => clearInterval(interval);
  }, [dispatch]);

  return (
    <GameLayout>
      <div className="flex justify-center gap-2 px-2">
        <Shop />
        <Projects />
      </div>
      <OpenSource />
    </GameLayout>
  );
}

export default App;
