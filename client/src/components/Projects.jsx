import { useGameContext } from "../context/useGameContext";
import { FREELANCE_PROJECTS_CONFIG } from "../context/gameConfig";
import {
  isFreelanceProjectUnlocked,
  getUnlockProgressForFreelanceProject,
  hasCrossedUnlockThreshold,
} from "../context/gameLogic";
import { SectionLayout } from "./SectionLayout.jsx";
import { ProjectCard } from "./ProjectCard.jsx";
import { LockedFreelanceProjectCard } from "./LockedFreelanceProjectCard.jsx";

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
          const isUnlocked = isFreelanceProjectUnlocked(projectKey, state);

          if (!isUnlocked) {
            // Locked and not yet visible (under 10% progress toward
            // its unlock): the project stays hidden, same as locked
            // employees and open-source projects.
            const hasCrossedThreshold = hasCrossedUnlockThreshold(
              "freelanceProject",
              projectKey,
              state
            );
            if (!hasCrossedThreshold) {
              return null;
            }
            const progress =
              getUnlockProgressForFreelanceProject(projectKey, state);
            return (
              <LockedFreelanceProjectCard
                key={projectKey}
                project={project}
                progress={progress}
              />
            );
          }

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
