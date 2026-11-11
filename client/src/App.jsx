import { useEffect, useRef, useState } from "react";
// Import game context
import { useGameContext } from "./context/useGameContext";
// Import game balance and LOC calculation
import { GAME_BALANCE_CONFIG } from "./context/gameConfig";
import { calculateLOCPerSecond } from "./context/gameLogic";
// Import save player id key (splash gating: a returning player has one)
import { PLAYER_ID_KEY } from "./save/api.js";
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
import { SplashScreen } from "./components/SplashScreen.jsx";
import { useMediaQuery } from "./hooks/useMediaQuery";

/** localStorage key for the splash dismissal (same `grq:` prefix as the
 *  player id). A device preference, never in the server save. */
const SPLASH_SEEN_KEY = "grq:splashSeen";

/**
 * First run? True only when there is no stored player id (no existing
 * save) AND the splash has never been dismissed. A returning player
 * with a save never sees the splash, even if they played before it
 * existed (no flag yet). Read synchronously at first render — before
 * the save engine's mount effect can mint a player — so a new user is
 * detected correctly.
 */
function shouldShowSplash() {
  try {
    if (typeof localStorage === "undefined") return false;
    if (localStorage.getItem(SPLASH_SEEN_KEY)) return false;
    return !localStorage.getItem(PLAYER_ID_KEY);
  } catch {
    return false;
  }
}

function App() {
  // Access game context
  const { dispatch, state } = useGameContext();
  // Create ref to hold current state without triggering re-runs
  const stateRef = useRef(state);

  // Splash screen (first run only): lazy initializer reads localStorage
  // synchronously at first render, before the save engine can mint a
  // player, so a new user is detected correctly. Dismissing it sets the
  // flag, so it never shows again on this device.
  const [showSplash, setShowSplash] = useState(shouldShowSplash);
  const dismissSplash = () => {
    try {
      localStorage.setItem(SPLASH_SEEN_KEY, "1");
    } catch {
      // Dismissal is best-effort in a storage-less environment; the
      // splash still hides for this session.
    }
    setShowSplash(false);
  };

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

  // First run: the splash replaces the whole game until `npm start`
  // dismisses it. The save engine still mints/loads in the background
  // (harmless for a fresh save — 0 LOC, no employees), so the game is
  // ready the moment the splash goes away.
  if (showSplash) {
    return <SplashScreen onStart={dismissSplash} />;
  }

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
