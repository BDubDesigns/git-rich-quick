import { useEffect } from "react";
import { useGameContext } from "./context/GameContext";
import { Header } from "./components/Header";
import { ButtonBox } from "./components/ButtonBox";
import { Shop } from "./components/Shop";
import { Projects } from "./components/Projects";
import { Footer } from "./components/Footer";
import { OpenSource } from "./components/OpenSource";
import { GAME_BALANCE_CONFIG } from "./context/GameContext";
import { getCurrentLOCPerSecond } from "./context/GameContext";

function App() {
  const { dispatch, state } = useGameContext();

  useEffect(() => {
    const interval = setInterval(() => {
      // Calculate LOC amount BEFORE dispatching
      const locAmount = getCurrentLOCPerSecond(state);

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
  }, [dispatch, state]);

  return (
    <div className="cascadia-font">
      <Header />
      <ButtonBox />

      <div className="flex justify-center gap-2 px-2">
        <Shop />
        <Projects />
      </div>
      <OpenSource />

      <br />
      <br />
      <br />
      {/* line breaks for the sticky footer gap at the bottom */}
      <Footer />
    </div>
  );
}

export default App;
