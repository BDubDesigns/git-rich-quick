import { createContext } from "react";

// The raw context object, in its own module so GameContext.jsx only
// exports the provider component — react-refresh requires React
// context(s) to live in a separate file from components.
export const GameContext = createContext();
