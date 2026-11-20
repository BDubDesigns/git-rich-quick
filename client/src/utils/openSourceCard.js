/**
 * The props an unlocked Open Source card renders from (issue #179),
 * as a pure function of the project id and the reducer state, so the
 * server test suite can pin it without React.
 *
 * Stale client guard: a save written by a newer client can hold a
 * level above the levels THIS client defines (Nov 18: OverReact at
 * level 10 on a build that knew 9). Reading `levels[level - 1].bonus`
 * then threw and took the tab down. The level is clamped to the
 * defined maximum before anything reads it, so the card renders the
 * highest level this client knows, as maxed, and every per-level
 * helper the card calls (Constellation, StarBroker, Launch Pad, the
 * track multipliers) sees a level it defines. The save itself is never
 * touched: the clamp is display only.
 */
import {
  BALANCE,
  fundingRoundName,
  fundingRoundRankForLevel,
  openSourceNextLevelCost,
  openSourceNextLevelNeedsRound,
} from "../../../shared/game-balance.js";

/** A save level clamped to the levels this client defines (0 when unknown). */
export function clampedOpenSourceLevel(projectId, level) {
  const length = BALANCE.openSource[projectId]?.levels?.length ?? 0;
  const safe = Number.isInteger(level) && level > 0 ? level : 0;
  return Math.min(safe, length);
}

/**
 * { currentLevel, currentBonus, nextBonus, locCost, isMaxed,
 *   lockedRoundName, canContribute } for an unlocked project card.
 * Null for an id this client does not define.
 */
export function openSourceCardModel(projectId, state) {
  const levels = BALANCE.openSource[projectId]?.levels;
  if (!levels) return null;
  const currentLevel = clampedOpenSourceLevel(
    projectId,
    state.openSourceProjects?.[projectId]?.level
  );
  const isMaxed = currentLevel >= levels.length;
  const currentBonus =
    currentLevel > 0 ? (levels[currentLevel - 1]?.bonus ?? null) : null;
  const nextBonus = isMaxed ? undefined : levels[currentLevel]?.bonus;
  // The shared next-level cost (issue #180): what this card shows,
  // what contributing charges, and what Cheapest sorts by.
  const locCost =
    openSourceNextLevelCost(projectId, currentLevel, state.permanentStoreRanks) ??
    undefined;
  // Funding Rounds (issue #170): the next level may exist but sit
  // above the owned round's cap; the card shows the round it needs.
  // A Bridge Round (issue #192) raises that cap for this company.
  const needsRound =
    !isMaxed &&
    openSourceNextLevelNeedsRound(
      projectId,
      currentLevel,
      state.permanentStoreRanks,
      state.openSourceProjects
    );
  const lockedRoundName = needsRound
    ? fundingRoundName(fundingRoundRankForLevel(projectId, currentLevel + 1))
    : null;
  const canContribute =
    !isMaxed && !needsRound && (state.linesOfCode ?? 0) >= locCost;
  return {
    currentLevel,
    currentBonus,
    nextBonus,
    locCost,
    isMaxed,
    lockedRoundName,
    canContribute,
  };
}
