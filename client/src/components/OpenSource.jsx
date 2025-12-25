import {
  useGameContext,
  OPEN_SOURCE_PROJECTS_CONFIG,
  isOpenSourceProjectUnlocked,
  getUnlockProgressForOpenSource,
  hasCrossedUnlockThreshold,
} from "../context/GameContext";
import { SectionLayout } from "./SectionLayout.jsx";
import { OpenSourceCard } from "./OpenSourceCard.jsx";
import { LockedOpenSourceCard } from "./LockedOpenSourceCard.jsx";

export function OpenSource() {
  const { state, dispatch } = useGameContext();

  const handleContribute = (projectId) => {
    dispatch({ type: "CONTRIBUTE_TO_PROJECT", payload: { projectId } });
  };

  return (
    <SectionLayout sectionId="openSource">
      {Object.entries(OPEN_SOURCE_PROJECTS_CONFIG).map(([id, config]) => {
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
              project={config}
              unlockConditions={config.unlockConditions}
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
