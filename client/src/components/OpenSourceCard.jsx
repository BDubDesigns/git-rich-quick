import { useState } from "react";
import { ActionButton } from "./ActionButton.jsx";
import { Button } from "./Button.jsx";
// Number abbreviation (issue #42): the shared formatter.
import { formatNumber } from "../../../shared/formatNumber.js";
import {
  DOUBLING_PROJECT_EMPLOYEE,
  EMPLOYEE_DISPLAY_NAMES,
  STAR_CONFIG,
  doublingTrackMultiplier,
  formatCooldownSeconds,
  isDoublingProject,
  launchPadCooldownSeconds,
  launchPadLevelUpFloatText,
  moonshotOddsText,
  projectManagerBoostFraction,
  starBrokerCooldownSeconds,
  starBrokerLevelUpFloatText,
  starSpawnIntervalSeconds,
  unlockedStarEffects,
} from "../../../shared/game-balance.js";
import {
  bridgeRoundFloatText,
  bridgeRoundOfferText,
  bridgeRoundOwnedText,
} from "../utils/bridgeRound.js";
import { JsDocBlock, JsDocLine } from "./JsDocBlock.jsx";
import { Panel } from "./Panel.jsx";

/**
 * Star info for a Constellation level: the spawn interval and the
 * unlocked effects (by their good-outcome pun names). Constellation has
 * no numeric bonus (its bonus IS the stars), so the card shows this
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

/** The passive boost one Project Manager gives at a Scrum Master level, in percent. */
function scrumBoostPercent(level) {
  return (
    projectManagerBoostFraction({ projectManager: 1 }, 1, { scrumMaster: level }) *
    100
  );
}

/**
 * StarBroker cooldown label for a level ("8m", "30s"), or null at
 * level 0. StarBroker has no numeric bonus (its bonus IS the shorter
 * cooldown), so the card shows this instead of "+0 STAR".
 */
