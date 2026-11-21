import { useSyncExternalStore } from "react";
import {
  EXIT_STAMP_TEXT,
  EXIT_STRIP_TEXT,
  endExitBeat,
  getExitBeat,
  subscribeExitBeat,
} from "../utils/exitBeat.js";
import "./ExitBeat.css";

/**
 * The exit beat (issue #215): the gold MERGED INTO main strip flash and
 * the ACQUIRED stamp, for 1.1s after a successful sale. Rendered beside
 * the App, so it lives across the switch from the game to the store
 * screen. Decoration only: aria-hidden, pointer-events none, and it
 * neither reads nor changes game state. The sale already happened.
 */
export function ExitBeatLayer() {
  const beat = useSyncExternalStore(subscribeExitBeat, getExitBeat, () => null);
  if (!beat) return null;
  const r = beat.stripRect;
  return (
    <>
      {r && (
        <div
          className="exit-strip"
          aria-hidden="true"
          style={{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }}
        >
          {EXIT_STRIP_TEXT}
        </div>
      )}
      <div className="exit-stamp-layer" aria-hidden="true">
        <div
          key={beat.id}
          className="exit-stamp"
          // The stamp's own animation is the whole beat; its end ends it.
          onAnimationEnd={() => endExitBeat(beat.id)}
        >
          {EXIT_STAMP_TEXT}
        </div>
      </div>
    </>
  );
}
