import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { GameProvider } from "./context/GameContext.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { RotatePrompt } from "./components/RotatePrompt.jsx";
import "keyboard-css/dist/css/main.min.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <GameProvider>
        <App />
      </GameProvider>
      {/* Phone portrait lock (issue #194): CSS shows it in phone landscape. */}
      <RotatePrompt />
    </ErrorBoundary>
  </StrictMode>
);
