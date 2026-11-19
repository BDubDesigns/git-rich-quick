import { SORT_MODES } from "../utils/sortModes.js";
import { useSortMode } from "../hooks/useSortMode.js";
import { Button } from "./Button.jsx";

/**
 * The Default / Cheapest sort control (issues #180, #181): the ONE
 * control every sorted tab renders, with its own tab id so each tab
 * remembers its own mode (a device preference, never save data). The
 * tab reads the same mode through useSortMode and hands it to its
 * ordering helper.
 *
 * Styled like the Hire tab's bulk-buy selector: the selected mode is
 * the plain bright Button, the other is the darker inactive member of
 * the group (the nav's convention).
 */
export function SortControl({ tab }) {
  const [mode, setMode] = useSortMode(tab);
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Sort order"
      data-sort-control={tab}
    >
      <span className="text-xs text-gray-400">Sort:</span>
      {SORT_MODES.map((option) => (
        <Button
          key={option.id}
          onClick={() => setMode(option.id)}
          className={mode === option.id ? "" : "game-button--inactive"}
          ariaPressed={mode === option.id}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
