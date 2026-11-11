import { useGameContext } from "../context/useGameContext";
import { OPEN_SOURCE_PROJECTS_CONFIG } from "../context/gameConfig";
import { isOpenSourceProjectUnlocked } from "../context/gameLogic";
import {
  getUnlockProgressForOpenSource,
  hasCrossedUnlockThreshold,
  sortOpenSourceProjectIds,
} from "../utils/unlockProgress.js";
import { SectionLayout } from "./SectionLayout.jsx";
import { OpenSourceCard } from "./OpenSourceCard.jsx";
import { LockedOpenSourceCard } from "./LockedOpenSourceCard.jsx";

export function OpenSource() {
  const { state, dispatch } = useGameContext();

  const handleContribute = (projectId) => {
    dispatch({ type: "CONTRIBUTE_TO_PROJECT", payload: { projectId } });
  };

  // Maxed-out projects sink to the bottom; projects that still have
  // levels to buy stay higher (stable within each group).
  const sortedIds = sortOpenSourceProjectIds(
    Object.keys(OPEN_SOURCE_PROJECTS_CONFIG),
    state
  );

  return (
    <SectionLayout sectionId="openSource">
      {sortedIds.map((id) => {
        const config = OPEN_SOURCE_PROJECTS_CONFIG[id];
        const projectState = state.openSourceProjects[id];
        const isUnlocked = isOpenSourceProjectUnlocked(id, state);

        if (!isUnlocked) {
          const hasCrossedThreshold = hasCrossedUnlockThreshold(
            "openSource",
            id,
            state
          );
          if (!hasCrossedThreshold) {
            return null;
          }
          const progress = getUnlockProgressForOpenSource(id, state);
          return (
            <LockedOpenSourceCard
              key={id}
              projectId={id}
              project={config}
              progress={progress}
              nextBonus={config.levels[0]?.bonus}
              locCost={config.levels[0]?.locCost}
            />
          );
        }

        const currentLevel = projectState.level;
        const isMaxed = currentLevel >= config.levels.length;
        const currentBonus =
          currentLevel > 0 ? config.levels[currentLevel - 1].bonus : null;
        const nextLevelConfig = !isMaxed ? config.levels[currentLevel] : null;
        const nextBonus = nextLevelConfig?.bonus;
        const locCost = nextLevelConfig?.locCost;
        const canContribute = !isMaxed && state.linesOfCode >= locCost;

        return (
          <OpenSourceCard
            key={id}
            projectId={id}
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
    </SectionLayout>
  );
}
