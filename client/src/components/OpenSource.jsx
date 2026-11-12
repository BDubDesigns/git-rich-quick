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

  // Build the visible cards first, then split them: projects that still
  // have levels to buy stay in the main list, and projects at max level
  // render under a "Maxed Out" header, so a maxed card is easy to tell
  // apart from one the player just cannot afford yet. Locked teaser
  // cards are never maxed (level 0), so they stay in the main list.
  // Cards that are not visible yet (below the unlock-visibility
  // threshold) are null and dropped here.
  const cards = sortedIds
    .map((id) => {
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
        return {
          isMaxed: false,
          element: (
            <LockedOpenSourceCard
              key={id}
              projectId={id}
              project={config}
              progress={progress}
              nextBonus={config.levels[0]?.bonus}
              locCost={config.levels[0]?.locCost}
            />
          ),
        };
      }

      const currentLevel = projectState.level;
      const isMaxed = currentLevel >= config.levels.length;
      const currentBonus =
        currentLevel > 0 ? config.levels[currentLevel - 1].bonus : null;
      const nextLevelConfig = !isMaxed ? config.levels[currentLevel] : null;
      const nextBonus = nextLevelConfig?.bonus;
      const locCost = nextLevelConfig?.locCost;
      const canContribute = !isMaxed && state.linesOfCode >= locCost;

      return {
        isMaxed,
        element: (
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
        ),
      };
    })
    .filter((card) => card !== null);

  const activeCards = cards.filter((card) => !card.isMaxed);
  const maxedCards = cards.filter((card) => card.isMaxed);

  return (
    <SectionLayout sectionId="openSource">
      {activeCards.map((card) => card.element)}
      {maxedCards.length > 0 && (
        <>
          {/* Same visual language as the tab's SectionTitleBar (GRQ
              prefix, dark bar, blue top border), minus the description
              toggle; this is a grouping label, not a section. */}
          <div className="flex items-center gap-2 px-4 py-2 bg-[#1e1e1e] border-t border-[#0078d4] text-sm text-[#cccccc] w-fit">
            <span className="text-[#c5c53f]">GRQ</span>
            <h2 className="m-0">Maxed Out</h2>
          </div>
          {maxedCards.map((card) => card.element)}
        </>
      )}
    </SectionLayout>
  );
}
