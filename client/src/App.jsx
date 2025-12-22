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
import { useMediaQuery } from "./hooks/useMediaQuery";

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
  // Local state to manage active tab (employees, projects, upgrades)
  // Detect desktop screen size
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  return (
    <GameLayout>
      {isDesktop ? (
        // Desktop: 3-pane grid layout
        <div className="grid grid-cols-3 gap-4 h-full">
          {/* Left pane: Always Shop */}
          <div className="overflow-y-auto">
            <Shop />
          </div>

          {/* Center pane: Dynamic (controlled by activeTab) */}
          <div className="overflow-y-auto">
            {state.activeTab === "shop" && <Shop />}
            {state.activeTab === "projects" && <Projects />}
            {state.activeTab === "openSource" && <OpenSource />}
            {/* Email and Settings can be added here later */}
          </div>

          {/* Right pane: Always Projects */}
          <div className="overflow-y-auto">
            <Projects />
          </div>
        </div>
      ) : (
        // Mobile: Single pane (current behavior, unchanged)
        <div>
          {state.activeTab === "shop" && <Shop />}
          {state.activeTab === "projects" && <Projects />}
          {state.activeTab === "openSource" && <OpenSource />}
          {/* Email and Settings can be added here later */}
        </div>
      )}
    </GameLayout>
  );
}

export default App;
