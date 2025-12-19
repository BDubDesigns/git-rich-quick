// Import necessary hooks and configurations from the game's context.
import {
  useGameContext, // Hook to access game state and dispatch actions.
  OPEN_SOURCE_PROJECTS_CONFIG, // Configuration object for all open source projects.
} from "../context/GameContext";
// Import additional UI components for styling and content.
import { SectionTitleBar } from "./SectionTitleBar.jsx";
import { CodeComment } from "./CodeComment.jsx";
import { OpenSourceCard } from "./OpenSourceCard.jsx";
import { LockedOpenSourceCard } from "./LockedOpenSourceCard.jsx";
import { isOpenSourceProjectUnlocked } from "../context/GameContext";
import { getUnlockProgressForOpenSource } from "../context/GameContext";
import { hasCrossedUnlockThreshold } from "../context/GameContext";

// Define the OpenSource component, which renders the UI for contributing to projects.
export function OpenSource() {
  // Get the current game state and the dispatch function from the game context.
  const { state, dispatch } = useGameContext();

  // Define a handler function for when a user clicks the "Contribute" button.
  const handleContribute = (projectId) => {
    // Dispatch an action to the game's reducer to handle the contribution logic.
    dispatch({ type: "CONTRIBUTE_TO_PROJECT", payload: { projectId } });
  };

  // Get the visibility state of the project descriptions from the game state.
  const isDescriptionVisible =
    state.uiState.sections.openSource.isDescriptionVisible;
  const handleToggleDescription = () => {
    dispatch({
      type: "TOGGLE_SECTION_DESC_VISIBILITY",
      payload: { sectionId: "openSource" },
    });
  };

  // Render the component's UI.
  return (
    <div className="primary-text">
      <SectionTitleBar
        title="GitNub Contributions"
        onToggle={handleToggleDescription}
        isDescriptionVisible={isDescriptionVisible}
      />
      {isDescriptionVisible && (
        <CodeComment>
          Contribute your LOC to open-source projects to unlock permanent
          bonuses.
        </CodeComment>
      )}
      {/* Use a flex column layout to display the projects. */}
      <div className="flex flex-col gap-2">
        {/* Map over the OPEN_SOURCE_PROJECTS_CONFIG to render each project. */}
        {/* Object.entries converts the config object into an array of [id, config] pairs. */}
        {Object.entries(OPEN_SOURCE_PROJECTS_CONFIG).map(([id, config]) => {
          // Get the current state for this specific project (e.g., its level).
          const projectState = state.openSourceProjects[id];

          // --- Unlock Condition Check ---
          const isUnlocked = isOpenSourceProjectUnlocked(id, state);

          if (!isUnlocked) {
            // show locked card only if threshold crossed
            const hasCrossedThreshold = hasCrossedUnlockThreshold(
              "openSource",
              id,
              state
            );
            if (!hasCrossedThreshold) {
              return null; // skip rendering this locked project
            }
            // render locked card
            const progress = getUnlockProgressForOpenSource(id, state);
            return (
              <LockedOpenSourceCard
                key={id}
                project={config}
                unlockConditions={config.unlockConditions}
                progress={progress}
                nextBonus={config.levels[0]?.bonus}
                locCost={config.levels[0]?.locCost}
              />
            );
          }

          // Calculate OpenSourceCard props
          const currentLevel = projectState.level;
          const isMaxed = currentLevel >= config.levels.length;
          const currentBonus =
            currentLevel > 0 ? config.levels[currentLevel - 1].bonus : null;
          const nextLevelConfig = !isMaxed ? config.levels[currentLevel] : null;
          const nextBonus = nextLevelConfig?.bonus;
          const locCost = nextLevelConfig?.locCost;
          const canContribute = !isMaxed && state.linesOfCode >= locCost;

          // Render the card
          return (
            <OpenSourceCard
              key={id}
              project={config}
              currentLevel={currentLevel}
              currentBonus={currentBonus}
              nextBonus={nextBonus}
              locCost={locCost}
              isMaxed={isMaxed}
              canContribute={canContribute}
              onContribute={() => handleContribute(id)}
            />
          );
        })}
      </div>
    </div>
  );
}
