// Import necessary hooks and configurations from the game's context.
import {
  useGameContext, // Hook to access game state and dispatch actions.
  OPEN_SOURCE_PROJECTS_CONFIG, // Configuration object for all open source projects.
} from "../context/GameContext";
// Import additional UI components for styling and content.
import { SectionTitleBar } from "./SectionTitleBar.jsx";
import { CodeComment } from "./CodeComment.jsx";
import { ProgressBar } from "./ProgressBar.jsx";
import { OpenSourceCard } from "./OpenSourceCard.jsx";
import { LockedOpenSourceCard } from "./LockedOpenSourceCard.jsx";

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
          // Initialize a flag to track if the project is locked.
          let isLocked = false;
          let employeeType = null;
          // Check if the project has an unlock condition defined in its config.
          if (config.unlockCondition) {
            // Destructure the properties from the unlock condition object.
            const { type, employeeType: emp, count } = config.unlockCondition;
            employeeType = emp;
            // If the condition is based on employee count, check if the player has enough.
            if (type === "EMPLOYEE_COUNT" && state.employees[emp].count < count) {
              // If the player doesn't have enough employees, set the project as locked.
              isLocked = true;
            }
          }

          // If the project is locked, render the locked card.
          if (isLocked) {
            const firstLevelBonus = config.levels[0]?.bonus;
            const firstLevelCost = config.levels[0]?.locCost;
            return (
              <LockedOpenSourceCard
                key={id}
                project={config}
                unlockCondition={config.unlockCondition}
                currentProgress={state.employees[employeeType].count}
                nextBonus={firstLevelBonus}
                locCost={firstLevelCost}
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
