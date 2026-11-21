import { useEffect, useRef, useState } from "react";
import { versionRollAfter, versionRollFreshOnMount } from "../utils/versionRoll.js";

/**
 * The version roll for one Open Source card (issue #216): null, or the
 * contribution ({ from, to, seq }) the card is rolling. The card keys
 * the roll on seq, so a new contribution remounts it and restarts the
 * roll instead of stacking. On mount it rolls only a FRESH contribution
 * of its own (the card moved into Maxed Out); an old one never replays.
 */
export function useVersionRoll(contribution, projectId) {
  const [roll, setRoll] = useState(() =>
    versionRollFreshOnMount(contribution, projectId, Date.now()) ? contribution : null
  );
  const seenSeq = useRef(contribution?.seq ?? 0);
  useEffect(() => {
    if (!contribution || contribution.seq === seenSeq.current) return;
    seenSeq.current = contribution.seq;
    setRoll((current) => versionRollAfter(current, contribution, projectId));
  }, [contribution, projectId]);
  return roll;
}
