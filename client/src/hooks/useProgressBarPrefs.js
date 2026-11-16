import { useSyncExternalStore } from "react";
import {
  isProgressBarEnabled,
  subscribeProgressBarPrefs,
} from "../utils/progressBarPrefs.js";

/**
 * Whether one progress bar is shown (issue #128). Re-renders when the
 * player flips its toggle in Settings, and when another tab changes it
 * (the storage event), so every bar updates at once.
 */
export function useProgressBarEnabled(id) {
  return useSyncExternalStore(
    (onChange) => {
      const unsubscribe = subscribeProgressBarPrefs(onChange);
      const onStorage = (event) => {
        if (!event.key || event.key.startsWith("grq:progressBar:")) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        unsubscribe();
        window.removeEventListener("storage", onStorage);
      };
    },
    () => isProgressBarEnabled(id),
    () => true
  );
}
