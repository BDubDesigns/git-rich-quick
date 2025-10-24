import { useEffect } from "react";
import { useGameContext } from "./context/GameContext";
import { Header } from "./components/Header";
import { ButtonBox } from "./components/ButtonBox";
import { Shop } from "./components/Shop";
import { Projects } from "./components/Projects";
import { Footer } from "./components/Footer";
import { OpenSource } from "./components/openSource";

function App() {
  const { dispatch, state } = useGameContext();

  useEffect(() => {
    // Set up a game tick every 1000ms
    const interval = setInterval(() => {
      dispatch({ type: "GAME_TICK" });
    }, 1000);

    // Cleanup function to prevent memory leaks
    return () => clearInterval(interval);
  }, [dispatch]);

  return (
    <div>
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
