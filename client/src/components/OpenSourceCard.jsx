import { ActionButton } from "./ActionButton.jsx";
import {
  STAR_CONFIG,
  starSpawnIntervalSeconds,
  unlockedStarEffects,
} from "../../../shared/game-balance.js";

/**
 * Star info for a Constellation level: the spawn interval and the
 * unlocked effects (by their good-outcome pun names). Constellation has
 * no numeric bonus — its bonus IS the stars — so the card shows this
 * instead of "+0 STAR".
 */
function constellationInfo(level) {
  const interval = starSpawnIntervalSeconds(level);
  const effectNames = unlockedStarEffects(level).map(
    (id) => STAR_CONFIG.effects[id].names.good
  );
  return { interval, effectNames };
}

/** What the next Constellation level adds: a new effect and/or faster spawns. */
function constellationNextInfo(level) {
  const nextLevel = level + 1;
  const nextInterval = starSpawnIntervalSeconds(nextLevel);
  const currentInterval = starSpawnIntervalSeconds(level);
  const newEffect = Object.keys(STAR_CONFIG.effects).find(
    (id) => STAR_CONFIG.effects[id].unlockLevel === nextLevel
  );
  const newEffectName = newEffect
    ? STAR_CONFIG.effects[newEffect].names.good
    : null;
  const fasterSpawns =
    nextInterval &&
    (!currentInterval || nextInterval.min < currentInterval.min);
  return { nextInterval, newEffectName, fasterSpawns };
}

export function OpenSourceCard({
  projectId,
  project,
  currentLevel,
  currentBonus,
  nextBonus,
  locCost,
  isMaxed,
  canContribute,
  onContribute,
}) {
  const isConstellation = projectId === "constellation";
  const starInfo = isConstellation ? constellationInfo(currentLevel) : null;
  const starNext =
    isConstellation && !isMaxed ? constellationNextInfo(currentLevel) : null;
  // The floating text on Contribute: for Constellation it names the
  // unlock, not a numeric bonus (there is none).
  const floatText = isMaxed
    ? ""
    : isConstellation
      ? starNext.newEffectName
        ? `${starNext.newEffectName}!`
        : starNext.fasterSpawns
          ? "Faster stars!"
          : ""
      : `+${nextBonus.value} ${nextBonus.type}`;

  return (
    <div className="panel px-3 pb-1 flex flex-col gap-1 m-0">
      {/* Two-column layout */}
      <div className="flex items-center gap-4">
        {/* Left: Content */}
        <div className="flex-1">
          {/* JSDoc block with title, description, current bonus, next bonus, cost */}
          <div className="flex-1">
            {/* Row: Rewards and Cost */}
            <div className="text-xs font-mono">
              {/* Top: Project Name */}
              <span className="comment-text">{`/** `}</span>
              <br />
              <span className="text-sm font-bold">
                {project.name} v.{currentLevel}.0
              </span>
              <br />
              <span>{project.description}</span>
              <br />
              <span className="text-blue-400">@param</span>
              <span className="text-cyan-300"> {`{LOC}`}</span>
              <span className="text-gray-400">
                {" "}
                {locCost} LOC needed for v.{currentLevel + 1}.0
              </span>
              <br />

              {/* current bonus, if any — for Constellation, the star info */}
              {isConstellation ? (
                <>
                  <span className="text-blue-400"> @returns</span>
                  <span className="text-cyan-300"> {`{STAR}`}</span>
                  <span className="text-green-400">
                    {" "}
                    {currentLevel > 0
                      ? `Stars every ${starInfo.interval.min}–${starInfo.interval.max}s · ${starInfo.effectNames.join(" · ")}`
                      : "No stars yet — chart the first one"}
                  </span>
                  <br />
                </>
              ) : (
                currentBonus && (
                  <>
                    <span className="text-blue-400"> @returns</span>
                    <span className="text-cyan-300">
                      {" "}
                      {`{` + currentBonus.type + `}`}
                    </span>
                    <span className="text-green-400">
                      {" "}
                      Earning {currentBonus.value} boost to {currentBonus.type}{" "}
                      now
                    </span>
                    <br />
                  </>
                )
              )}

              {/* next bonus or maxed out */}
              {!isMaxed ? (
                isConstellation ? (
                  <div>
                    <span className="text-blue-400">@returns</span>
                    <span className="text-cyan-300">{`{Bonus}`}</span>
                    <span className="text-green-400">
                      {" "}
                      {starNext.newEffectName
                        ? `Unlocks ${starNext.newEffectName}`
                        : ""}
                      {starNext.newEffectName && starNext.fasterSpawns
                        ? " · "
                        : ""}
                      {starNext.fasterSpawns
                        ? `Stars spawn faster (${starNext.nextInterval.min}–${starNext.nextInterval.max}s)`
                        : ""}
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="text-blue-400">@returns</span>
                    <span className="text-cyan-300">{`{Bonus}`}</span>
                    <span className="text-green-400">
                      {" "}
                      +{nextBonus.value} {nextBonus.type}
                    </span>
                  </div>
                )
              ) : (
                <div className="comment-text">// MAXED OUT</div>
              )}

              {/* ending comment tag */}
              <span className="comment-text">{`*/`}</span>
            </div>
          </div>
        </div>

        {/* Right: Icon + Level, Contribute Button */}
        <div className="flex flex-col items-center gap-2 shrink-0 py-2">
          {/* Icon + Level number */}
          <project.icon size={36} color={project.color} />
          <div className="text-xs text-gray-400">v{currentLevel}.0</div>

          {/* Contribute/Maxed Button */}
          <ActionButton
            onClick={onContribute}
            disabled={!canContribute || isMaxed}
            floatText={floatText}
            icon={<project.icon size={20} />}
            fullWidth={false}
          >
            {!isMaxed ? (
              <>
                <div>Contribute!</div>
                <div>({locCost} LOC)</div>
              </>
            ) : (
              <div>Maxed Out</div>
            )}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
