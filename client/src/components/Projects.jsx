import {
  useGameContext,
  FREELANCE_PROJECTS_CONFIG,
} from "../context/GameContext";
import { SectionLayout } from "./SectionLayout.jsx";
import { ProjectCard } from "./ProjectCard.jsx";

export function Projects() {
  const { state, dispatch } = useGameContext();

  const handleCompleteProject = (projectKey) => {
    dispatch({
      type: "COMPLETE_PROJECT",
      payload: { projectKey },
    });
  };

  return (
    <SectionLayout sectionId="projects">
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
    </SectionLayout>
  );
}
