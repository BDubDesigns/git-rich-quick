import {
  useGameContext,
  FREELANCE_PROJECTS_CONFIG,
} from "../context/GameContext";
import { formatMoney } from "../utils/currency.js";
import { ActionButton } from "./ActionButton.jsx";
import { HiOutlineBanknotes } from "react-icons/hi2";
import { SectionTitleBar } from "./SectionTitleBar.jsx";
import { CodeComment } from "./CodeComment.jsx";

export function Projects() {
  const { state, dispatch } = useGameContext();

  const handleCompleteProject = (projectKey) => {
    dispatch({
      type: "COMPLETE_PROJECT",
      payload: { projectKey },
    });
  };

  const handleToggleDescription = () => {
    dispatch({
      type: "TOGGLE_SECTION_DESC_VISIBILITY",
      payload: { sectionId: "projects" },
    });
  };

  const isDescriptionVisible =
    state.uiState.sections.projects.isDescriptionVisible;

  return (
    <div className="primary-text">
      <SectionTitleBar
        title="Freelance Projects"
        onToggle={handleToggleDescription}
        isDescriptionVisible={isDescriptionVisible}
      />
      {isDescriptionVisible && (
        <CodeComment>Convert LOC to Money by completing projects</CodeComment>
      )}

      <div className="grid grid-cols-3 gap-4">
        {Object.entries(FREELANCE_PROJECTS_CONFIG).map(
          ([projectKey, project]) => {
            const canComplete = state.linesOfCode >= project.loc;

            return (
              <div
                key={projectKey}
                className="border rounded-md border-gray-300 p-4 pt-0 flex flex-col"
              >
                <h3 className="-rotate-3 text-blue-800 font-semibold mb-1">
                  {project.name}
                </h3>
                <p>{project.description}</p>
                <p>Requires: {project.loc} LOC</p>
                <p>Reward: ${formatMoney(project.reward)}</p>
                <ActionButton
                  onClick={() => handleCompleteProject(projectKey)}
                  disabled={!canComplete}
                  floatText={`+$${formatMoney(project.reward)}`}
                  icon={<HiOutlineBanknotes size={20} />}
                >
                  Ship Project
                </ActionButton>
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}
