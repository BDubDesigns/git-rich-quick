import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { GameProvider } from "./context/GameContext.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { RotatePrompt } from "./components/RotatePrompt.jsx";
import { ExitBeatLayer } from "./components/ExitBeatLayer.jsx";
import "keyboard-css/dist/css/main.min.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <GameProvider>
        <App />
      </GameProvider>
      {/* The exit beat (issue #215): beside the App, so it lives
          across the switch from the game to the store screen. */}
      <ExitBeatLayer />
      {/* Phone portrait lock (issue #194): CSS shows it in phone landscape. */}
      <RotatePrompt />
    </ErrorBoundary>
  </StrictMode>
);
