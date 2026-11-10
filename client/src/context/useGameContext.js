/**
 * The `useGameContext` hook, in its own module so GameContext.jsx only
 * exports the context object and the provider component (react-refresh).
 */

import { useContext } from "react";
import { GameContext } from "./gameContext.js";

// Custom hook to use the GameContext
export function useGameContext() {
  const context = useContext(GameContext);

  if (!context) {
    throw new Error("useGameContext must be used within a GameProvider");
  }

  return context;
}
