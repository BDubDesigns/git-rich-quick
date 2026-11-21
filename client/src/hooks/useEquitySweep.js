import { useEffect, useRef, useState } from "react";

/**
 * The Equity strip's sweep (issue #220): null, or the equity gain
 * record it is playing. Each new record (a new seq) restarts it. Never
 * on mount (a load, or the strip turned back on).
 */
export function useEquitySweep(gain) {
  const [sweep, setSweep] = useState(null);
  const seenSeq = useRef(gain?.seq ?? 0);
  useEffect(() => {
    if (!gain || gain.seq === seenSeq.current) return;
    seenSeq.current = gain.seq;
    setSweep(gain);
  }, [gain]);
  return sweep;
}
