import { useCallback, useState } from "react";
import { addClaimPop, claimPop } from "../utils/claimPop.js";

/**
 * The live claim pops (issue #213): at most MAX_CLAIM_POPS, newest
 * last. triggerClaimPop(claim, x, y) adds one at the star's center (a
 * third replaces the oldest); handleClaimPopEnd(id) removes it when its
 * 420ms life ends.
 */
export function useClaimPops() {
  const [claimPops, setClaimPops] = useState([]);

  const triggerClaimPop = useCallback((claim, x, y) => {
    const pop = { ...claimPop(claim, x, y), id: Date.now() + Math.random() };
    setClaimPops((prev) => addClaimPop(prev, pop));
  }, []);

  const handleClaimPopEnd = useCallback((id) => {
    setClaimPops((prev) => prev.filter((pop) => pop.id !== id));
  }, []);

  return { claimPops, triggerClaimPop, handleClaimPopEnd };
}
