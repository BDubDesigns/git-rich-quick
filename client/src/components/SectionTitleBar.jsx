import { useCallback, useRef, useState } from "react";
import { HiArrowsRightLeft } from "react-icons/hi2";
import { brandNodes } from "./BrandName.jsx";
import { HighlightAnchor } from "./HighlightAnchor.jsx";
import { PanePicker } from "./PanePicker.jsx";
import { usePane } from "../navigation/paneContext.js";

/**
 * A section's title bar (issue #174), drawn as a VS Code editor tab
 * strip (issue #231). It sits ABOVE the section's own scroller
 * (SectionLayout), so it stays pinned at the top of its pane while the
 * description and the content scroll under it: on desktop and mobile.
 *
 * - The strip is the recessed shell color with a 1px baseline. The
 *   section is its one open "file": a lifted tab on the panel color
 *   with the accent line on top and no bottom edge, so it joins the
 *   pane's editor surface below (SectionLayout).
 * - The tab: "GRQ" as the file-type icon + the title. On desktop the
 *   tab is the pane picker's button, with a small switch icon (not a
 *   chevron) where VS Code puts a tab's close button, and the tooltip
 *   "Change this pane"; on mobile it is plain text (the nav is the
 *   picker).
 * - Right, in the editor-actions slot: the description toggle, a
 *   bordered "Info" button with a chevron. It is a disclosure, never an
 *   x: the old x / + read as "close this panel" while the panel stayed
 *   open, so players thought the button was broken. Clicking it never
 *   opens the picker.
 * - The whole strip is the section's "pane" highlight anchor: a nav tap
 *   on a section pinned in a side pane flashes it ("it's over here");
 *   the flash lights the tab (index.css, .pane-bar.highlight-flash).
 */
export function SectionTitleBar({ sectionId, title, isDescriptionVisible, onToggle }) {
  const { pane, desktop } = usePane();
  const [pickerOpen, setPickerOpen] = useState(false);
  const titleButtonRef = useRef(null);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const titleNodes = (
    <>
      <span className="pane-tab-icon shrink-0 text-[11px] font-bold text-[#c5c53f]">GRQ</span>
      <span className="truncate">{brandNodes(title)}</span>
    </>
  );

  return (
    <HighlightAnchor
      tab={sectionId}
      scope="pane"
      className="pane-bar relative shrink-0 flex items-stretch gap-2 h-11 lg:h-9 w-full border-b border-[var(--title-bar-color)] text-sm text-[#cccccc]"
    >
      <h2 className="pane-tab relative z-10 -mb-px m-0 min-w-0 flex bg-[var(--panel-background-color)] border-x border-t border-x-[var(--title-bar-color)] border-t-[#0078d4] text-sm font-normal">
        {desktop ? (
          <button
            ref={titleButtonRef}
            type="button"
            className="pane-title-button group flex items-center gap-2 min-w-0 max-w-full h-full pl-3 pr-2 bg-transparent text-[#cccccc] hover:text-white outline-none focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[#0078d4]"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            title="Change this pane"
            onClick={() => setPickerOpen((open) => !open)}
          >
            {titleNodes}
            <HiArrowsRightLeft size={14} className="shrink-0 ml-2 text-[#858585] group-hover:text-[#cccccc] group-focus-visible:text-[#cccccc]" aria-hidden="true" />
          </button>
        ) : (
          <span className="flex items-center gap-2 min-w-0 h-full px-3">{titleNodes}</span>
        )}
      </h2>
      {desktop && pickerOpen && (
        <PanePicker pane={pane} onClose={closePicker} returnFocusRef={titleButtonRef} />
      )}
      {/* The description toggle: a disclosure, never an x. */}
      <button
        type="button"
        className="info-toggle self-center shrink-0 ml-auto mr-1 flex items-center gap-1 min-w-10 h-10 lg:min-w-8 lg:h-7 px-2 rounded border border-[#5a5a5a] bg-transparent text-sm lg:text-xs text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[#0078d4]"
        onClick={onToggle}
        aria-expanded={isDescriptionVisible}
        aria-label={isDescriptionVisible ? "Hide description" : "Show description"}
        title={isDescriptionVisible ? "Hide description" : "Show description"}
      >
        <span
          className={`info-toggle-chevron text-base leading-none${isDescriptionVisible ? " info-toggle-chevron--open" : ""}`}
          aria-hidden="true"
        >
          ▸
        </span>
        <span>Info</span>
      </button>
    </HighlightAnchor>
  );
}
