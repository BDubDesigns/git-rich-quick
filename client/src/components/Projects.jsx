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
import { HighlightAnchor } from "./HighlightAnchor.jsx";
import { projectPayoutLines } from "../utils/projectPayout.js";
import { hypePayoutMultiplier } from "../../../shared/game-balance.js";

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

  // Hype Train / Derailment (issue #157): while one is live the
  // shippable cards glow green and sparkle (Hype Train) or dim red
  // (Derailment). The payout and rate lines already show the money.
  const hype = hypePayoutMultiplier(state.activeStarEffects ?? []);
  const hypeTone = hype > 1 ? "hype" : hype < 1 ? "derailed" : null;

  return (
    <SectionLayout sectionId="projects">
      {Object.entries(FREELANCE_PROJECTS_CONFIG).map(
        ([projectKey, project]) => {
          const isUnlocked = isFreelanceProjectUnlocked(projectKey, state);
          // Payout and rate (issue #176), at the player's Client
          // Network rank: the same numbers a ship pays.
          const payout = projectPayoutLines(
            projectKey,
            state.permanentStoreRanks ?? {},
            { activeStarEffects: state.activeStarEffects ?? [] }
          );

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
            // Email links (issue #173): a teaser lands here, on the
            // unlock progress bars.
            return (
              <HighlightAnchor key={projectKey} tab="projects" itemId={projectKey}>
                <LockedFreelanceProjectCard
                  project={project}
                  progress={progress}
                  payout={payout}
                />
              </HighlightAnchor>
            );
          }

          const canComplete = state.linesOfCode >= project.loc;

          return (
            <HighlightAnchor key={projectKey} tab="projects" itemId={projectKey}>
              <ProjectCard
                project={project}
                payout={payout}
                hypeTone={hypeTone}
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
            </HighlightAnchor>
          );
        }
      )}
    </SectionLayout>
  );
}
