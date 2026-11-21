import { useEffect, useRef, useState } from "react";
import {
  EXIT_COUNT_UP_MS,
  exitCountUpActive,
  exitCountUpDelayMs,
  exitCountUpValue,
  getExitBeat,
} from "../utils/exitBeat.js";
import "./StatBump.css";
import "./ExitBeat.css";

/**
 * Equity spendable on the store screen (issue #215, step 4). Right
 * after a sale it holds the old value until the beat is over, counts up
 * to the new one over 700ms, lands exactly on it, and does one Slice 2
 * bump (StatBump.css). Any other time (a reload mid-intermission, a
 * purchase) it is just the number.
 */
export function ExitCountUp({ value }) {
  // The beat at mount: the store mounts as the sale lands.
  const [beat] = useState(() => {
    const live = getExitBeat();
    return exitCountUpActive(live, value, Date.now()) ? live : null;
  });
  const [shown, setShown] = useState(() => (beat ? Number(beat.fromEquity) : value));
  const [bumped, setBumped] = useState(false);
  // The count targets the live value (a purchase during the beat
  // spends Equity), so it always lands on what is actually spendable.
  const target = useRef(value);
  target.current = value;

  useEffect(() => {
    if (!beat) return undefined;
    let frame = 0;
    let startMs = null;
    const tick = (now) => {
      if (startMs === null) startMs = now;
      const t = (now - startMs) / EXIT_COUNT_UP_MS;
      setShown(exitCountUpValue(beat.fromEquity, target.current, t));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setBumped(true);
    };
    const wait = setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, exitCountUpDelayMs(beat, Date.now()));
    return () => {
      clearTimeout(wait);
      cancelAnimationFrame(frame);
    };
  }, [beat]);

  // Once the count is over, the live value (a purchase spends it).
  const text = beat && !bumped ? shown : value;
  return (
    <span
      className={`exit-count stat-value${bumped ? " stat-bump stat-bump--money" : ""}`}
      data-value={text}
    >
      {text}
    </span>
  );
}
