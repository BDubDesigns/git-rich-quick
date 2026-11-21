import { useCallback, useRef, useState } from "react";
import { HiArrowsRightLeft } from "react-icons/hi2";
import { brandNodes } from "./BrandName.jsx";
import { HighlightAnchor } from "./HighlightAnchor.jsx";
import { PanePicker } from "./PanePicker.jsx";
import { usePane } from "../navigation/paneContext.js";

/**
 * A section's title bar (issue #174). It sits ABOVE the section's own
 * scroller (SectionLayout), so it stays pinned at the top of its pane
 * while the description and the content scroll under it: on desktop
 * and on mobile.
 *
 * - Left: "GRQ" + the title. On desktop it is the pane picker's
 *   button (with a small switch icon, not a chevron, and the tooltip
 *   "Change this pane"); on mobile it is plain text (the nav is the
 *   picker).
 * - Right: the description toggle, a bordered "Info" button with a
 *   chevron. It is a disclosure, never an x: the old x / + read as
 *   "close this panel" while the panel stayed open, so players thought
 *   the button was broken. Clicking it never opens the picker.
 * - The whole bar is the section's "pane" highlight anchor: a nav tap
 *   on a section pinned in a side pane flashes it ("it's over here").
 */
export function SectionTitleBar({ sectionId, title, isDescriptionVisible, onToggle }) {
  const { pane, desktop } = usePane();
  const [pickerOpen, setPickerOpen] = useState(false);
  const titleButtonRef = useRef(null);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const titleNodes = (
    <>
      <span className="text-[#c5c53f]">GRQ</span>
      <span className="truncate">{brandNodes(title)}</span>
    </>
  );

  return (
    <HighlightAnchor
      tab={sectionId}
      scope="pane"
      className="pane-bar relative shrink-0 flex items-center gap-2 pl-2 pr-1 h-10 lg:h-11 w-full bg-[#1e1e1e] border-t border-[#0078d4] text-sm text-[#cccccc]"
    >
      <h2 className="m-0 min-w-0 flex-1 text-sm font-normal">
        {desktop ? (
          <button
            ref={titleButtonRef}
            type="button"
            className="pane-title-button flex items-center gap-2 max-w-full px-2 py-1 rounded bg-transparent text-[#cccccc] hover:bg-[#2a2d2e] focus:bg-[#2a2d2e]"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            title="Change this pane"
            onClick={() => setPickerOpen((open) => !open)}
          >
            {titleNodes}
            <HiArrowsRightLeft size={14} className="shrink-0 text-[#858585]" aria-hidden="true" />
          </button>
        ) : (
          <span className="flex items-center gap-2 px-2">{titleNodes}</span>
        )}
      </h2>
      {desktop && pickerOpen && (
        <PanePicker pane={pane} onClose={closePicker} returnFocusRef={titleButtonRef} />
      )}
      {/* The description toggle: a disclosure, never an x. */}
      <button
        type="button"
        className="info-toggle shrink-0 flex items-center gap-1 min-w-10 h-10 lg:min-w-8 lg:h-8 px-2 rounded border border-[#5a5a5a] bg-transparent text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white"
        onClick={onToggle}
        aria-expanded={isDescriptionVisible}
        aria-label={isDescriptionVisible ? "Hide description" : "Show description"}
        title={isDescriptionVisible ? "Hide description" : "Show description"}
      >
        <span
          className={`info-toggle-chevron text-lg leading-none${isDescriptionVisible ? " info-toggle-chevron--open" : ""}`}
          aria-hidden="true"
        >
          ▸
        </span>
        <span>Info</span>
      </button>
    </HighlightAnchor>
  );
}
