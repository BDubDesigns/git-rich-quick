// Progress bar toggles (issue #128): one switch per progress bar, in
// Settings next to the other display preferences. Each choice is a
// device preference (localStorage, like the sound volume), never in
// the server save, and every bar defaults to shown. Flipping a toggle
// updates the bar everywhere at once (utils/progressBarPrefs.js
// notifies every subscriber).

import { PROGRESS_BARS, setProgressBarEnabled } from "../utils/progressBarPrefs.js";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";
import { Panel } from "./Panel.jsx";

export function ProgressBarSettings() {
  return (
    <Panel as="section" className="flex flex-col gap-2 p-3">
      <h3 className="m-0 text-sm text-[#cccccc]">Progress bars</h3>
      <p className="m-0 text-xs">
        Pick which progress bars you want to see. Stored on this device
        only. The cyan chevron next to the star bars still folds the
        star bars away whenever you want them out of sight.
      </p>
      {PROGRESS_BARS.map((bar) => (
        <ProgressBarToggle key={bar.id} bar={bar} />
      ))}
    </Panel>
  );
}

/** One bar's toggle: a checkbox, its name, and what it controls. */
function ProgressBarToggle({ bar }) {
  const enabled = useProgressBarEnabled(bar.id);
  const inputId = `progress-bar-toggle-${bar.id}`;
  return (
    <div className="flex items-start gap-2">
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 accent-[#0078d4]"
        checked={enabled}
        onChange={(event) => setProgressBarEnabled(bar.id, event.target.checked)}
      />
      <label htmlFor={inputId} className="m-0 flex flex-col text-xs">
        <span className="text-[#cccccc]">{bar.label}</span>
        <span className="text-gray-400">{bar.description}</span>
      </label>
    </div>
  );
}
