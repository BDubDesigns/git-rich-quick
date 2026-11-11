import { useEffect, useRef } from "react";
// Import game context
import { useGameContext } from "./context/useGameContext";
// Import game balance and LOC calculation
import { GAME_BALANCE_CONFIG } from "./context/gameConfig";
import { calculateLOCPerSecond } from "./context/gameLogic";
// Import components
import { Shop } from "./components/Shop";
import { Projects } from "./components/Projects";
import { OpenSource } from "./components/OpenSource";
import { Farm } from "./components/Farm";
import { Settings } from "./components/Settings";
import { Leaderboard } from "./components/Leaderboard";
import { Email } from "./components/Email";
import { GameLayout } from "./components/GameLayout";
import { ScrollAffordanceFrame } from "./components/ScrollAffordances.jsx";
import { GoldenStar } from "./components/GoldenStar";
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
      {/* Golden star (GitNub Constellation): fixed-positioned, spawns on
          its own timer when the player has a Constellation level. */}
      <GoldenStar />
      {isDesktop ? (
        // Desktop: 3-pane grid layout. Each pane is a
        // ScrollAffordanceFrame: the pane scrolls on its own and the
        // up/down arrows (RuneSpace #345 pattern) sit on its visible
        // box, so a pane whose content hides above or below says so.
        <div className="grid grid-cols-3 gap-4 h-full">
          {/* Left pane: Always Shop */}
          <ScrollAffordanceFrame
            scrollerClassName="h-full overflow-y-auto"
            className="min-h-0"
          >
            <Shop />
          </ScrollAffordanceFrame>

          {/* Center pane: Dynamic (controlled by activeTab). Shop and
              Projects are NOT rendered here — they live in the fixed side
              panes, and rendering them here duplicated them (Shop showed
              in the left and center panes, Projects in the center and
              right). When the active tab is Shop or Projects, the center
              falls back to Open Source so the pane is never empty. */}
          <ScrollAffordanceFrame
            scrollerClassName="h-full overflow-y-auto"
            className="min-h-0"
          >
            {state.activeTab === "openSource" && <OpenSource />}
            {(state.activeTab === "shop" ||
              state.activeTab === "projects") && <OpenSource />}
            {state.activeTab === "farm" && <Farm />}
            {state.activeTab === "settings" && <Settings />}
            {state.activeTab === "leaderboard" && <Leaderboard />}
            {state.activeTab === "email" && <Email />}
          </ScrollAffordanceFrame>

          {/* Right pane: Always Projects */}
          <ScrollAffordanceFrame
            scrollerClassName="h-full overflow-y-auto"
            className="min-h-0"
          >
            <Projects />
          </ScrollAffordanceFrame>
        </div>
      ) : (
        // Mobile: Single pane (current behavior, unchanged)
        <div>
          {state.activeTab === "shop" && <Shop />}
          {state.activeTab === "projects" && <Projects />}
          {state.activeTab === "openSource" && <OpenSource />}
          {state.activeTab === "farm" && <Farm />}
          {state.activeTab === "settings" && <Settings />}
          {state.activeTab === "leaderboard" && <Leaderboard />}
          {state.activeTab === "email" && <Email />}
        </div>
      )}
    </GameLayout>
  );
}

export default App;
