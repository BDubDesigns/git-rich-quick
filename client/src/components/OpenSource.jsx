import { useGameContext } from "../context/useGameContext";
import { OPEN_SOURCE_PROJECTS_CONFIG } from "../context/gameConfig";
import { isOpenSourceProjectUnlocked } from "../context/gameLogic";
import {
  BRIDGE_ROUND_PROJECT_ID,
  bridgeRoundAvailable,
  openSourceNextLevelCost,
} from "../../../shared/game-balance.js";
import { openSourceCardModel } from "../utils/openSourceCard.js";
import {
  getUnlockProgressForOpenSource,
  hasCrossedUnlockThreshold,
  sortOpenSourceProjectIds,
} from "../utils/unlockProgress.js";
import { SectionLayout } from "./SectionLayout.jsx";
import { OpenSourceCard } from "./OpenSourceCard.jsx";
import { LockedOpenSourceCard } from "./LockedOpenSourceCard.jsx";
import { HighlightAnchor } from "./HighlightAnchor.jsx";
import { SortControl } from "./SortControl.jsx";
import { useSortMode } from "../hooks/useSortMode.js";

export function OpenSource() {
  const { state, dispatch } = useGameContext();
  // Sort mode (issue #180): Default or Cheapest, a device preference.
  const [sortMode] = useSortMode("openSource");

  const handleContribute = (projectId) => {
    dispatch({ type: "CONTRIBUTE_TO_PROJECT", payload: { projectId } });
  };

  // Favorites (permanent store, Slice 2): toggle a project in the
  // favorite list; favorites sort first in the tab (see
  // sortOpenSourceProjectIds) and survive a sale only when the
  // Company Template rank is owned.
  const handleToggleFavorite = (projectId) => {
    dispatch({
      type: "FAVORITE_OPEN_SOURCE_PROJECT",
      payload: { projectId },
    });
  };

  // Maxed-out projects sink to the bottom; projects that still have
  // levels to buy stay higher (stable within each group). Cheapest
  // mode orders the buyable list by next-level cost instead.
  const sortedIds = sortOpenSourceProjectIds(
    Object.keys(OPEN_SOURCE_PROJECTS_CONFIG),
    state,
    sortMode
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
      // Bridge Round (issue #192): from Series B on there is no bridge
      // to buy, so the card is not shown at all (a sale resets the
      // level, so an owned bridge never meets a higher rank).
      if (
        id === BRIDGE_ROUND_PROJECT_ID &&
        !bridgeRoundAvailable(state.permanentStoreRanks) &&
        (state.openSourceProjects?.[id]?.level ?? 0) === 0
      ) {
        return null;
      }
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
            <HighlightAnchor key={id} tab="openSource" itemId={id}>
              <LockedOpenSourceCard
                projectId={id}
                project={config}
                progress={progress}
                nextBonus={config.levels[0]?.bonus}
                locCost={openSourceNextLevelCost(
                  id,
                  0,
                  state.permanentStoreRanks
                )}
                storeRanks={state.permanentStoreRanks}
              />
            </HighlightAnchor>
          ),
        };
      }

      // Everything the card renders from, with the save level clamped
      // to the levels this client defines (issue #179): a save from a
      // newer client renders as this client's max, never a crash.
      const {
        currentLevel,
        currentBonus,
        nextBonus,
        locCost,
        isMaxed,
        lockedRoundName,
        canContribute,
      } = openSourceCardModel(id, state);

      return {
        isMaxed,
        element: (
          <HighlightAnchor key={id} tab="openSource" itemId={id}>
            <OpenSourceCard
              projectId={id}
              project={config}
              currentLevel={currentLevel}
              currentBonus={currentBonus}
              nextBonus={nextBonus}
              locCost={locCost}
              isMaxed={isMaxed}
              canContribute={canContribute}
              onContribute={() => handleContribute(id)}
              isFavorite={(state.favoriteOpenSourceProjects ?? []).includes(
                id
              )}
              onToggleFavorite={() => handleToggleFavorite(id)}
              lockedRoundName={lockedRoundName}
              storeRanks={state.permanentStoreRanks}
            />
          </HighlightAnchor>
        ),
      };
    })
    .filter((card) => card !== null);

  const activeCards = cards.filter((card) => !card.isMaxed);
  const maxedCards = cards.filter((card) => card.isMaxed);

  return (
    <SectionLayout sectionId="openSource">
      <SortControl tab="openSource" />
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