function starBrokerInfo(level) {
  const cooldown = starBrokerCooldownSeconds(level);
  return cooldown == null ? null : formatCooldownSeconds(cooldown);
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
  // Favorites (permanent store, Slice 2): whether this project is
  // favorited, and the toggle handler. Both default off so older
  // callers (tests, stories) keep working without them.
  isFavorite = false,
  onToggleFavorite = null,
  // Funding Rounds (issue #170): the round the next level needs, when
  // the owned round's cap holds it back (null when it is buyable or
  // the track is maxed). The card then shows the level as locked.
  lockedRoundName = null,
  // Bridge Round (issue #192): the owned store ranks, which name the
  // round the bridge rents. Defaults to Bootstrapped.
  storeRanks = {},
}) {
  const isConstellation = projectId === "constellation";
  // Bridge Round (issue #192): one level, no numeric bonus. The card
  // says what it rents, and once owned, that it lasts until the sale.
  const isBridge = projectId === "bridgeRound";
  const isStarBroker = projectId === "starBroker";
  // Moonshot (issue #165): the opt-in asks for confirmation before
  // the buy (red stars are a gamble and last until the sale). Launch
  // Pad shows its cooldown like StarBroker.
  const isMoonshot = projectId === "moonshot";
  const isLaunchPad = projectId === "launchPad";
  const needsConfirm = isMoonshot && currentLevel === 0 && !isMaxed;
  const [confirming, setConfirming] = useState(false);
  const launchPadCooldown =
    isLaunchPad && currentLevel > 0
      ? formatCooldownSeconds(launchPadCooldownSeconds(currentLevel))
      : null;
  const launchPadNextCooldown =
    isLaunchPad && !isMaxed
      ? formatCooldownSeconds(launchPadCooldownSeconds(currentLevel + 1))
      : null;
  // Track upgrades (issue #118, retuned in #170): the bonus is a
  // multiplier, not an additive amount, so the card shows the output
  // multiplier from the shared formula (1.4x per level for the passive
  // tracks, 2x for Commitment Issues and Ship Happens). Scrum Master
  // is linear, so it reads as the boost each Project Manager gives.
  const isDoubling = isDoublingProject(projectId);
  const isScrumMaster = projectId === "scrumMaster";
  const isRoundLocked = !isMaxed && lockedRoundName !== null;
  const doublingEmployeeName = isDoubling
    ? EMPLOYEE_DISPLAY_NAMES[DOUBLING_PROJECT_EMPLOYEE[projectId]]
    : null;
  const trackEffect = (level) =>
    isScrumMaster
      ? `each ${doublingEmployeeName} boosts passive LOC +${formatNumber(scrumBoostPercent(level))}%`
      : `${doublingEmployeeName} output x${formatNumber(doublingTrackMultiplier(projectId, level))}`;
  const doublingNow = isDoubling ? trackEffect(currentLevel) : null;
  const doublingNext = isDoubling ? trackEffect(currentLevel + 1) : null;
  const doublingNextMultiplier = isDoubling
    ? formatNumber(
        isScrumMaster
          ? scrumBoostPercent(currentLevel + 1)
          : doublingTrackMultiplier(projectId, currentLevel + 1)
      )
    : null;
  const starInfo = isConstellation ? constellationInfo(currentLevel) : null;
  const starNext =
    isConstellation && !isMaxed ? constellationNextInfo(currentLevel) : null;
  // StarBroker's cooldown at the current / next level (null at level 0).
  const starBrokerCooldown =
    isStarBroker && currentLevel > 0 ? starBrokerInfo(currentLevel) : null;
  const starBrokerNextCooldown =
    isStarBroker && !isMaxed ? starBrokerInfo(currentLevel + 1) : null;
  // The floating text on Contribute: for Constellation it names the
  // unlock, not a numeric bonus (there is none); for StarBroker it
  // names the new cooldown, not "+0 STAR" (also no numeric bonus);
  // for a doubling upgrade it names the new multiplier.
  const floatText = isMaxed || needsConfirm || isRoundLocked
    ? ""
    : isBridge
      ? bridgeRoundFloatText(storeRanks)
      : isLaunchPad
      ? launchPadLevelUpFloatText(currentLevel + 1)
      : isConstellation
      ? starNext.newEffectName
        ? `${starNext.newEffectName}!`
        : starNext.fasterSpawns
          ? "Faster stars!"
          : ""
      : isStarBroker
        ? starBrokerLevelUpFloatText(currentLevel + 1)
        : isDoubling
          ? isScrumMaster
            ? `+${doublingNextMultiplier}% each!`
            : `x${doublingNextMultiplier}!`
          : `+${formatNumber(nextBonus.value)} ${nextBonus.type}`;

  const handleContributeClick = () => {
    if (needsConfirm) {
      setConfirming(true);
      return;
    }
    onContribute();
  };

  return (
    <Panel className="px-3 pb-1 flex flex-col gap-1 m-0">
      {/* Two-column layout */}
      <div className="flex items-center gap-4">
        {/* Left: Content */}
        <div className="flex-1">
          <JsDocBlock
            title={`${project.name} v.${currentLevel}.0`}
            description={project.description}
          >
            {/* A maxed card has no next version to price (issue #191):
                the row is dropped, and the card already reads MAXED OUT.
                A round-capped card is not maxed, so it keeps pointing at
                the gated level. (An owned Bridge Round is maxed too.) */}
            {!isMaxed && (
              <JsDocLine
                tag="@param"
                type="LOC"
                value={`${formatNumber(locCost)} LOC needed for v.${currentLevel + 1}.0`}
              />
            )}

            {/* current bonus, if any: for Constellation, the star info;
                for StarBroker, the cooldown (no numeric bonus); for a
                doubling upgrade, the output multiplier */}
            {isBridge ? (
              currentLevel > 0 && (
                <JsDocLine
                  tag="@returns"
                  type="CAPS"
                  value={bridgeRoundOwnedText(storeRanks)}
                  valueClassName="text-green-400"
                />
              )
            ) : isConstellation ? (
              <JsDocLine
                tag="@returns"
                type="STAR"
                value={
                  currentLevel > 0
                    ? `Stars every ${starInfo.interval.min} to ${starInfo.interval.max}s · ${starInfo.effectNames.join(" · ")}`
                    : "No stars yet. Chart the first one"
                }
                valueClassName="text-green-400"
              />
            ) : isMoonshot && currentLevel > 0 ? (
              <JsDocLine
                tag="@returns"
                type="STAR"
                value={moonshotOddsText()}
                valueClassName="text-red-400"
              />
            ) : isLaunchPad && currentLevel > 0 ? (
              <JsDocLine
                tag="@returns"
                type="STAR"
                value={`Cooldown ${launchPadCooldown} between bought stars (shared with StarBroker)`}
                valueClassName="text-green-400"
              />
            ) : isStarBroker && currentLevel > 0 ? (
              <JsDocLine
                tag="@returns"
                type="STAR"
                value={`Cooldown ${starBrokerCooldown} between bought stars`}
                valueClassName="text-green-400"
              />
            ) : isDoubling && currentLevel > 0 ? (
              <JsDocLine
                tag="@returns"
                type="MULTIPLIER"
                value={`${doublingNow.charAt(0).toUpperCase()}${doublingNow.slice(1)} now`}
                valueClassName="text-green-400"
              />
            ) : (
              currentBonus &&
              !isDoubling && (
                <JsDocLine
                  tag="@returns"
                  type={currentBonus.type}
                  value={`Earning ${formatNumber(currentBonus.value)} boost to ${currentBonus.type} now`}
                  valueClassName="text-green-400"
                />
              )
            )}

            {/* next bonus or maxed out */}
            {isRoundLocked ? (
              <JsDocLine
                tag="@returns"
                type="LOCKED"
                value={`v.${currentLevel + 1}.0 opens at ${lockedRoundName}. Raise it in the permanent store after a sale.`}
                valueClassName="text-[#f48771]"
              />
            ) : !isMaxed ? (
              isBridge ? (
                <JsDocLine
                  tag="@returns"
                  type="CAPS"
                  value={bridgeRoundOfferText(storeRanks)}
                  valueClassName="text-green-400"
                />
              ) : isConstellation ? (
                <JsDocLine
                  tag="@returns"
                  type="Bonus"
                  value={`${starNext.newEffectName ? `Unlocks ${starNext.newEffectName}` : ""}${starNext.newEffectName && starNext.fasterSpawns ? " · " : ""}${starNext.fasterSpawns ? `Stars spawn faster (every ${starNext.nextInterval.min} to ${starNext.nextInterval.max}s)` : ""}`}
                  valueClassName="text-green-400"
                />
              ) : isStarBroker ? (
                <JsDocLine
                  tag="@returns"
                  type="Bonus"
                  value={`Cooldown ${starBrokerNextCooldown} between bought stars`}
                  valueClassName="text-green-400"
                />
              ) : isMoonshot ? (
                <JsDocLine
                  tag="@returns"
                  type="Bonus"
                  value={moonshotOddsText()}
                  valueClassName="text-red-400"
                />
              ) : isLaunchPad ? (
                <JsDocLine
                  tag="@returns"
                  type="Bonus"
                  value={`Cooldown ${launchPadNextCooldown} between bought stars (shared with StarBroker)`}
                  valueClassName="text-green-400"
                />
              ) : isDoubling ? (
                <JsDocLine
                  tag="@returns"
                  type="Bonus"
                  value={`${doublingNext.charAt(0).toUpperCase()}${doublingNext.slice(1)}`}
                  valueClassName="text-green-400"
                />
              ) : (
                <JsDocLine
                  tag="@returns"
                  type="Bonus"
                  value={`+${formatNumber(nextBonus.value)} ${nextBonus.type}`}
                  valueClassName="text-green-400"
                />
              )
            ) : (
              <div className="comment-text">
                {isBridge ? "// RENTED UNTIL THE SALE" : "// MAXED OUT"}
              </div>
            )}
          </JsDocBlock>
        </div>

        {/* Right: Icon + Level, Contribute Button */}
        <div className="flex flex-col items-center gap-2 shrink-0 py-2">
          {/* Icon + Level number */}
          <project.icon size={36} color={project.color} />
          <div className="text-xs text-gray-400">v{currentLevel}.0</div>

          {/* Contribute/Maxed Button */}
          <ActionButton
            onClick={handleContributeClick}
            disabled={!canContribute || isMaxed || isRoundLocked || confirming}
            floatText={floatText}
            icon={<project.icon size={20} />}
            fullWidth={false}
          >
            {isRoundLocked ? (
              <>
                <div>Needs</div>
                <div>{lockedRoundName}</div>
              </>
            ) : !isMaxed ? (
              <>
                <div>Contribute!</div>
                <div>({formatNumber(locCost)} LOC)</div>
              </>
            ) : (
              <div>{isBridge ? "Bridged" : "Maxed Out"}</div>
            )}
          </ActionButton>

          {/* Favorite toggle (permanent store, Slice 2): favorites
              sort first in the tab, and survive a sale only when the
              Company Template rank is owned. A plain text button, not
              an icon-only one, so the action is obvious at phone size. */}
          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-pressed={isFavorite}
              aria-label={
                isFavorite
                  ? `Unfavorite ${project.name}`
                  : `Favorite ${project.name}`
              }
              className="text-sm text-[#cccccc] bg-transparent border-0 cursor-pointer p-0 m-0"
            >
              {isFavorite ? "★ Favorited" : "☆ Favorite"}
            </button>
          )}
        </div>
      </div>
      {/* Moonshot confirmation (issue #165): opting in to red stars
          is a gamble that lasts until the sale, so the buy takes a
          second, explicit tap. Cancel backs out with nothing spent. */}
      {needsConfirm && confirming && (
        <div className="flex flex-col gap-2 pb-2" role="alertdialog" aria-label="Confirm Moonshot">
          <p className="m-0 text-xs text-[#f48771]">
            Red stars are a gamble. 1 in 4 stars will be red, and most of
            them crash. This lasts until you sell the company.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="game-button--danger"
              disabled={!canContribute}
              onClick={() => {
                setConfirming(false);
                onContribute();
              }}
            >
              Launch anyway
            </Button>
            <Button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
