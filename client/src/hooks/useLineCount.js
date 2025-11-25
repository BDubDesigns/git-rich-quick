import { useState, useEffect, useRef } from "react";
import { countLines } from "../utils/commentBox.js";

export function useLineCount() {
  const elementRef = useRef(null);
  const [lines, setLines] = useState(0);

  useEffect(() => {
    const updateLineCount = () => {
      if (elementRef.current) {
        const count = countLines(elementRef.current);
        setLines(count);
      }
    };

    // calculate immediately on mount
    updateLineCount();

    // observe element size changes
    const resizeObserver = new ResizeObserver(updateLineCount);
    if (elementRef.current) {
      resizeObserver.observe(elementRef.current);
    }

    // cleanup observer on unmount
    return () => resizeObserver.disconnect();
  });

  // return ref and line count
  return {
    elementRef,
    lineCount: lines,
  };
}
