import { useEffect, useRef, useState } from "react";
// Import game context
import { useGameContext } from "./context/useGameContext";
// Import game balance and LOC calculation
import { GAME_BALANCE_CONFIG } from "./context/gameConfig";
import { calculateTickCredit } from "./context/gameLogic";
// Import save player id key (splash gating: a returning player has one)
import { PLAYER_ID_KEY } from "./save/api.js";
// Import components
import { GameLayout } from "./components/GameLayout";
import { Pane } from "./components/Pane.jsx";
import { GoldenStar } from "./components/GoldenStar";
import { SplashScreen } from "./components/SplashScreen.jsx";
import { IntermissionScreen } from "./components/IntermissionScreen.jsx";
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
      // Calculate the tick credit BEFORE dispatching - use ref to get
      // current state. SUBTRACTERALL (Slice 3): the floating text
      // shows what the tick actually credits (3x in a burst, 0.25x
      // in a withdrawal), not the healthy rate — calculateTickCredit
      // runs the same shared advance function as the reducer, so the
      // display and the balance can never disagree.
      // Store-only intermission (issue #188): no tick at all while the
      // intermission is open (the reducer refuses it anyway).
      if (stateRef.current.prestigeIntermission) return;
      const locAmount = calculateTickCredit(stateRef.current);

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
  // Detect desktop screen size. The reducer holds the layout mode
  // (issue #174: it decides which sections are on screen, which the
  // new-mail notification and the Farm badge read), so the media
  // query is reported to it, and the panes render from it.
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  useEffect(() => {
    dispatch({
      type: "SET_LAYOUT_MODE",
      payload: { mode: isDesktop ? "desktop" : "mobile" },
    });
  }, [isDesktop, dispatch]);
  const desktop = state.layoutMode === "desktop";

  // First run: the splash replaces the whole game until `npm start`
  // dismisses it. The save engine still mints/loads in the background
  // (harmless for a fresh save — 0 LOC, no employees), so the game is
  // ready the moment the splash goes away.
  if (showSplash) {
    return <SplashScreen onStart={dismissSplash} />;
  }

  // Store-only intermission (issue #188): after a sale, the permanent
  // store and its Start the next company action are the whole screen
  // until the next company starts. No tabs, no Commit Code, no stars.
  if (state.prestigeIntermission) {
    return <IntermissionScreen />;
  }

  return (
    <GameLayout>
      {/* Golden star (GitNub Constellation): fixed-positioned, spawns on
          its own timer when the player has a Constellation level. */}
      <GoldenStar />
      {desktop ? (
        // Desktop (issue #174): three panes, three different sections.
        // The side panes are pinned (the pane picker on their title
        // bars changes them); the center is activeTab (the nav, email
        // links and the picker change it). Each section owns its own
        // scroller and pinned title bar (SectionLayout).
        <div className="grid grid-cols-3 gap-4 h-full">
          <Pane position="left" desktop />
          <Pane position="center" desktop />
          <Pane position="right" desktop />
        </div>
      ) : (
        // Mobile: one pane, the nav's section, with its title bar
        // pinned the same way. No picker: the nav is the picker.
        <Pane position="center" desktop={false} />
      )}
    </GameLayout>
  );
}

export default App;
