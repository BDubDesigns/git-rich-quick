import { useEffect, useState } from "react";
import { PRODUCTION_TICK_EVENT } from "../utils/tickBar.js";

/**
 * The header tick bar's key (issue #229): 0 until the first production
 * tick, then a new number on every tick that credits passive LOC. The
 * bar and the LOC flash key on it, so each tick restarts them.
 */
export function useProductionTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onTick = () => setTick((n) => n + 1);
    window.addEventListener(PRODUCTION_TICK_EVENT, onTick);
    return () => window.removeEventListener(PRODUCTION_TICK_EVENT, onTick);
  }, []);
  return tick;
}
