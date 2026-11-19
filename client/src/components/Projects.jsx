import { useGameContext } from "../context/useGameContext";
import { FREELANCE_PROJECTS_CONFIG } from "../context/gameConfig";
import {
  isFreelanceProjectUnlocked,
  getUnlockProgressForFreelanceProject,
  hasCrossedUnlockThreshold,
  getReleaseManagerEconomics,
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

  // Release Manager assignments (issue #163) live on the project cards.
  const managersOwned = state.employees.releaseManager?.count ?? 0;
  const rmEconomics = getReleaseManagerEconomics(state);
  const setAssignment = (projectKey, count) => {
    dispatch({
      type: "SET_RELEASE_MANAGER_ASSIGNMENT",
      payload: { projectKey, count },
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
              releaseManager={
                managersOwned > 0
                  ? {
                      ...rmEconomics.perProject[projectKey],
                      unassigned: rmEconomics.unassigned,
                      onChange: (count) => setAssignment(projectKey, count),
                    }
                  : null
              }
            />
          );
        }
      )}
    </SectionLayout>
  );
}
