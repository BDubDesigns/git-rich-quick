import { useEffect, useRef, useState } from "react";
import { statGainFreshOnMount, statPulseAfter } from "../utils/statGain.js";

/**
 * The bump pulse for one header stat (issue #214). Returns 0 (no bump)
 * or the seq of the latest gain that flagged `key`; the stat keys its
 * value on it, so each new gain remounts the value and restarts the
 * bump instead of stacking a second one.
 *
 * On mount it bumps only for a FRESH gain (the header returning after
 * the intermission, with the Starting Capital grant); an old gain never
 * replays.
 */
export function useStatBump(gain, key) {
  const [pulse, setPulse] = useState(() =>
    statGainFreshOnMount(gain, key, Date.now()) ? gain.seq : 0
  );
  const seenSeq = useRef(gain?.seq ?? 0);
  useEffect(() => {
    if (!gain || gain.seq === seenSeq.current) return;
    seenSeq.current = gain.seq;
    setPulse((current) => statPulseAfter(current, gain, key));
  }, [gain, key]);
  return pulse;
}
