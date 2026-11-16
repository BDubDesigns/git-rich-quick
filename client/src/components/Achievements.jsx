// Achievements (issue #132): the Trophies tab.
//
// One summary Panel (the total permanent LOC buff and tiers earned),
// then one Panel per achievement: its tier badges (earned tiers lit),
// the goal for the next tier with a progress bar, and the flavor
// line. Hidden achievements read ??? until earned. Every number here
// comes from the shared helpers the reducer and production use
// (achievementBuffPercent, achievementLocMultiplier,
// achievementProgress), so the tab can never disagree with the game.

import { useGameContext } from "../context/useGameContext.js";
import { achievementContext } from "../context/gameLogic.js";
import * as shared from "../../../shared/game-balance.js";
import { formatNumber } from "../../../shared/formatNumber.js";
import { SectionLayout } from "./SectionLayout.jsx";
import { Panel } from "./Panel.jsx";
import { ProgressBar } from "./ProgressBar.jsx";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";

export function Achievements() {
  const { state } = useGameContext();
  // Progress bar toggles (issue #128): the "achievements" toggle.
  const showBars = useProgressBarEnabled("achievements");
  const ctx = achievementContext(state);
  const buffPercent = shared.achievementBuffPercent(state.achievements);
  const multiplier = shared.achievementLocMultiplier(state.achievements);
  const tiersEarned = shared.achievementTiersEarned(state.achievements);
  const totalTiers = shared.ACHIEVEMENTS.reduce(
    (sum, def) => sum + def.thresholds.length,
    0
  );

  return (
    <SectionLayout sectionId="achievements">
      <Panel className="px-3 py-2 flex flex-col gap-1 m-0">
        <h3 className="m-0 text-sm font-bold">Trophy Case</h3>
        <p className="m-0 text-sm">
          Achievement buff:{" "}
          <span className="text-green-400 font-bold">
            +{formatNumber(buffPercent)}% to all LOC
          </span>{" "}
          ({multiplier.toFixed(2)}x, clicks and passive)
        </p>
        <p className="m-0 text-xs text-gray-400">
          {tiersEarned} of {totalTiers} tiers earned. Each tier adds 1%,
          2%, 3%, then 5% per tier after that, forever. Selling the
          company keeps every trophy; only a full progress reset clears
          the shelf.
        </p>
      </Panel>
      {shared.ACHIEVEMENTS.map((def) => (
        <AchievementCard
          key={def.id}
          def={def}
          ctx={ctx}
          showBars={showBars}
        />
      ))}
    </SectionLayout>
  );
}

/** One achievement: badges, next goal with progress, and flavor. */
function AchievementCard({ def, ctx, showBars }) {
  const progress = shared.achievementProgress(def.id, ctx);
  if (!progress) return null;
  const { tier, maxTier, current, nextThreshold, complete } = progress;
  const earned = tier > 0;
  const secret = def.hidden && !earned;
  const multiTier = maxTier > 1;
  const nextTier = complete ? maxTier : tier + 1;
  const earnedPercent = shared.achievementCumulativeBuffPercent(tier);

  return (
    <Panel
      className={`px-3 py-2 flex flex-col gap-1 m-0 ${
        earned ? "" : "opacity-70"
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="m-0 text-sm font-bold">
          {secret ? "??? (hidden)" : def.name}
        </h3>
        {multiTier && !secret && (
          <span className="flex gap-1" aria-label={`Tier ${tier} of ${maxTier}`}>
            {def.thresholds.map((_, index) => (
              <span
                key={index}
                className={`text-[10px] px-1 rounded ${
                  index < tier
                    ? "bg-yellow-500 text-black font-bold"
                    : "bg-gray-700 text-gray-400"
                }`}
              >
                {shared.achievementTierLabel(index + 1)}
              </span>
            ))}
          </span>
        )}
        {earned && (
          <span className="ml-auto text-xs text-green-400">
            +{earnedPercent}% LOC
          </span>
        )}
      </div>
      {secret ? (
        <p className="m-0 text-xs text-gray-400">
          A hidden achievement. Play weird and it will find you.
        </p>
      ) : (
        <>
          <p className="m-0 text-xs">
            {complete ? "All tiers earned. " : ""}
            {shared.achievementTierDescription(def.id, nextTier)}
            {!complete && (
              <span className="text-gray-400">
                {" "}
                (Tier {shared.achievementTierLabel(nextTier)}: +
                {shared.achievementTierBuffPercent(nextTier)}% LOC)
              </span>
            )}
          </p>
          {!complete && nextThreshold > 1 && (
            <ProgressBar
              current={Math.min(Math.floor(current), nextThreshold)}
              target={nextThreshold}
              label="Progress"
              showBar={showBars}
            />
          )}
          <p className="m-0 text-xs italic text-gray-400">{def.flavor}</p>
        </>
      )}
    </Panel>
  );
}
