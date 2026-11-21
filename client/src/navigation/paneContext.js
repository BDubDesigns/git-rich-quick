import { createContext, useContext } from "react";

/**
 * Which pane a section is rendering in (issue #174): { pane, desktop }.
 * pane is "left", "center" or "right"; desktop says whether the pane
 * picker exists (it is desktop only). Outside any Pane (a test, a
 * stray render) it reads as the mobile center: no picker.
 */
export const PaneContext = createContext({ pane: "center", desktop: false });

/** The pane this section renders in. */
export function usePane() {
  return useContext(PaneContext);
}
