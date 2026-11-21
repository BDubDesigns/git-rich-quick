import { SECTIONS_CONFIG } from "../context/gameConfig.js";
import { useGameContext } from "../context/useGameContext.js";
import { SectionTitleBar } from "./SectionTitleBar.jsx";
import { CodeComment } from "./CodeComment.jsx";
import { ScrollAffordanceFrame } from "./ScrollAffordances.jsx";

/**
 * SectionLayout: the frame every section renders in.
 *
 * Issue #174: the section owns its pane's scroll. A full-height column:
 *
 *   SectionTitleBar          (fixed height, never scrolls; the picker
 *                             hangs off it, outside the scroller)
 *   ScrollAffordanceFrame    (flex-1: the description comment and the
 *                             content scroll here, with the up/down
 *                             arrows on this area only)
 *
 * So the title bar is pinned structurally (not CSS sticky): it is
 * above its own scroller. A deep link's scrollIntoView centers the
 * card in that scroller, never behind the bar.
 *
 * Usage:
 *   <SectionLayout sectionId="shop">
 *     {*/ /* Your unique content here */ /**}
 *   </SectionLayout>
 */
export function SectionLayout({ sectionId, children }) {
  const { state, dispatch } = useGameContext();

  // Look up config for this section (displayName, description)
  const sectionConfig = SECTIONS_CONFIG[sectionId];

  // Check if description should be visible
  const isDescriptionVisible =
    state.uiState.sections[sectionId].isDescriptionVisible;

  // Handler to toggle description visibility
  const handleToggleDescription = () => {
    dispatch({
      type: "TOGGLE_SECTION_DESC_VISIBILITY",
      payload: { sectionId },
    });
  };

  return (
    <div className="primary-text h-full min-h-0 flex flex-col">
      <SectionTitleBar
        sectionId={sectionId}
        title={sectionConfig.displayName}
        isDescriptionVisible={isDescriptionVisible}
        onToggle={handleToggleDescription}
      />
      {/* The editor surface (issue #231): the panel color, so the
          title bar's active tab joins it with no edge between them. */}
      <ScrollAffordanceFrame
        className="pane-surface flex-1 min-h-0 bg-[var(--panel-background-color)] border-x border-b border-[var(--title-bar-color)]"
        scrollerClassName="h-full overflow-y-auto p-2"
      >
        {isDescriptionVisible && (
          <CodeComment>{sectionConfig.description}</CodeComment>
        )}
        <div className="flex flex-col gap-2 pb-2">{children}</div>
      </ScrollAffordanceFrame>
    </div>
  );
}
