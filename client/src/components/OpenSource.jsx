// Import necessary hooks and configurations from the game's context.
import {
  useGameContext, // Hook to access game state and dispatch actions.
  OPEN_SOURCE_PROJECTS_CONFIG, // Configuration object for all open source projects.
} from "../context/GameContext";
// Import the reusable button component.
import { ActionButton } from "./ActionButton";
// Import additional UI components for styling and content.
import { SectionTitleBar } from "./SectionTitleBar.jsx";
import { CodeComment } from "./CodeComment.jsx";
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
      {/* Use a grid layout to display the projects. */}
      <div className="grid grid-cols-2 gap-4">
        {/* Map over the OPEN_SOURCE_PROJECTS_CONFIG to render each project. */}
        {/* Object.entries converts the config object into an array of [id, config] pairs. */}
        {Object.entries(OPEN_SOURCE_PROJECTS_CONFIG).map(([id, config]) => {
          // Get the current state for this specific project (e.g., its level).
          const projectState = state.openSourceProjects[id];
          // Check if the project has reached its maximum level.
          const isMaxLevel = projectState.level >= config.levels.length;

          // --- Unlock Condition Check ---
          // Initialize a flag to track if the project is locked.
          let isLocked = false;
          // Check if the project has an unlock condition defined in its config.
          if (config.unlockCondition) {
            // Destructure the properties from the unlock condition object.
            const { type, employeeType, count } = config.unlockCondition;
            // If the condition is based on employee count, check if the player has enough.
            if (
              type === "EMPLOYEE_COUNT" &&
              state.employees[employeeType].count < count
            ) {
              // If the player doesn't have enough employees, set the project as locked.
              isLocked = true;
            }
          }

          // If the project is locked, render a disabled-looking card with the requirement.
          if (isLocked) {
            return (
              <div
                key={id}
                className="border rounded-md border-gray-300 p-4 flex flex-col opacity-50"
              >
                <h3>{config.name} (Locked)</h3>
                <p>
                  Requires: {config.unlockCondition.count}{" "}
                  {config.unlockCondition.employeeType}s
                </p>
              </div>
            );
          }

          // If the project is not at max level, get the config for the next level.
          const nextLevelConfig = !isMaxLevel
            ? config.levels[projectState.level]
            : null;
          // Check if the player can afford the next level's LOC cost.
          const canAfford =
            nextLevelConfig && state.linesOfCode >= nextLevelConfig.locCost;

          // Render the project card.
          return (
            <div
              key={id}
              className="border rounded-md border-gray-300 p-4 flex flex-col"
            >
              <h3>{config.name}</h3>
              <p>Version: {projectState.level}.0</p>
              <p className="grow">{config.description}</p>
              {/* Conditionally render content based on whether the project is at max level. */}
              {isMaxLevel ? (
                // If at max level, show a success message.
                <p className="mt-auto font-bold text-green-600">
                  Max Level Reached!
                </p>
              ) : (
                // If not at max level, show the contribution UI.
                <>
                  <p>
                    {/* Display the bonus for the next level. */}
                    Next Bonus: +{nextLevelConfig.bonus.value * 100}%{" "}
                    {nextLevelConfig.bonus.type.replace("_", " ").toLowerCase()}
                  </p>
                  {/* Display the LOC cost for the next level. */}
                  <p>Cost: {nextLevelConfig.locCost.toLocaleString()} LOC</p>
                  {/* Render the ActionButton for contributing. */}
                  <ActionButton
                    onClick={() => handleContribute(id)}
                    disabled={!canAfford} // Disable the button if the player can't afford it.
                    floatText={`+1 ${config.name} Lvl`} // Text for the floating animation on click.
                  >
                    Contribute
                  </ActionButton>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
