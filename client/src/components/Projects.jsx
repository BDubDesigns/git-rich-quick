import {
  useGameContext,
  FREELANCE_PROJECTS_CONFIG,
} from "../context/GameContext";
import { formatMoney } from "../utils/currency.js";
import { ActionButton } from "./ActionButton.jsx";
import { HiOutlineBanknotes } from "react-icons/hi2";
import { SectionTitleBar } from "./SectionTitleBar.jsx";
import { CodeComment } from "./CodeComment.jsx";
import { ProjectCard } from "./ProjectCard.jsx";

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

      <div className="flex flex-col gap-2">
        {Object.entries(FREELANCE_PROJECTS_CONFIG).map(
          ([projectKey, project]) => {
            const canComplete = state.linesOfCode >= project.loc;

            return (
              <ProjectCard
                key={projectKey}
                project={project}
                onComplete={() => handleCompleteProject(projectKey)}
                canComplete={canComplete}
                completionCount={
                  state.freelanceProjectsCompleted[projectKey] || 0
                }
              />
            );
          }
        )}
      </div>
    </div>
  );
}
