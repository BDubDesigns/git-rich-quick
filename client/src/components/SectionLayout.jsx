import { useGameContext, SECTIONS_CONFIG } from "../context/GameContext.jsx";
import { SectionTitleBar } from "./SectionTitleBar.jsx";
import { CodeComment } from "./CodeComment.jsx";

/**
 * SectionLayout: Container wrapper for page/tab content.
 *
 * Handles:
 * - Section config lookup (displayName, description)
 * - Description visibility state
 * - Toggle handler
 * - Standard page structure (title bar, comment, content container)
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
    <div className="primary-text">
      <SectionTitleBar
        title={sectionConfig.displayName}
        isDescriptionVisible={isDescriptionVisible}
        onToggle={handleToggleDescription}
      />
      {isDescriptionVisible && (
        <CodeComment>{sectionConfig.description}</CodeComment>
      )}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
