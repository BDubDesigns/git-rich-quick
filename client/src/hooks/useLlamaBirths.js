import { useEffect, useRef, useState } from "react";
import { badgeBumpAfter, birthsFreshOnMount } from "../utils/llamaBirths.js";

/** Calls `apply(record)` on each new record (a new seq); mount sees only `initial`. */
function useOnNewRecord(record, initial, apply) {
  const [value, setValue] = useState(initial);
  const seenSeq = useRef(record?.seq ?? 0);
  useEffect(() => {
    if (!record || record.seq === seenSeq.current) return;
    seenSeq.current = record.seq;
    setValue((current) => apply(current, record));
  }, [record, apply]);
  return value;
}

const latest = (_current, record) => record;

/**
 * The Farm's birth pops (issue #218): null, or the breed record whose
 * stalls are popping. Keyed on seq by the stalls, so a new result
 * restarts the pops. On mount only a fresh record pops.
 */
export function useBirthPops(record) {
  return useOnNewRecord(
    record,
    birthsFreshOnMount(record, Date.now()) ? record : null,
    latest
  );
}

/**
 * The Farm tab badge's bump key (issue #218): 0, or the seq of the
 * last breed result that raised the count. Never on mount (a load).
 */
export function useBadgeBump(record) {
  return useOnNewRecord(record, 0, badgeBumpAfter);
}
