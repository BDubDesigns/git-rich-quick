import { useState, useEffect } from "react";

/**
 * Custom hook to detect if a media query matches.
 * Useful for conditional rendering based on screen size.
 * @param {string} query - CSS media query string (e.g., "(min-width: 1024px)")
 * @returns {boolean} True if media query matches, false otherwise
 */

export function useMediaQuery(query) {
  // Initialize with current match state
  const [matches, setMatches] = useState(() => {
    // Check if window exists (to support SSR)
    if (typeof window !== "undefined") {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    // Create media query listener
    const mediaQuery = window.matchMedia(query);

    // Callback for when media query status changes
    const handleChange = (event) => {
      setMatches(event.matches);
    };

    // Set initial value (in case it changed between render and effect)
    setMatches(mediaQuery.matches);

    // Add listener
    mediaQuery.addEventListener("change", handleChange);

    // Cleanup listener on unmount
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [query]);

  return matches;
}
