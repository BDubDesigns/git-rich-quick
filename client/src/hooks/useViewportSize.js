import { useEffect, useState } from "react";
import { windowViewport } from "../utils/starViewport.js";

/**
 * The current window viewport ({ width, height }), updated on resize and
 * on orientation change (issue #194). Some Android browsers fire
 * orientationchange before the new size is reported, so that event is
 * re-read on the next frame too.
 */
export function useViewportSize() {
  const [viewport, setViewport] = useState(windowViewport);
  useEffect(() => {
    let frame = null;
    const update = () => setViewport(windowViewport());
    const onOrientation = () => {
      update();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", onOrientation);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", onOrientation);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
  return viewport;
}
