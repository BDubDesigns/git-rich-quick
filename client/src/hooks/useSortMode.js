import { useSyncExternalStore } from "react";
import {
  DEFAULT_SORT_MODE,
  readSortMode,
  setSortMode,
  subscribeSortModes,
} from "../utils/sortModes.js";

/**
 * A tab's sort mode (issues #180, #181) and its setter. Re-renders
 * when the control changes it, and when another browser tab does (the
 * storage event). The one hook every sorted tab and SortControl read.
 */
export function useSortMode(tab) {
  const mode = useSyncExternalStore(
    (onChange) => {
      const unsubscribe = subscribeSortModes(onChange);
      const onStorage = (event) => {
        if (!event.key || event.key.startsWith("grq:sortMode:")) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        unsubscribe();
        window.removeEventListener("storage", onStorage);
      };
    },
    () => readSortMode(tab),
    () => DEFAULT_SORT_MODE
  );
  return [mode, (next) => setSortMode(tab, next)];
}
