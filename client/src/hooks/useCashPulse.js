import { useEffect, useRef, useState } from "react";
import { cashPulseAfter } from "../utils/shipFeel.js";

/**
 * The shipping strip's Cash readout pulse (issue #219): 0, or the key
 * of the last bump. A tick that auto-shipped (a new record seq) bumps
 * it, at most once a second. Never on mount (a load).
 */
export function useCashPulse(record) {
  const [pulse, setPulse] = useState(null);
  const seenSeq = useRef(record?.seq ?? 0);
  useEffect(() => {
    if (!record || record.seq === seenSeq.current) return;
    seenSeq.current = record.seq;
    setPulse((current) => cashPulseAfter(current, record, Date.now()));
  }, [record]);
  return pulse?.key ?? 0;
}
