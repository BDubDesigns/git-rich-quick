/**
 * Get Rich Quick GIT — shared game balance.
 *
 * Single source of truth for every number the game runs on. Imported by
 * both sides, so the client and the save server can never drift apart:
 * - Client: `client/src/context/GameContext.jsx` rebuilds its display
 *   configs (names, icons, descriptions) on top of these numbers.
 * - Server: `server/src/validate.js` runs the save validation against
 *   these numbers and the pure formulas below.
 *
 * Plain ESM, no React, no Node-only APIs, so both sides can import it.
 * Numbers verified against `GameContext.jsx` at master 86053c3.
 *
 * The save-state shape these helpers operate on (see
 * `save-schema-validation-spec.md`):
 *   employees: flat counts { intern, junior, senior }
 *   openSourceProjects: levels as plain numbers
 *     { overReactFramework, blocker, constellation, starBroker }
 *   aiAssistants: flat counts { noPilot }
 *   activeStarEffects: timed golden-star buffs
 *     [{ effect, multiplier, expiresAtMs, employeeType }]
 */

// Number abbreviation (issue #42) — the shared formatter, used by
// starRewardDetail so star-reward text (floating text + email) abbreviates
// large LOC/money the same way every other display does.
import { formatMoney, formatNumber } from "./formatNumber.js";

/**
 * Constellation unlock threshold (star fix slice): golden stars require
 * an unlock, like every other purchasable. Constellation unlocks at
 * 500 lifetime LOC (TOTAL_LOC) — visible at 10% progress (50 LOC).
 * A tuning value from the design discussion with Brandon; one line to
 * change. A veteran who already bought Constellation levels is safe:
 * L1 costs 1000 LOC, so their lifetime LOC is necessarily at/above it.
 */
export const CONSTELLATION_UNLOCK_TOTAL_LOC = 500;

/**
 * StarBroker unlock threshold: buying stars is a later-game power than
 * finding them, so StarBroker unlocks at 5000 lifetime LOC (TOTAL_LOC)
 * — visible at 10% progress (500 LOC). A tuning value; one line to
 * change. It sits after Constellation (500), so a player has had
 * natural stars for a while before they can buy one.
 */
export const STARBROKER_UNLOCK_TOTAL_LOC = 5000;

/**
 * StarBroker (buy a golden star): the bought-star economy.
 *
 * - `costLocPerSecondMultiplier`: a bought star costs this many seconds
 *   of the player's passive LOC/s (30x), FLAT at every level — Brandon
 *   explicitly decided NOT to cut the price per level (30 seconds of
 *   passive gain for a star is already cheap, especially for a 2-star
 *   combo). The cost is computed from the player's CURRENT passive
 *   LOC/s at the moment of purchase.
 * - `cooldownSeconds`: the cooldown before another star can be bought,
 *   per StarBroker level (index level-1). Each level halves it: 8 min,
 *   4 min, 2 min, 1 min, 30 s.
 */
export const STARBROKER_CONFIG = Object.freeze({
  costLocPerSecondMultiplier: 30,
  cooldownSeconds: Object.freeze([480, 240, 120, 60, 30]),
});

/** Cooldown (seconds) before another star can be bought, at a StarBroker level; null at level 0. */
export function starBrokerCooldownSeconds(starBrokerLevel) {
  if (starBrokerLevel < 1) return null;
  const index = Math.min(
    starBrokerLevel,
    STARBROKER_CONFIG.cooldownSeconds.length
  ) - 1;
  return STARBROKER_CONFIG.cooldownSeconds[index];
}

/** LOC cost of buying one star, from the player's passive LOC/s. Flat at every level. */
export function starBrokerBuyCost(locPerSecondValue) {
  return Math.floor(
    STARBROKER_CONFIG.costLocPerSecondMultiplier * locPerSecondValue
  );
}

/**
 * "8m" / "30s" for a cooldown in seconds. Exact minutes drop the
 * "0s" ("8m", not "8m 0s"); anything under a minute is just seconds.
 */
export function formatCooldownSeconds(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

/**
 * Floating text for buying a StarBroker level: the new cooldown, not a
 * numeric bonus. StarBroker has no numeric bonus (its levels are
 * { type: "STAR", value: 0 }), so the generic "+N TYPE" label would
 * read "+0 STAR". The shorter cooldown IS the benefit.
 */
export function starBrokerLevelUpFloatText(newLevel) {
  return `Cooldown ${formatCooldownSeconds(starBrokerCooldownSeconds(newLevel))}!`;
}

/**
 * Moonshot (issue #165): the red gamble star. Gold means reward, red
 * means gamble (Golden Cookie vs Wrath Cookie). Golden stars are always
 * good (STAR_CONFIG.goodChance 1.0); the bad outcomes live here.
 *
 * Two Open Source projects carry it:
 * - Moonshot (opt-in, 1 level): unlocks at Constellation L1+ AND
 *   `goldStarsToUnlock` gold stars clicked (lifetime, in
 *   achievements.goldStarsClicked). Buying it asks for confirmation.
 *   Once owned, each natural star spawn is red with `redStarChance`.
 * - Launch Pad (buy a red star, 5 levels): unlocks when Moonshot is
 *   owned; StarBroker is NOT required. A red star costs
 *   `buyCostLocPerSecondMultiplier` x passive LOC/s (the same 30x as a
 *   gold star) with the StarBroker cooldown ladder per level.
 *
 * StarBroker and Launch Pad share ONE buy timer (lastStarBuyAtMs): a
 * player can own both, but buys one or the other per cooldown.
 *
 * Every red star rolls `jackpotChance` To the Moon (all passive
 * production x`jackpotMultiplier` for `jackpotDurationSeconds`, its
 * own timed effect, so it stacks with a live Overclock), otherwise a
 * crash: one unlocked bad effect at its existing softened values and
 * weights (Shooting Stars has no bad version and is gold-only).
 *
 * Expected value in seconds of passive LOC/s: a bought red star nets
 * about +83s (1/3 x 360 - 2/3 x 10 - 30) vs about +70s for a bought
 * gold star: a similar average with much more variance.
 */
export const MOONSHOT_CONFIG = Object.freeze({
  /** Gold stars a player must have clicked (lifetime) to unlock Moonshot. */
  goldStarsToUnlock: 25,
  /** Constellation level Moonshot needs (you need good stars first). */
  constellationLevelToUnlock: 1,
  /** Chance a natural star spawns red once Moonshot is owned. */
  redStarChance: 0.25,
  /** Chance a clicked red star is To the Moon (vs a crash). */
  jackpotChance: 1 / 3,
  /** To the Moon: all passive production multiplier. */
  jackpotMultiplier: 25,
  /** To the Moon duration, in seconds. Shorter than the shortest buy cooldown. */
  jackpotDurationSeconds: 15,
  /** Display name of the jackpot (locked by Brandon). */
  jackpotName: "To the Moon",
  /** A bought red star costs this many seconds of passive LOC/s. */
  buyCostLocPerSecondMultiplier: 30,
  /** Launch Pad cooldown per level (index level-1): the StarBroker ladder. */
  launchPadCooldownSeconds: Object.freeze([480, 240, 120, 60, 30]),
});

/** Cooldown (seconds) before another star can be bought, at a Launch Pad level; null at level 0. */
export function launchPadCooldownSeconds(launchPadLevel) {
  const level = Math.floor(Number(launchPadLevel) || 0);
  if (level < 1) return null;
  const ladder = MOONSHOT_CONFIG.launchPadCooldownSeconds;
  return ladder[Math.min(level, ladder.length) - 1];
}

/** LOC cost of buying one red star, from the player's passive LOC/s. */
export function launchPadBuyCost(locPerSecondValue) {
  const rate = Number(locPerSecondValue);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.floor(MOONSHOT_CONFIG.buyCostLocPerSecondMultiplier * rate);
}

/** Floating text for buying a Launch Pad level: the new cooldown. */
export function launchPadLevelUpFloatText(newLevel) {
  return `Cooldown ${formatCooldownSeconds(launchPadCooldownSeconds(newLevel))}!`;
}

/**
 * Seconds left on the shared star buy timer (StarBroker and Launch Pad
 * share lastStarBuyAtMs), for a button whose cooldown is
 * `cooldownSeconds`. 0 when ready: never bought (null), no cooldown
 * (null, the project is unowned), or the cooldown has passed. Each
 * button counts its OWN cooldown from the last buy of EITHER color,
 * so any buy locks both. NaN-safe: a non-finite reading is ready.
 */
export function starBuyCooldownRemainingSeconds(
  cooldownSeconds,
  lastStarBuyAtMs,
  nowMs
) {
  if (
    cooldownSeconds === null ||
    lastStarBuyAtMs === null ||
    lastStarBuyAtMs === undefined ||
    !Number.isFinite(Number(cooldownSeconds)) ||
    !Number.isFinite(Number(lastStarBuyAtMs)) ||
    !Number.isFinite(Number(nowMs))
  ) {
    return 0;
  }
  return Math.max(
    0,
    Math.ceil(Number(cooldownSeconds) - (Number(nowMs) - Number(lastStarBuyAtMs)) / 1000)
  );
}

/**
 * Roll whether a natural star spawns red. Only after the player owns
 * Moonshot (level 1); before that every star is gold. Rolled at SPAWN
 * time (the color is visible), the outcome is rolled at click.
 */
export function rollStarIsRed(moonshotLevel, rng = Math.random) {
  if (!(Math.floor(Number(moonshotLevel) || 0) >= 1)) return false;
  return rng() < MOONSHOT_CONFIG.redStarChance;
}

/** The Moonshot odds as card copy: "1 in 4 stars fall red · 1 in 3 red stars go To the Moon". */
export function moonshotOddsText() {
  const red = Math.round(1 / MOONSHOT_CONFIG.redStarChance);
  const moon = Math.round(1 / MOONSHOT_CONFIG.jackpotChance);
  return `1 in ${red} stars fall red · 1 in ${moon} red stars go ${MOONSHOT_CONFIG.jackpotName}`;
}

/** The bad effects a red star can crash into at a Constellation level (no Shooting Stars). */
export function moonshotCrashEffects(constellationLevel) {
  return unlockedStarEffects(constellationLevel).filter(
    (id) => id !== "shootingStars"
  );
}

/**
 * Resolve a clicked red star into a claim (the same claim shape as a
 * golden star, plus `red: true`). 1 in 3 is To the Moon (effect
 * "moonshot", a timed x25 production buff for 15s); otherwise a crash:
 * a weighted pick from the unlocked bad effects, resolved with the
 * existing softened bad values. Pure; `rng` is injectable.
 */
export function resolveMoonshotClaim({
  constellationLevel,
  locPerSecond,
  money,
  linesOfCode,
  employeeCounts,
  rng = Math.random,
}) {
  if (rng() < MOONSHOT_CONFIG.jackpotChance) {
    return {
      effect: "moonshot",
      good: true,
      locDelta: 0,
      moneyDelta: 0,
      multiplier: MOONSHOT_CONFIG.jackpotMultiplier,
      durationSeconds: MOONSHOT_CONFIG.jackpotDurationSeconds,
      employeeType: null,
      red: true,
    };
  }
  const pool = moonshotCrashEffects(constellationLevel);
  const effects = pool.length > 0 ? pool : ["lucky"];
  const totalWeight = effects.reduce(
    (sum, id) => sum + STAR_CONFIG.effects[id].weight,
    0
  );
  let roll = rng() * totalWeight;
  let effect = effects[effects.length - 1];
  for (const id of effects) {
    roll -= STAR_CONFIG.effects[id].weight;
    if (roll < 0) {
      effect = id;
      break;
    }
  }
  const claim = resolveStarClaim({
    effect,
    good: false,
    locPerSecond: Number.isFinite(Number(locPerSecond)) ? Number(locPerSecond) : 0,
    money: Number.isFinite(Number(money)) ? Number(money) : 0,
    linesOfCode: Number.isFinite(Number(linesOfCode)) ? Number(linesOfCode) : 0,
    employeeCounts: employeeCounts ?? {},
    rng,
  });
  return { ...claim, red: true };
}

/**
 * ===== Funding Rounds (issue #170, design in #169) =====
 *
 * The progression gate. The upgrade tracks below are capped by the
 * Funding Rounds rank (a permanent store track bought with Equity,
 * PRESTIGE_STORE_CONFIG.fundingRounds): each round raises the caps,
 * so the game extends to higher numbers behind Equity instead of
 * inflating one company. The rank survives every sale; the levels it
 * unlocks still reset on sale like every other upgrade, and each new
 * company re-buys them.
 *
 * - roundNames: locked by Brandon (Nov 19).
 * - rankCosts: the Equity price of each round, locked (5 / 20 / 60 /
 *   150 / 300). With the 87-Equity store the whole store is 622.
 * - passiveTrackMultiplier / passiveTrackCostGrowth: the Intern,
 *   Junior and Senior tracks give 1.4x per level (was 2x) and cost
 *   2.5x the previous level (was 2x). 21 levels at 1.4x is 1,171x,
 *   about where the old 10-level track ended (1,024x), spread over
 *   five gates. A round adds 3 levels (1.4^3 = 2.7x), and three cost
 *   steps (2.5^3 = 15.6x) outrun the whole round's growth, so each new
 *   level costs a little more time than the last.
 * - scrumMasterBoostPerLevel: Scrum Master is LINEAR now, not a
 *   doubler: the per-manager boost is 1% x (1 + level). It used to
 *   double a term that already multiplied the whole passive rate.
 * - levelCaps: the highest level each gated track can reach, indexed
 *   by Funding Rounds rank (0 = Bootstrapped, no round bought). The
 *   last cap is the track's full length. Blocker, OverReact and the
 *   star projects are not gated. Ship Happens joined the gated tracks
 *   in issue #192 (folding in #186 with revised caps): 1 / 3 / 6 / 8 /
 *   9 / 10, power unchanged (2x ships per level, whole ships). At
 *   level 5 with 10 managers it shipped 320 projects a second in
 *   Brandon's first company, which deleted the money gate on hiring.
 * - bridgeRoundPrices: the LOC price of a Bridge Round (issue #192,
 *   design in #187) at Funding Rounds rank 0 / 1 / 2 (Bootstrapped,
 *   Seed, Series A): 1B / 14B / 200B, about 40% of the base cost of
 *   the tier each one opens (2.553B / 34.85B / 515.0B), rounded to
 *   clean shop numbers. Playtest starting values: if the save-up feels
 *   like a second wall, price is the first knob. No bridge past
 *   Series A: Series C plus a bridge breaks the click invariant (1.358
 *   at the pinned Series C headcount), and a Series B bridge would
 *   move the toll-booth weakness onto Series C.
 *
 * Price as time: in the balanced-player simulation the new levels of
 * a round cost 2 to 5 minutes of production early and up to about an
 * hour at IPO; owned-before levels re-buy in seconds.
 */
export const FUNDING_ROUNDS_CONFIG = Object.freeze({
  roundNames: Object.freeze(["Seed", "Series A", "Series B", "Series C", "IPO"]),
  rankCosts: Object.freeze([5, 20, 60, 150, 300]),
  /** Name of the round before any is bought. */
  bootstrappedName: "Bootstrapped",
  passiveTrackMultiplier: 1.4,
  passiveTrackCostGrowth: 2.5,
  /** Cost rounding for the 2.5x tracks, so the shop shows clean prices. */
  passiveTrackCostSignificantFigures: 3,
  scrumMasterBoostPerLevel: 1,
  levelCaps: Object.freeze({
    coffeeScript: Object.freeze([6, 9, 12, 15, 18, 21]),
    juniorAchievement: Object.freeze([6, 9, 12, 15, 18, 21]),
    seniorMoment: Object.freeze([6, 9, 12, 15, 18, 21]),
    scrumMaster: Object.freeze([5, 8, 11, 14, 17, 20]),
    commitmentIssues: Object.freeze([6, 8, 10, 12, 14, 16]),
    shipHappens: Object.freeze([1, 3, 6, 8, 9, 10]),
  }),
  bridgeRoundPrices: Object.freeze([1_000_000_000, 14_000_000_000, 200_000_000_000]),
});

/**
 * Bridge Round (issue #192): the Open Source id of the one-level LOC
 * purchase that rents the next Funding Round's caps for the current
 * company. See bridgeRoundOwned / effectiveFundingRoundRank below.
 */
export const BRIDGE_ROUND_PROJECT_ID = "bridgeRound";

/**
 * Lifetime LOC at which the Bridge Round card unlocks (visible at 10%,
 * the first Equity). A tuning value: about a fifth of the way to the
 * Bootstrapped wall (the playtest walled at 589M), so the bridge is
 * on the board as a goal before the caps bite.
 */
export const BRIDGE_ROUND_UNLOCK_TOTAL_LOC = 100_000_000;

/** Full track length of a gated project: its top cap. */
function gatedTrackLength(projectId) {
  const caps = FUNDING_ROUNDS_CONFIG.levelCaps[projectId];
  return caps[caps.length - 1];
}

/** Round to `figures` significant figures (48,828,125 -> 48,800,000). */
function roundToSignificant(value, figures) {
  if (!(value > 0)) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - figures + 1);
  return Math.round(value / magnitude) * magnitude;
}

/**
 * Track levels for one employee type (issue #118, retuned in #170).
 * `bonus` is the per-level effect, read by doublingTrackMultiplier,
 * never by the CLICK_BOOST / PASSIVE_BOOST sums:
 * - { type: "MULTIPLY", value: f }: each level multiplies the output
 *   by f (1.4 for the passive tracks, 2 for Commitment Issues and
 *   Ship Happens).
 * - { type: "LINEAR", value: s }: each level adds s to a (1 + sum)
 *   factor (Scrum Master: 1 + level).
 *
 * Level i+1 costs base x costGrowth^i. A cost that is not already
 * whole is rounded to `significantFigures` (when given) so the shop
 * shows clean prices; otherwise to the nearest LOC.
 */
function trackLevels(
  baseCost,
  {
    count = 10,
    costGrowth = 2,
    significantFigures = null,
    bonus = { type: "MULTIPLY", value: 2 },
  } = {}
) {
  const frozenBonus = Object.freeze({ ...bonus });
  return Object.freeze(
    Array.from({ length: count }, (_, i) => {
      const raw = baseCost * Math.pow(costGrowth, i);
      return Object.freeze({
        locCost:
          significantFigures === null
            ? Math.round(raw)
            : roundToSignificant(raw, significantFigures),
        bonus: frozenBonus,
      });
    })
  );
}

/** A passive (Intern / Junior / Senior) track: 1.4x per level, 2.5x cost. */
function passiveTrackLevels(projectId, baseCost) {
  return trackLevels(baseCost, {
    count: gatedTrackLength(projectId),
    costGrowth: FUNDING_ROUNDS_CONFIG.passiveTrackCostGrowth,
    significantFigures: FUNDING_ROUNDS_CONFIG.passiveTrackCostSignificantFigures,
    bonus: { type: "MULTIPLY", value: FUNDING_ROUNDS_CONFIG.passiveTrackMultiplier },
  });
}

/**
 * Click track (issue #160, re-derived from #151). The invariant: a
 * player who buys every click upgrade affordable in about 3 minutes of
 * passive has click output at 10 clicks/s roughly equal to passive
 * LOC/s, so total LOC/s is about double passive, at every stage.
 *
 * Each level's cost is 3 minutes of the passive rate it is meant to
 * match (T x P_k, rounded to 2 significant figures), where P_k solves
 * 10 x click(P_k) = 1.48 x P_k. The 1.48 is sqrt(2.2): click jumps on a
 * purchase and then falls behind as passive grows, so aiming each
 * level slightly above parity centres the sawtooth on 1:1. The Commit
 * Specialist count at a stage is calibrated to Brandon's Nov 18 live
 * save (5 Specialists at 533 LOC/s), which the model reproduces
 * exactly (4.80x click before this change).
 *
 * Commitment Issues: 20 levels, every one still doubles the Commit
 * Specialist bonus (2x power), but each costs 2.05x to 2.83x the last
 * (was sqrt(2), about 1.41x). Power stepping 2x on cost stepping
 * 1.41x is what ran away (click 4,300x passive within 30 minutes in
 * the balanced-player simulation): once click income passes passive,
 * each level got cheaper in time than the last. With every cost step
 * at or above the 2x power step, clicking alone can never buy the next
 * level faster than the last; passive has to grow to keep up. The steps
 * are larger early because the Commit Specialist count also grows
 * fastest early. The power per level is unchanged, so an existing
 * player keeps exactly what each owned level gives.
 *
 * Funding Rounds (issue #170): the track is 16 levels now (levels 17
 * to 20 are dropped), gated 6 / 8 / 10 / 12 / 14 / 16 by round. Click
 * still doubles per level while passive grows 1.4x per level, so the
 * round caps are what keep click at 10 clicks/s between 0.8x and 1.3x
 * passive at every round's plateau (pinned in click-balance.test.js).
 */
export const COMMITMENT_ISSUES_LEVELS = Object.freeze({
  count: 16,
  costs: Object.freeze([
    460_000, 1_300_000, 3_300_000, 8_000_000, 19_000_000, 43_000_000,
    96_000_000, 210_000_000, 470_000_000, 1_000_000_000, 2_200_000_000,
    4_700_000_000, 10_000_000_000, 21_000_000_000, 45_000_000_000,
    95_000_000_000,
  ]),
});

/** Commitment Issues levels at explicit costs (each level is 2x power). */
function doublingLevelsAtCosts(costs) {
  return Object.freeze(
    costs.map((locCost) =>
      Object.freeze({
        locCost,
        bonus: Object.freeze({ type: "MULTIPLY", value: 2 }),
      })
    )
  );
}

export const BALANCE = Object.freeze({
  mechanics: Object.freeze({
    tickIntervalMs: 1000,
    baseLocPerClick: 1,
    startingMoney: 0, // cents
    startingLoc: 0,
  }),

  employees: Object.freeze({
    // Cosmetics (issue #11): each employee type has one cosmetic
    // slot (the thing being skinned — its icon) and a list of
    // unlocks, each firing when the owned count reaches its trigger.
    // One cosmetic per tier at 25 hires in v1; the system is
    // extensible — add more entries to cosmeticUnlocks.
    intern: Object.freeze({
      baseCost: 2500, // cents
      locPerSecond: 1,
      costMultiplier: 1.1,
      unlockConditions: Object.freeze([]),
      cosmeticSlot: "employeeIcon_intern",
      cosmeticUnlocks: Object.freeze([
        Object.freeze({ triggerCount: 25, cosmeticId: "intern-icon-bronze" }),
      ]),
    }),
    junior: Object.freeze({
      baseCost: 20000,
      locPerSecond: 5,
      costMultiplier: 1.15,
      unlockConditions: Object.freeze([
        Object.freeze({ type: "TOTAL_LOC", target: 100 }),
      ]),
      cosmeticSlot: "employeeIcon_junior",
      cosmeticUnlocks: Object.freeze([
        Object.freeze({ triggerCount: 25, cosmeticId: "junior-icon-silver" }),
      ]),
    }),
    senior: Object.freeze({
      baseCost: 150000,
      locPerSecond: 20,
      costMultiplier: 1.2,
      unlockConditions: Object.freeze([
        Object.freeze({ type: "TOTAL_LOC", target: 3000 }),
        Object.freeze({ type: "TOTAL_EMPLOYEE_COUNT", target: 10 }),
      ]),
      cosmeticSlot: "employeeIcon_senior",
      cosmeticUnlocks: Object.freeze([
        Object.freeze({ triggerCount: 25, cosmeticId: "senior-icon-gold" }),
      ]),
    }),
    // Each Project Manager adds +1% to ALL employee passive LOC.
    // (The passive half of the original "+1% to all output" Project
    // Manager idea, now scoped to passive only.)
    projectManager: Object.freeze({
      baseCost: 500000,
      locPerSecond: 0,
      costMultiplier: 1.2,
      passiveBoostPerEmployee: 0.01,
      unlockConditions: Object.freeze([
        Object.freeze({ type: "TOTAL_LOC", target: 50000 }),
        Object.freeze({ type: "TOTAL_EMPLOYEE_COUNT", target: 25 }),
      ]),
      cosmeticSlot: "employeeIcon_projectManager",
      cosmeticUnlocks: Object.freeze([
        Object.freeze({
          triggerCount: 25,
          cosmeticId: "projectManager-icon-platinum",
        }),
      ]),
    }),
    // Each Commit Specialist adds +0.2 LOC to each manual click, and
    // the bonus gets the same OverReact click boost as the base manual
    // click (see locPerClick); the FINAL click total is floored to a
    // whole number.
    // Issue #151: $4,000 base at 1.1x per hire (was $5,000 at 1.2x),
    // so a click build is affordable: the 10th hire is about $9,400
    // (was $25,799) and the first 25 total about $393k (was $2.36M).
    commitSpecialist: Object.freeze({
      baseCost: 400000,
      locPerSecond: 0,
      costMultiplier: 1.1,
      clickBonusPerEmployee: 0.2,
      unlockConditions: Object.freeze([
        Object.freeze({ type: "TOTAL_LOC", target: 25000 }),
        Object.freeze({ type: "TOTAL_EMPLOYEE_COUNT", target: 20 }),
      ]),
      cosmeticSlot: "employeeIcon_commitSpecialist",
      cosmeticUnlocks: Object.freeze([
        Object.freeze({
          triggerCount: 25,
          cosmeticId: "commitSpecialist-icon-diamond",
        }),
      ]),
    }),
    // Release Manager (auto-ships freelance projects). Each manager is
    // assigned to one freelance project and automatically ships one of
    // it per ship interval (see RELEASE_MANAGER_CONFIG), as long as the
    // player has enough LOC to cover that project's cost at that
    // moment; if not, it waits for the next interval. A manager with
    // no assignment does nothing. This is the assignment strategy:
    // park managers on the efficient small project (To Do List App)
    // and let them hammer it while you do other things. The manager
    // contributes nothing to passive LOC or clicks — its value is the
    // auto-ship. `autoShip` marks the type for the client card
    // (employeeReturnsLine shows the ship rate, not a LOC/s rate).
    releaseManager: Object.freeze({
      baseCost: 500000,
      locPerSecond: 0,
      costMultiplier: 1.2,
      autoShip: true,
      unlockConditions: Object.freeze([
        Object.freeze({ type: "TOTAL_LOC", target: 100000 }),
        Object.freeze({ type: "TOTAL_EMPLOYEE_COUNT", target: 30 }),
      ]),
      cosmeticSlot: "employeeIcon_releaseManager",
      cosmeticUnlocks: Object.freeze([
        Object.freeze({
          triggerCount: 25,
          cosmeticId: "releaseManager-icon-ruby",
        }),
      ]),
    }),
  }),

  aiAssistants: Object.freeze({
    // Defined in the client but never wired to a buy action or a formula,
    // so v1 freezes the count at 0. See the save spec's NoPilot flag.
    noPilot: Object.freeze({
      baseCost: 100000, // cents
      multiplier: 0.05,
      costMultiplier: 1.5,
    }),
  }),

  freelanceProjects: Object.freeze({
    // The To Do List App is the starter gig: no unlock conditions.
    toDoListApp: Object.freeze({
      loc: 50,
      reward: 3000, // cents
      unlockConditions: Object.freeze([]),
    }),
    // Hobby Website (issue #19): unlocks after shipping 50 To Do List
    // Apps — discovered after 5, at the 10% visibility threshold.
    hobbyWebsite: Object.freeze({
      loc: 750,
      reward: 36000,
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_PROJECT_COUNT",
          projectKey: "toDoListApp",
          target: 50,
        }),
      ]),
    }),
    // Blockchain Project (issue #19): 200 total projects shipped, of
    // which 50 must be Hobby Websites.
    paradigmShiftingBlockchainProject: Object.freeze({
      loc: 2000,
      reward: 80000,
      unlockConditions: Object.freeze([
        Object.freeze({ type: "TOTAL_PROJECTS_COUNT", target: 200 }),
        Object.freeze({
          type: "SPECIFIC_PROJECT_COUNT",
          projectKey: "hobbyWebsite",
          target: 50,
        }),
      ]),
    }),
    // AI-Powered Dashboard: 6000 LOC -> 204000c (34c/LOC). The rate
    // keeps falling as the LOC cost rises (the tradeoff: hammer the
    // cheap efficient gigs, or spam the big ones for faster money but
    // less per LOC). Unlocks after shipping 25 Blockchain Projects.
    aiPoweredDashboard: Object.freeze({
      loc: 6000,
      reward: 204000,
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_PROJECT_COUNT",
          projectKey: "paradigmShiftingBlockchainProject",
          target: 25,
        }),
      ]),
    }),
    // NFT Marketplace: 20000 LOC -> 580000c (29c/LOC). Unlocks after
    // shipping 500 AI-Powered Dashboards and 1000 total projects.
    nftMarketplace: Object.freeze({
      loc: 20000,
      reward: 580000,
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_PROJECT_COUNT",
          projectKey: "aiPoweredDashboard",
          target: 500,
        }),
        Object.freeze({ type: "TOTAL_PROJECTS_COUNT", target: 1000 }),
      ]),
    }),
    // Metaverse Real Estate: 60000 LOC -> 1500000c (25c/LOC).
    // Unlocks after shipping 500 NFT Marketplaces and 2000 total.
    metaverseRealEstate: Object.freeze({
      loc: 60000,
      reward: 1500000,
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_PROJECT_COUNT",
          projectKey: "nftMarketplace",
          target: 500,
        }),
        Object.freeze({ type: "TOTAL_PROJECTS_COUNT", target: 2000 }),
      ]),
    }),
    // Quantum To-Do List: 200000 LOC -> 4200000c (21c/LOC). Unlocks
    // after shipping 500 Metaverse Real Estates and 4000 total.
    quantumToDoList: Object.freeze({
      loc: 200000,
      reward: 4200000,
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_PROJECT_COUNT",
          projectKey: "metaverseRealEstate",
          target: 500,
        }),
        Object.freeze({ type: "TOTAL_PROJECTS_COUNT", target: 4000 }),
      ]),
    }),
  }),

  openSource: Object.freeze({
    // OverReact, the base click multiplier (issue #160, re-derived from
    // #151): 10 levels, a smooth climb in the click multiplier
    // (1 + CLICK_BOOST sum): 2, 3, 4, 5, 7, 10, 14, 20, 28, 40, about
    // 1.4x per level (whole multipliers, so a base click of 1 always
    // gains). From L3 on, each level costs 3 minutes of the passive rate
    // it matches (see COMMITMENT_ISSUES_LEVELS), so the costs climb
    // about 1.4x too, in step with the power: clicking alone cannot buy
    // the next level faster than the last. L1 and L2 stay 100 and 500
    // LOC: at the very start there is no passive to match, and the
    // first upgrades must come from clicking. The old top of 128x at
    // 75,000 LOC put Brandon's click at 4.8x passive (Nov 18).
    overReactFramework: Object.freeze({
      unlockConditions: Object.freeze([]),
      levels: Object.freeze([
        Object.freeze({
          locCost: 100,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 1 }),
        }),
        Object.freeze({
          locCost: 500,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 1 }),
        }),
        Object.freeze({
          locCost: 4_900,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 1 }),
        }),
        Object.freeze({
          locCost: 6_100,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 1 }),
        }),
        Object.freeze({
          locCost: 8_500,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 2 }),
        }),
        Object.freeze({
          locCost: 12_000,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 3 }),
        }),
        Object.freeze({
          locCost: 17_000,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 4 }),
        }),
        Object.freeze({
          locCost: 24_000,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 6 }),
        }),
        Object.freeze({
          locCost: 34_000,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 8 }),
        }),
        Object.freeze({
          locCost: 49_000,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 12 }),
        }),
      ]),
    }),
    blocker: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_EMPLOYEE_COUNT",
          employeeType: "junior",
          target: 5,
        }),
      ]),
      levels: Object.freeze([
        Object.freeze({
          locCost: 2000,
          bonus: Object.freeze({ type: "PASSIVE_BOOST", value: 0.5 }),
        }),
        Object.freeze({
          locCost: 10000,
          bonus: Object.freeze({ type: "PASSIVE_BOOST", value: 1 }),
        }),
        Object.freeze({
          locCost: 75000,
          bonus: Object.freeze({ type: "PASSIVE_BOOST", value: 1.5 }),
        }),
        // Extra levels (issue #33 slice): same per-level passive
        // boost as the existing levels (+0.5 each level).
        Object.freeze({
          locCost: 300000,
          bonus: Object.freeze({ type: "PASSIVE_BOOST", value: 2 }),
        }),
        Object.freeze({
          locCost: 1500000,
          bonus: Object.freeze({ type: "PASSIVE_BOOST", value: 2.5 }),
        }),
      ]),
    }),
    // GitNub Constellation (issue #33): the golden-star project. One
    // project, many tiers — each level unlocks a new star effect and,
    // every other level, makes stars spawn faster. It has no numeric
    // bonus (type STAR, value 0): no LOC formula reads it. The star
    // mechanic itself lives in STAR_CONFIG below. Unlock (star fix
    // slice): TOTAL_LOC >= CONSTELLATION_UNLOCK_TOTAL_LOC — stars
    // require an unlock, like every other purchasable.
    constellation: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "TOTAL_LOC",
          target: CONSTELLATION_UNLOCK_TOTAL_LOC,
        }),
      ]),
      levels: Object.freeze([
        Object.freeze({
          locCost: 1000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 5000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 20000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 75000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 250000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        // L6 unlocks Hype Train, L7 unlocks AGI (issue #157). Priced on
        // the existing ramp (L5 250K, StarBroker and Launch Pad L5 2M):
        // a few minutes of mid-game production each.
        Object.freeze({
          locCost: 750000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 2000000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
      ]),
    }),
    // StarBroker: buy a golden star on demand. Each level halves the
    // cooldown before another star can be bought (STARBROKER_CONFIG);
    // the cost stays flat at 30x passive LOC/s at every level
    // (Brandon's call — 30 seconds of passive gain is already cheap
    // for a star, especially stacked with a natural one). It has no
    // numeric bonus (type STAR, value 0): no LOC formula reads it —
    // the bought-star mechanic lives in STARBROKER_CONFIG and the
    // client (the buy is local now). A bought star never touches the
    // natural star timer: the whole point is stacking a bought star
    // with a natural one. Unlock: TOTAL_LOC >= STARBROKER_UNLOCK_TOTAL_LOC
    // (5000) — a later-game power than Constellation (500). Level
    // costs mirror Constellation's scale; tuning values.
    starBroker: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "TOTAL_LOC",
          target: STARBROKER_UNLOCK_TOTAL_LOC,
        }),
      ]),
      levels: Object.freeze([
        Object.freeze({
          locCost: 10000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 40000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 150000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 500000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 2000000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
      ]),
    }),
    // Moonshot (issue #165): the opt-in for red gamble stars. One
    // level. Unlocks at Constellation L1+ and 25 gold stars clicked
    // (lifetime); buying it asks for confirmation. Once owned, 1 in 4
    // natural stars spawns red (MOONSHOT_CONFIG). Resets on sale like
    // every other upgrade. No numeric bonus (type STAR, value 0).
    moonshot: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "OPEN_SOURCE_LEVEL",
          projectId: "constellation",
          target: 1,
        }),
        Object.freeze({ type: "GOLD_STARS_CLICKED", target: 25 }),
      ]),
      levels: Object.freeze([
        Object.freeze({
          locCost: 20000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
      ]),
    }),
    // Launch Pad (issue #165): buy a red star on demand. Unlocks when
    // Moonshot is owned; StarBroker is not required. Level costs and
    // cooldowns mirror StarBroker (MOONSHOT_CONFIG.launchPadCooldownSeconds),
    // and it shares StarBroker's buy timer: one or the other per
    // cooldown. No numeric bonus (type STAR, value 0).
    launchPad: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "OPEN_SOURCE_LEVEL",
          projectId: "moonshot",
          target: 1,
        }),
      ]),
      levels: Object.freeze([
        Object.freeze({
          locCost: 10000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 40000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 150000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 500000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
        Object.freeze({
          locCost: 2000000,
          bonus: Object.freeze({ type: "STAR", value: 0 }),
        }),
      ]),
    }),
    // Track upgrades (issue #118, retuned in #170): one leveled GitNub
    // project per employee type. Unlock: own 10 of that type. Base
    // costs are unchanged tuning values. Funding Rounds (#170):
    // - CoffeeScript / Junior Achievement / Senior Moment: 21 levels,
    //   1.4x output per level, cost x2.5 per level (500K at L1 to
    //   45.5T at L21 for Senior Moment).
    // - Scrum Master: 20 levels, LINEAR, cost x2 per level: the
    //   per-manager boost is 1% x (1 + level).
    // - Commitment Issues: 16 levels, 2x per level (#160 prices).
    // - Ship Happens: unchanged and ungated, 10 levels at 2x.
    // The first five are capped by Funding Rounds rank
    // (FUNDING_ROUNDS_CONFIG.levelCaps).
    coffeeScript: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_EMPLOYEE_COUNT",
          employeeType: "intern",
          target: 10,
        }),
      ]),
      levels: passiveTrackLevels("coffeeScript", 100_000),
    }),
    juniorAchievement: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_EMPLOYEE_COUNT",
          employeeType: "junior",
          target: 10,
        }),
      ]),
      levels: passiveTrackLevels("juniorAchievement", 250_000),
    }),
    seniorMoment: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_EMPLOYEE_COUNT",
          employeeType: "senior",
          target: 10,
        }),
      ]),
      levels: passiveTrackLevels("seniorMoment", 500_000),
    }),
    scrumMaster: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_EMPLOYEE_COUNT",
          employeeType: "projectManager",
          target: 10,
        }),
      ]),
      levels: trackLevels(1_000_000, {
        count: gatedTrackLength("scrumMaster"),
        costGrowth: 2,
        bonus: {
          type: "LINEAR",
          value: FUNDING_ROUNDS_CONFIG.scrumMasterBoostPerLevel,
        },
      }),
    }),
    commitmentIssues: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_EMPLOYEE_COUNT",
          employeeType: "commitSpecialist",
          target: 10,
        }),
      ]),
      // Issue #160 prices, 16 levels (#170, see COMMITMENT_ISSUES_LEVELS).
      levels: doublingLevelsAtCosts(COMMITMENT_ISSUES_LEVELS.costs),
    }),
    shipHappens: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "SPECIFIC_EMPLOYEE_COUNT",
          employeeType: "releaseManager",
          target: 10,
        }),
      ]),
      levels: trackLevels(2_000_000),
    }),
    // Bridge Round (issue #192): one level, bought with LOC. Its price
    // depends on the Funding Rounds rank (FUNDING_ROUNDS_CONFIG.
    // bridgeRoundPrices, read through openSourceNextLevelCost); the
    // locCost here is the Bootstrapped price, the one a fresh player
    // sees. No numeric bonus (type BRIDGE, value 0): no LOC formula
    // reads it. Owning it lifts every gated track to the next round's
    // cap for this company (openSourceLevelCap). Resets on sale like
    // every Open Source level.
    bridgeRound: Object.freeze({
      unlockConditions: Object.freeze([
        Object.freeze({
          type: "TOTAL_LOC",
          target: BRIDGE_ROUND_UNLOCK_TOTAL_LOC,
        }),
      ]),
      levels: Object.freeze([
        Object.freeze({
          locCost: FUNDING_ROUNDS_CONFIG.bridgeRoundPrices[0],
          bonus: Object.freeze({ type: "BRIDGE", value: 0 }),
        }),
      ]),
    }),
  }),
});

export const EMPLOYEE_TYPES = Object.freeze([
  "intern",
  "junior",
  "senior",
  "projectManager",
  "commitSpecialist",
  "releaseManager",
]);
export const FREELANCE_PROJECT_KEYS = Object.freeze([
  "toDoListApp",
  "hobbyWebsite",
  "paradigmShiftingBlockchainProject",
  "aiPoweredDashboard",
  "nftMarketplace",
  "metaverseRealEstate",
  "quantumToDoList",
]);
export const OPEN_SOURCE_IDS = Object.freeze([
  "overReactFramework",
  "blocker",
  "constellation",
  "starBroker",
  "moonshot",
  "launchPad",
  "coffeeScript",
  "juniorAchievement",
  "seniorMoment",
  "scrumMaster",
  "commitmentIssues",
  "shipHappens",
  "bridgeRound",
]);

/** The six doubling-upgrade projects (issue #118). */
export const DOUBLING_PROJECT_IDS = Object.freeze([
  "coffeeScript",
  "juniorAchievement",
  "seniorMoment",
  "scrumMaster",
  "commitmentIssues",
  "shipHappens",
]);

/** Which employee type each doubling project doubles. */
export const DOUBLING_PROJECT_EMPLOYEE = Object.freeze({
  coffeeScript: "intern",
  juniorAchievement: "junior",
  seniorMoment: "senior",
  scrumMaster: "projectManager",
  commitmentIssues: "commitSpecialist",
  shipHappens: "releaseManager",
});

/**
 * The Moonshot projects (issue #165), added after the doubling
 * upgrades. normalizeSaveState / normalizeActions fill their missing
 * keys with fresh defaults (level 0, latch derived from the save), the
 * same way as the doubling projects. No backfill of any other field.
 */
export const MOONSHOT_PROJECT_IDS = Object.freeze(["moonshot", "launchPad"]);

/** Open Source ids added after the original set, filled in when a save predates them. */
const LATER_OPEN_SOURCE_IDS = Object.freeze([
  ...DOUBLING_PROJECT_IDS,
  ...MOONSHOT_PROJECT_IDS,
  BRIDGE_ROUND_PROJECT_ID,
]);

/** Whether a project id is one of the six doubling upgrades. */
export function isDoublingProject(projectId) {
  return DOUBLING_PROJECT_IDS.includes(projectId);
}

/** A guarded whole level: missing, negative or NaN reads 0. */
function safeLevel(level) {
  const n = Math.floor(Number(level));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The multiplier a track project gives at `level` (issue #118,
 * retuned in #170), read from the project's own level bonuses so
 * BALANCE stays the one source: MULTIPLY levels multiply (1.4^L for
 * the passive tracks, 2^L for Commitment Issues and Ship Happens),
 * LINEAR levels add to a (1 + sum) factor (Scrum Master: 1 + L).
 * 1 at level 0 or for a project that is not a track. The level is
 * clamped to the track's length and NaN-guarded.
 */
export function doublingTrackMultiplier(projectId, level) {
  const levels = BALANCE.openSource[projectId]?.levels;
  if (!levels || !isDoublingProject(projectId)) return 1;
  const n = Math.min(safeLevel(level), levels.length);
  let product = 1;
  let linear = 0;
  for (let i = 0; i < n; i += 1) {
    const bonus = levels[i].bonus;
    if (bonus.type === "MULTIPLY") product *= bonus.value;
    else if (bonus.type === "LINEAR") linear += bonus.value;
  }
  return product * (1 + linear);
}

/**
 * The output multiplier for an employee type from its track project:
 * doublingTrackMultiplier at that project's level, 1 when unowned or
 * at level 0. A missing level defaults to 0, never NaN.
 */
export function doublingMultiplier(employeeType, openSourceLevels = {}) {
  const projectId = Object.keys(DOUBLING_PROJECT_EMPLOYEE).find(
    (id) => DOUBLING_PROJECT_EMPLOYEE[id] === employeeType
  );
  if (!projectId) return 1;
  return doublingTrackMultiplier(projectId, openSourceLevels?.[projectId]);
}

/** The Funding Rounds rank owned (0 = Bootstrapped to 5 = IPO), guarded. */
export function fundingRoundRank(storeRanks = {}) {
  return Math.min(
    FUNDING_ROUNDS_CONFIG.rankCosts.length,
    safeLevel(storeRanks?.fundingRounds)
  );
}

/** The name of a Funding Rounds rank: "Bootstrapped" at 0, "Seed" at 1, ... "IPO" at 5. */
export function fundingRoundName(rank) {
  const r = safeLevel(rank);
  if (r < 1) return FUNDING_ROUNDS_CONFIG.bootstrappedName;
  const names = FUNDING_ROUNDS_CONFIG.roundNames;
  return names[Math.min(r, names.length) - 1];
}

/** Whether a project's levels are capped by Funding Rounds. */
export function isRoundGatedProject(projectId) {
  return Object.prototype.hasOwnProperty.call(
    FUNDING_ROUNDS_CONFIG.levelCaps,
    projectId
  );
}

/**
 * Whether a Bridge Round can be bought at the owned Funding Rounds
 * rank (issue #192): Bootstrapped, Seed and Series A only.
 */
export function bridgeRoundAvailable(storeRanks = {}) {
  return fundingRoundRank(storeRanks) < FUNDING_ROUNDS_CONFIG.bridgeRoundPrices.length;
}

/** The Bridge Round's LOC price at the owned rank, or null when none is offered (Series B and up). */
export function bridgeRoundPrice(storeRanks = {}) {
  if (!bridgeRoundAvailable(storeRanks)) return null;
  return FUNDING_ROUNDS_CONFIG.bridgeRoundPrices[fundingRoundRank(storeRanks)];
}

/**
 * Whether this company owns its Bridge Round. Reads the Bridge Round
 * level from an Open Source level map in either shape the game uses:
 * the save's flat levels ({ bridgeRound: 1 }) or the client reducer's
 * ({ bridgeRound: { level: 1 } }), so every caller passes the map it
 * already holds. A missing, NaN or negative level reads as not owned.
 */
export function bridgeRoundOwned(openSourceLevels = {}) {
  const raw = openSourceLevels?.[BRIDGE_ROUND_PROJECT_ID];
  const level = raw !== null && typeof raw === "object" ? raw.level : raw;
  return safeLevel(level) >= 1;
}

/**
 * The rank whose caps the gated tracks follow this company: the owned
 * Funding Rounds rank, plus one while a Bridge Round is owned (only
 * where a bridge is offered, so a stray level at Series B or later
 * never reaches past the next round).
 */
export function effectiveFundingRoundRank(storeRanks = {}, openSourceLevels = {}) {
  const rank = fundingRoundRank(storeRanks);
  return bridgeRoundOwned(openSourceLevels) && bridgeRoundAvailable(storeRanks)
    ? rank + 1
    : rank;
}

/**
 * The highest level a project can reach: for a gated track, the cap of
 * the effective rank (the owned Funding Round, one higher while this
 * company owns a Bridge Round, issue #192); for the Bridge Round
 * itself, 1 where a bridge is offered and 0 from Series B on; the full
 * level count for everything else. 0 for an unknown project.
 * `openSourceLevels` is the company's level map (either shape, see
 * bridgeRoundOwned); omitted, no bridge is owned. The client reducer,
 * the card UI and the server validator all read the cap here.
 */
export function openSourceLevelCap(projectId, storeRanks = {}, openSourceLevels = {}) {
  const length = BALANCE.openSource[projectId]?.levels.length ?? 0;
  if (projectId === BRIDGE_ROUND_PROJECT_ID) {
    return bridgeRoundAvailable(storeRanks) ? length : 0;
  }
  if (!isRoundGatedProject(projectId)) return length;
  const caps = FUNDING_ROUNDS_CONFIG.levelCaps[projectId];
  return Math.min(
    length,
    caps[effectiveFundingRoundRank(storeRanks, openSourceLevels)]
  );
}

/**
 * The Funding Rounds rank that first allows `level` (1-based) of a
 * gated project: 0 when it is open while Bootstrapped, null for an
 * ungated project or a level past the track's end.
 */
export function fundingRoundRankForLevel(projectId, level) {
  if (!isRoundGatedProject(projectId)) return null;
  const caps = FUNDING_ROUNDS_CONFIG.levelCaps[projectId];
  const rank = caps.findIndex((cap) => cap >= safeLevel(level));
  return rank === -1 ? null : rank;
}

/**
 * Whether the NEXT level of a gated track is held back by the round
 * cap (not by the track ending): the card shows it locked with the
 * round it needs, and the buy is refused. A Bridge Round (passed in
 * `openSourceLevels`) raises the cap first. Only gated tracks are ever
 * round-locked: the Bridge Round is simply not offered from Series B
 * on (the card is hidden), it never reads as "needs a round".
 */
export function openSourceNextLevelNeedsRound(
  projectId,
  level,
  storeRanks = {},
  openSourceLevels = {}
) {
  if (!isRoundGatedProject(projectId)) return false;
  const next = safeLevel(level) + 1;
  const length = BALANCE.openSource[projectId]?.levels.length ?? 0;
  return (
    next <= length &&
    next > openSourceLevelCap(projectId, storeRanks, openSourceLevels)
  );
}

/**
 * Ships per assigned Release Manager per ship interval: 1 at Ship
 * Happens level 0, doubling each level (2 at L1, 4 at L2, 1024 at
 * L10). The tick's LOC check still gates each ship, so a manager
 * that cannot afford the next ship waits for the next interval.
 */
export function releaseManagerShipsPerInterval(openSourceLevels = {}) {
  return doublingMultiplier("releaseManager", openSourceLevels);
}

/**
 * Release Manager (auto-ships freelance projects). One ship per
 * assigned manager per interval: every `shipIntervalSeconds`, each
 * manager assigned to a project ships one of it, if the player has
 * enough LOC for that project's cost at that moment. A manager with
 * no assignment does nothing. The interval is a tuning value (1s:
 * one ship per manager per second — the managers do the hammering
 * for you, so parking them on the efficient small project pays off
 * fast). The server enforces the rate (see
 * maxReleaseManagerShips) so a hacked client cannot claim ships
 * faster than the interval allows. Auto-ships only happen while the
 * game is open — the client tick drives them, like passive LOC
 * ticks; there is no offline auto-shipping in v1.
 */
export const RELEASE_MANAGER_CONFIG = Object.freeze({
  /** Seconds between auto-ships for one assigned manager. Tuning value. */
  shipIntervalSeconds: 1,
});

/**
 * How many Release Managers are assigned across all projects (the sum
 * of the per-project assignment counts). Must be <= the owned Release
 * Manager count; the rest are unassigned and do nothing.
 */
export function releaseManagerAssignedCount(assignments) {
  if (!assignments || typeof assignments !== "object") return 0;
  return FREELANCE_PROJECT_KEYS.reduce(
    (sum, key) => sum + (assignments[key] ?? 0),
    0
  );
}

/**
 * Release Manager shipping economics (issue #163): the readout behind
 * the per-project assignment rows on the Projects tab and the shipping
 * summary strip under the Release Manager card. Pure math, no state
 * writes, so the client UI and the tests read the same numbers.
 *
 * - passiveIn: the buffed healthy passive LOC/s the caller passes in
 *   (getBaseLocPerSecond on the client: star buffs excluded).
 * - Per project: assigned count x ships per manager per second x the
 *   project's LOC cost per ship (locPerSecond), and the same ship rate
 *   x the reward per ship (cashPerSecond, integer cents per ship like
 *   the tick, which rounds each payout after the Client Network
 *   multiplier). At Ship Happens level 0 with the 1s interval that is
 *   exactly assigned x loc and assigned x reward. Locked projects
 *   contribute 0, because the tick skips them.
 * - rmOut: the sum of the per-project locPerSecond.
 * - cashPerSecond: the sum of the per-project cashPerSecond.
 * - net: passiveIn minus rmOut. Negative means a deficit.
 * - unassigned: managers owned minus managers assigned, never below 0.
 *
 * These are the intended rates: managers only ship when there is LOC to
 * burn, so in a deficit the real outflow is capped by what is banked.
 * A missing or non-numeric count reads as 0, so the result is never NaN.
 */
export function releaseManagerShippingEconomics({
  assignments = {},
  managersOwned = 0,
  passiveLocPerSecond = 0,
  unlockedProjects = {},
  openSourceLevels = {},
  permanentStoreRanks = {},
  activeStarEffects = [],
  nowMs = Date.now(),
} = {}) {
  const safe = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
  const shipsPerSecond =
    releaseManagerShipsPerInterval(openSourceLevels ?? {}) /
    RELEASE_MANAGER_CONFIG.shipIntervalSeconds;
  const perProject = {};
  let assignedCount = 0;
  let rmOut = 0;
  let cashPerSecond = 0;
  for (const key of FREELANCE_PROJECT_KEYS) {
    const assigned = safe(assignments?.[key]);
    assignedCount += assigned;
    const project = BALANCE.freelanceProjects[key];
    const ships = unlockedProjects?.[key] ? assigned * shipsPerSecond : 0;
    const locPerSecond = ships * project.loc;
    const cash =
      ships *
      freelanceShipPayoutCents(key, permanentStoreRanks ?? {}, {
        activeStarEffects,
        nowMs,
      });
    perProject[key] = { assigned, locPerSecond, cashPerSecond: cash };
    rmOut += locPerSecond;
    cashPerSecond += cash;
  }
  const passiveIn = safe(passiveLocPerSecond);
  return {
    passiveIn,
    rmOut,
    cashPerSecond,
    net: passiveIn - rmOut,
    assignedCount,
    unassigned: Math.max(0, safe(managersOwned) - assignedCount),
    perProject,
  };
}

/**
 * The most auto-ships `managerCount` Release Managers could have made
 * in a window of `elapsedSeconds`: one ship per manager per interval,
 * plus one grace ship for a ship event landing exactly on a window
 * boundary (the client's ship clock and the save window are not
 * aligned, so a window can straddle two ship events). The server
 * uses this as the rate cap for actions.autoShips.
 */
export function maxReleaseManagerShips(managerCount, elapsedSeconds) {
  if (managerCount <= 0 || elapsedSeconds < 0) return 0;
  return (
    managerCount *
    (Math.floor(elapsedSeconds / RELEASE_MANAGER_CONFIG.shipIntervalSeconds) +
      1)
  );
}

/**
 * Llama farm mini-game (issue #79). A business you buy with pure money,
 * and a breeding mini-game. No soil (unlike Cookie Clicker) — the farm
 * uses MOOD and STALLS.
 *
 * Each tile is a barn stall. You set the lighting to different colors
 * for mood, since it is a breeding game. Llamas have no genders — any
 * two can breed. An empty stall between two llamas can produce a kid in
 * that stall, usually one of the parents' types, sometimes a brand-new
 * type. Start with 2 base llama types; new types come from breeding.
 *
 * Flavor: the staff dream of quitting to start an alpaca farm, and you
 * let them start it but still have not accepted their notice of quitting.
 *
 * V1 scope: the purchase + the breeding game. Passive cash generation
 * from the farm (the business generating cash slowly) and the LOC AI
 * harness are the next slice, not v1 — the money rule is exact, and
 * passive cash with a changing llama count cannot be validated exactly
 * without restructuring it.
 *
 * Feedback (Brandon, Nov 10): the farm is a cool first mini-game
 * unlock, so it costs $10,000, not $250. (Issue #129 replaced the
 * fixed dollars: the barn and every llama are priced as time at the
 * player's buffed LOC/s now, see LLAMA_ECONOMY.) No free llamas — the barn
 * arrives empty and you buy llamas yourself. Breeding is slow (a
 * 60s tick, not 5s) and the roll happens on the CLIENT now (it used
 * to be server-rolled and issued): the client rolls the outcome from
 * the shared odds (rollFarmBreeding) and the save carries the new
 * kid in the farm stalls.
 */
export const FARM_CONFIG = Object.freeze({
  // Prices are no longer fixed dollars (issue #129): the barn and
  // every llama type are priced as time at the player's buffed LOC/s.
  // See LLAMA_ECONOMY and farmPurchaseCostCents / llamaBuyPriceCents.
  /**
   * The barn's unlock gate: 10 Senior Developers on payroll (they are
   * the ones who always want to quit and start a farm). Same condition
   * shape and evaluation as every employee/project unlock
   * (conditionMet). There is no saved latch: Seniors cannot be fired,
   * so the condition can never un-meet within a company, and a sale
   * zeroes the Seniors (and empties the farm), so the gate has to be
   * earned again each company, like every other unlock. Tuning value.
   */
  unlockConditions: Object.freeze([
    Object.freeze({
      type: "SPECIFIC_EMPLOYEE_COUNT",
      employeeType: "senior",
      target: 10,
    }),
  ]),
  /** Barn stalls in the grid (3x3). Each stall holds at most one llama. */
  stallCount: 9,
  /** Columns in the stall grid (used for orthogonal adjacency). */
  gridCols: 3,
  /**
   * How often the breeding check runs, in seconds. The client rolls
   * (shared.rollFarmBreeding) on this interval. 60s, not 5s — a kid
   * every few minutes at the v1 odds, not a kid every few seconds.
   * Tuning value.
   */
  breedingTickSeconds: 60,
});

/**
 * Llama type ids, in discovery order. The first two are the base types
 * you can buy in the shop; the rest are discovered by breeding.
 */
export const LLAMA_TYPES = Object.freeze([
  "classic",
  "drama",
  "mama",
  "spaghetti",
  "quantum",
  "blockchain",
  "ai",
]);

/**
 * The types for sale in the shop: the two base types and the Mama
 * Llama (issue #129). Bred types are never for sale in the shop; they
 * come only from breeding (they still have a value, and sell for half
 * of it). The Mama Llama is shop-only: breeding never discovers one.
 */
export const LLAMA_BASE_TYPES = Object.freeze(["classic", "drama", "mama"]);

/**
 * The types the farm shop sells right now (issue #203, Brandon: "Once
 * discovered a llama should be buyable again after sold like my quantum
 * llama"): the base types always, plus every bred type the player has
 * discovered (farm.unlockedTypes), whether or not they own one. An
 * undiscovered bred type is never offered (no spoilers). Order is
 * LLAMA_TYPES order, base types first. Prices are unchanged: each type
 * sells at llamaBuyPriceCents. The reducer's buy rule and the shop UI
 * both read this list.
 */
export function llamaShopTypes(unlockedTypes = []) {
  const discovered = Array.isArray(unlockedTypes) ? unlockedTypes : [];
  return LLAMA_TYPES.filter(
    (type) => LLAMA_BASE_TYPES.includes(type) || discovered.includes(type)
  );
}

/** Display names for the llama types. */
export const LLAMA_TYPE_NAMES = Object.freeze({
  classic: "Classic Llama",
  drama: "Drama Llama",
  mama: "Mama Llama",
  spaghetti: "Spaghetti Llama",
  quantum: "Quantum Llama",
  blockchain: "Blockchain Llama",
  ai: "AI Llama",
});

/** Descriptions for the llama types, in the GRQ satirical dev voice. */
export const LLAMA_TYPE_DESCRIPTIONS = Object.freeze({
  classic:
    "The original. Ships on time, never spits on the deploy, and has been here since v1. Nobody remembers hiring it.",
  drama:
    "Causes an incident every sprint, then acts surprised. Spits on the production deploy and blames the intern.",
  mama:
    "Cheap to hire, impossible to slow down. Every llama next to her breeds way faster, and she never once asks for parental leave. HR is investigating.",
  spaghetti:
    "Its code is tangled, its wool is tangled, everything is tangled. Somehow it still works. Nobody dares refactor it.",
  quantum:
    "Both in the stall and not in the stall until you observe it. Schrodinger's llama, now shipping.",
  blockchain:
    "A llama on the blockchain. Decentralized, immutable, and completely useless for carrying anything.",
  ai: "Definitely not just a random number generator with confidence. It generates wool. The wool is mostly a random number generator with confidence.",
});

/** Barn-stall lighting (mood) color ids. */
export const FARM_LIGHTING_COLORS = Object.freeze([
  "warm",
  "red",
  "blue",
  "green",
]);

/**
 * Lighting (mood) effects. The empty stall's own lighting sets the mood
 * for a kid appearing there: kidChance is the chance a kid is born in
 * that stall on one breeding tick, newTypeChance is the chance the kid
 * is a brand-new type (one the player has not unlocked yet) instead of
 * one of the neighbouring parents' types. Tuning values.
 *
 * - warm: balanced, the default.
 * - red ("Spicy"): more kids, fewer new types — bulk breeding.
 * - blue ("Chill"): fewer kids, more new types — type hunting.
 * - green ("Lucky"): a bit better at both.
 */
export const FARM_LIGHTING = Object.freeze({
  warm: Object.freeze({
    label: "Warm Amber",
    description: "Cozy and balanced. The default mood.",
    color: "#F59E0B",
    kidChance: 0.15,
    newTypeChance: 0.15,
  }),
  red: Object.freeze({
    label: "Spicy Red",
    description: "More kids, fewer new types. Bulk breeding.",
    color: "#EF4444",
    kidChance: 0.3,
    newTypeChance: 0.05,
  }),
  blue: Object.freeze({
    label: "Chill Blue",
    description: "Fewer kids, more new types. Type hunting.",
    color: "#3B82F6",
    kidChance: 0.08,
    newTypeChance: 0.4,
  }),
  green: Object.freeze({
    label: "Lucky Green",
    description: "A bit better at both. The gambler's mood.",
    color: "#22C55E",
    kidChance: 0.2,
    newTypeChance: 0.25,
  }),
});

/**
 * Orthogonal neighbours (up/down/left/right) of a stall in the 3x3
 * grid. A stall's neighbours are the stalls immediately beside it in
 * its row and column — no diagonals, so "between two llamas" means the
 * two llamas sit on either side of the empty stall, not kitty-corner.
 */
export function farmStallNeighbours(stallIndex) {
  const { stallCount, gridCols } = FARM_CONFIG;
  if (stallIndex < 0 || stallIndex >= stallCount) return [];
  const row = Math.floor(stallIndex / gridCols);
  const col = stallIndex % gridCols;
  const neighbours = [];
  if (col > 0) neighbours.push(stallIndex - 1);
  if (col < gridCols - 1) neighbours.push(stallIndex + 1);
  if (row > 0) neighbours.push(stallIndex - gridCols);
  if (row < gridCols - 1) neighbours.push(stallIndex + gridCols);
  return neighbours;
}

/** How many llamas are in the stalls (non-null entries). */
export function farmLlamaCount(stalls) {
  return stalls.reduce((count, stall) => count + (stall.llama ? 1 : 0), 0);
}

/**
 * Indices of the empty stalls that can breed right now: empty, with at
 * least two llamas in their orthogonal neighbours. A kid can only appear
 * between two llamas, so a lone neighbour is not enough.
 */
export function farmEligibleBreedingStalls(stalls) {
  const eligible = [];
  for (let i = 0; i < stalls.length; i++) {
    if (stalls[i].llama) continue;
    const llamaNeighbours = farmStallNeighbours(i).filter(
      (n) => stalls[n].llama
    );
    if (llamaNeighbours.length >= 2) eligible.push(i);
  }
  return eligible;
}

/**
 * The most kids that can legitimately be born in a window: the number
 * of stalls that were empty when the window started. Each kid fills a
 * distinct stall that was empty (a stall with a llama cannot get a
 * kid, and a stall can only get one kid), so the empty-stall count is
 * the hard bound. The breeding-tick rate does NOT bound the total: a
 * kid born in one stall can make a neighbouring empty stall newly
 * eligible (it gains a second llama neighbour), so over several ticks
 * kids can appear in stalls that were not eligible when the window
 * started — a ticks x eligible cap would undercount that cascade and
 * falsely reject legitimate saves. The tick rate only affects how fast
 * kids appear; the neighbour check (each kid must sit between two
 * llamas) is what keeps a birth plausible.
 */
export function farmMaxKidsPerWindow(prevStalls) {
  return prevStalls.reduce((count, stall) => count + (stall.llama ? 0 : 1), 0);
}

/**
 * Roll one breeding tick for a single eligible empty stall. Returns the
 * kid's type id, or null when no kid is born. The stall's own lighting
 * sets the mood: kidChance is the chance a kid appears at all, and
 * newTypeChance is the chance the kid is a brand-new type (one not in
 * unlockedTypes) instead of one of the neighbouring parents' types.
 * When every type is already unlocked, the "new type" roll falls back
 * to a parent's type — there is nothing new left to discover.
 */
export function rollFarmKid(stallIndex, stalls, unlockedTypes, rng = Math.random) {
  const stall = stalls[stallIndex];
  if (!stall || stall.llama) return null;
  const lighting = FARM_LIGHTING[stall.lighting] ?? FARM_LIGHTING.warm;
  const parentTypes = farmStallNeighbours(stallIndex)
    .map((n) => stalls[n].llama)
    .filter(Boolean);
  if (parentTypes.length < 2) return null;
  if (rng() >= farmKidChance(stall.lighting, parentTypes)) return null;
  // The Mama Llama is shop-only: breeding never discovers one.
  const undiscovered = LLAMA_TYPES.filter(
    (type) => type !== "mama" && !(unlockedTypes ?? []).includes(type)
  );
  if (undiscovered.length > 0 && rng() < lighting.newTypeChance) {
    return undiscovered[Math.floor(rng() * undiscovered.length)];
  }
  // A Mama Llama raises everyone else's kids: the kid takes a
  // non-mama parent's type when there is one (a mama-only nest has a
  // Mama kid).
  const kidPool = parentTypes.some((type) => type !== "mama")
    ? parentTypes.filter((type) => type !== "mama")
    : parentTypes;
  return kidPool[Math.floor(rng() * kidPool.length)];
}

/**
 * The chance a kid is born in an eligible stall on one breeding tick:
 * the stall's lighting sets the base chance, and a Mama Llama among
 * the neighbouring parents multiplies it (issue #129), capped at
 * LLAMA_ECONOMY.maxKidChance. One mama is enough; two do not stack.
 */
export function farmKidChance(lightingId, parentTypes) {
  const lighting = FARM_LIGHTING[lightingId] ?? FARM_LIGHTING.warm;
  const hasMama = (parentTypes ?? []).includes("mama");
  if (!hasMama) return lighting.kidChance;
  return Math.min(
    LLAMA_ECONOMY.maxKidChance,
    lighting.kidChance * LLAMA_ECONOMY.mamaKidChanceMultiplier
  );
}

/**
 * Llama economy v2 (issue #129). Every farm price is TIME at the
 * player's production, never fixed dollars, so prices keep pace as
 * the player grows:
 *
 *   R = best cents per LOC = 60 (the To Do List App: 50 LOC for $30,
 *       the cheapest project at the best rate; derived from BALANCE
 *       below so it can never drift).
 *   P = the player's passive LOC/s, BUFFED: buffedLocPerSecond, with
 *       the Founder multiplier and the achievement buff (issue #132)
 *       in, temporary star and SUBTRACTERALL multipliers out. Never
 *       raw base LOC/s.
 *   B = P x R, cents per second of production value.
 *
 * A price is `seconds x B`. The barn is 3 minutes of production (the
 * earlier Farm Economy anchor, 180 x B). Every llama costs minutes,
 * never seconds or hours, rising with the type: the cheap Mama Llama
 * is 1 minute, a Classic 1.5 (the old 30 x B anchor was 30 seconds,
 * raised to minutes per the issue), an AI Llama 15. A llama sells for half its
 * CURRENT buy price: the value is not locked at purchase, so as P
 * rises the price and the sell value of every type rise with it.
 *
 * P is floored at minPricingLocPerSecond for pricing only, so the barn
 * and the llamas are never free for a player with no employees yet.
 * Tuning values, one line each; tune from play.
 */
export const LLAMA_ECONOMY = Object.freeze({
  /** Floor on P for pricing (LOC/s), so nothing is ever free. */
  minPricingLocPerSecond: 10,
  /** The barn: seconds of production value (180 x B, 3 minutes). */
  barnSeconds: 180,
  /** Buy price per type, in seconds of production value. */
  typeSeconds: Object.freeze({
    mama: 60,
    classic: 90,
    drama: 120,
    spaghetti: 240,
    quantum: 360,
    blockchain: 600,
    ai: 900,
  }),
  /** A llama sells for this fraction of its current buy price. */
  sellFraction: 0.5,
  /** Kid chance multiplier for a stall beside a Mama Llama. */
  mamaKidChanceMultiplier: 3,
  /** The kid chance never goes above this, Mama or not. */
  maxKidChance: 0.9,
});

/**
 * R: the best cents per LOC any freelance project pays (60, the To Do
 * List App). Derived from BALANCE so the anchor can never drift.
 */
export function bestCentsPerLoc() {
  let best = 0;
  for (const key of FREELANCE_PROJECT_KEYS) {
    const project = BALANCE.freelanceProjects[key];
    best = Math.max(best, project.reward / project.loc);
  }
  return best;
}

/**
 * B: cents per second of production value at buffed LOC/s `p` (floored
 * at minPricingLocPerSecond, NaN-guarded).
 */
export function farmProductionValueCentsPerSecond(buffedLocPerSec) {
  const p = Number(buffedLocPerSec);
  const rate = Number.isFinite(p) && p > 0 ? p : 0;
  return (
    Math.max(LLAMA_ECONOMY.minPricingLocPerSecond, rate) * bestCentsPerLoc()
  );
}

/** The barn's price in whole cents: barnSeconds x B. */
export function farmPurchaseCostCents(buffedLocPerSec) {
  return Math.round(
    LLAMA_ECONOMY.barnSeconds * farmProductionValueCentsPerSecond(buffedLocPerSec)
  );
}

/**
 * What a llama of `type` costs right now, in whole cents: typeSeconds x
 * B. 0 for an unknown type. Bred types have a price too (it is what
 * they are worth), they just are not for sale in the shop.
 */
export function llamaBuyPriceCents(type, buffedLocPerSec) {
  const seconds = LLAMA_ECONOMY.typeSeconds[type];
  if (!seconds) return 0;
  return Math.round(
    seconds * farmProductionValueCentsPerSecond(buffedLocPerSec)
  );
}

/** What a llama of `type` sells for right now: half its current buy price. */
export function llamaSellPriceCents(type, buffedLocPerSec) {
  return Math.floor(
    LLAMA_ECONOMY.sellFraction * llamaBuyPriceCents(type, buffedLocPerSec)
  );
}

/**
 * Move a llama from one stall to an EMPTY stall (pure). The lighting
 * stays with the stall (it is the stall's mood, not the llama's).
 * Returns the new farm, or null when the move is not allowed: farm
 * not owned, bad indices, the same stall, no llama in `from`, or
 * `to` occupied.
 */
export function moveFarmLlama(farm, fromIndex, toIndex) {
  if (!farm?.owned || !Array.isArray(farm.stalls)) return null;
  const valid = (i) =>
    Number.isInteger(i) && i >= 0 && i < FARM_CONFIG.stallCount;
  if (!valid(fromIndex) || !valid(toIndex) || fromIndex === toIndex) {
    return null;
  }
  const from = farm.stalls[fromIndex];
  const to = farm.stalls[toIndex];
  if (!from?.llama || !to || to.llama !== null) return null;
  const stalls = farm.stalls.map((stall, i) => {
    if (i === fromIndex) return { ...stall, llama: null };
    if (i === toIndex) return { ...stall, llama: from.llama };
    return { ...stall };
  });
  return { ...farm, stalls };
}

/**
 * Llama counts per type in the barn (every LLAMA_TYPES key, 0 when
 * absent). The server uses it to check that llamas only leave the barn
 * through a recorded sale.
 */
export function farmLlamaCountsByType(stalls) {
  const counts = {};
  for (const type of LLAMA_TYPES) counts[type] = 0;
  for (const stall of stalls ?? []) {
    if (stall?.llama && counts[stall.llama] !== undefined) {
      counts[stall.llama] += 1;
    }
  }
  return counts;
}

/**
 * Run one breeding tick over the whole barn: every eligible empty stall
 * rolls for a kid. Returns the new stalls array and the types of the
 * kids born (empty when nothing was born). Pure — the caller passes
 * the rng, so tests can pin it. A kid born in one stall does not make
 * a neighbouring empty stall eligible in the same tick (the rolls all
 * read the stalls as they were when the tick started).
 */
export function rollFarmBreeding(stalls, unlockedTypes, rng = Math.random) {
  const eligible = farmEligibleBreedingStalls(stalls);
  if (eligible.length === 0) return { stalls, kidsBorn: [] };
  const next = stalls.map((stall) => ({ ...stall }));
  const kidsBorn = [];
  for (const index of eligible) {
    const type = rollFarmKid(index, stalls, unlockedTypes, rng);
    if (type) {
      next[index] = { ...next[index], llama: type };
      kidsBorn.push(type);
    }
  }
  return { stalls: next, kidsBorn };
}

/**
 * Convert a rollFarmBreeding result into the { stallIndex, type }[]
 * list the FARM_BREED_RESULT reducer expects: a stall that went from
 * empty to occupied in the roll is a kid born there. Pure. Returns []
 * for a malformed roll instead of throwing — a bad breed payload must
 * never blank the game. The reducer still validates each kid (valid
 * type, stall still empty), so this is a pure diff, not an authority.
 */
export function farmKidsFromRoll(oldStalls, roll) {
  if (!Array.isArray(oldStalls) || !roll || typeof roll !== "object") {
    return [];
  }
  const next = roll.stalls;
  if (!Array.isArray(next)) return [];
  const kids = [];
  const len = Math.min(oldStalls.length, next.length);
  for (let i = 0; i < len; i++) {
    const before = oldStalls[i]?.llama ?? null;
    const after = next[i]?.llama ?? null;
    if (before === null && after !== null) {
      kids.push({ stallIndex: i, type: after });
    }
  }
  return kids;
}

/**
 * Apply a FARM_BREED_RESULT payload to a farm: place each kid in its
 * stall (only if the stall is still empty — a llama bought into that
 * stall after the roll wins, so the roll and the state can never
 * disagree) and add new types to the unlocked list. Pure — the
 * FARM_BREED_RESULT reducer calls this. A malformed kids payload
 * (anything but an array) is treated as no kids instead of throwing:
 * a bad breed payload must never blank the game.
 */
export function applyFarmBreedKids(farm, kids) {
  const base = farm ?? emptyFarmState();
  const stalls = base.stalls.map((stall) => ({ ...stall }));
  const unlockedTypes = [...(base.unlockedTypes ?? [])];
  if (!Array.isArray(kids)) return { ...base, stalls, unlockedTypes };
  for (const kid of kids) {
    if (
      typeof kid?.stallIndex !== "number" ||
      kid.stallIndex < 0 ||
      kid.stallIndex >= FARM_CONFIG.stallCount ||
      !LLAMA_TYPES.includes(kid.type)
    ) {
      continue;
    }
    if (stalls[kid.stallIndex].llama !== null) continue;
    stalls[kid.stallIndex] = {
      ...stalls[kid.stallIndex],
      llama: kid.type,
    };
    if (!unlockedTypes.includes(kid.type)) {
      unlockedTypes.push(kid.type);
    }
  }
  return { ...base, stalls, unlockedTypes };
}

/** A farm that has never been bought: no llamas, no types, warm lights. */
export function emptyFarmState() {
  return {
    owned: false,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, () => ({
      llama: null,
      lighting: "warm",
    })),
    unlockedTypes: [],
  };
}

/**
 * The farm state right after buying it: owned, but EMPTY — no free
 * llamas (Brandon: "you have to buy the llamas yourself"). Buy base
 * llamas in the shop to move in, then breed. No types are unlocked
 * until a llama of that type is bought or born.
 */
export function initialFarmState() {
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, () => ({
      llama: null,
      lighting: "warm",
    })),
    unlockedTypes: [],
  };
}

/**
 * Golden star (GitNub Constellation, issue #33).
 *
 * One project, many tiers. Level 0 = no stars. Each level unlocks a new
 * effect type and, every other level, makes stars spawn faster.
 *
 * Effects and their fixed weights (probability = weight / total weight
 * of the UNLOCKED pool). Good/bad is a separate roll after the effect
 * is chosen (good 3/4, bad 1/4, bad always half as bad: half the
 * magnitude, half the duration). The outcome is rolled at CLICK time,
 * not spawn time. Effect pun names are locked (Brandon, Nov 10).
 */
export const STAR_CONFIG = Object.freeze({
  /** How long an unclicked star stays on screen, in seconds. */
  starLifetimeSeconds: 30,
  /**
   * How long before despawn the star starts fading out, in seconds
   * (issue #49): the fade is the "click me now or lose me" signal.
   * The CSS fade-out duration in GoldenStar.css must match this.
   */
  starFadeSeconds: 5,
  /**
   * Chance a clicked golden star is a good outcome (vs bad). 1.0 since
   * Moonshot (issue #165): gold always means reward; the bad outcomes
   * moved to the opt-in red star (MOONSHOT_CONFIG). Kept as a knob.
   */
  goodChance: 1,
  /**
   * Constellation level that unlocks the next-star countdown display.
   * The client only SHOWS that countdown once the player reaches
   * this level. Default 2 (early enough to be reachable, late enough
   * to be a reward) — adjustable, NOT a locked decision. The star
   * itself still spawns on schedule before this level; only the timer
   * display is gated.
   */
  countdownUnlockLevel: 2,
  /** Spawn interval range (seconds) per Constellation level, index level-1. */
  spawnIntervalSeconds: Object.freeze([
    Object.freeze({ min: 90, max: 180 }), // L1
    Object.freeze({ min: 90, max: 180 }), // L2 (same — more tiers to work toward)
    Object.freeze({ min: 60, max: 120 }), // L3 (faster)
    Object.freeze({ min: 60, max: 120 }), // L4 (same)
    Object.freeze({ min: 45, max: 90 }), // L5 (faster)
    Object.freeze({ min: 45, max: 90 }), // L6 (same, issue #157)
    Object.freeze({ min: 30, max: 60 }), // L7 (faster)
  ]),
  /** Effect definitions: weight, the level that unlocks it, and the locked pun names. */
  effects: Object.freeze({
    lucky: Object.freeze({
      weight: 40,
      unlockLevel: 1,
      names: Object.freeze({ good: "Airdrop", bad: "Rug Pull" }),
    }),
    frenzy: Object.freeze({
      weight: 30,
      unlockLevel: 3,
      names: Object.freeze({ good: "Overclock", bad: "Throttling" }),
    }),
    click: Object.freeze({
      weight: 20,
      unlockLevel: 2,
      names: Object.freeze({ good: "AI Accelerator", bad: "Hallucination" }),
    }),
    employee: Object.freeze({
      weight: 10,
      unlockLevel: 4,
      names: Object.freeze({ good: "Sprint", bad: "Meeting" }),
    }),
    shootingStars: Object.freeze({
      weight: 5,
      unlockLevel: 5,
      names: Object.freeze({ good: "Shooting Stars", bad: "Shooting Stars" }),
    }),
    // Issue #157. The good side rolls on golden stars; the bad side
    // exists only as a red-star crash (moonshotCrashEffects derives the
    // crash pool from this list). Names locked; the email flavor is the
    // inbox body for a claim of that side.
    hype: Object.freeze({
      weight: 10,
      unlockLevel: 6,
      names: Object.freeze({ good: "Hype Train", bad: "Derailment" }),
      flavor: Object.freeze({
        good:
          "A rando on X with a cartoon frog avatar posted a screenshot of your app with the caption \"this changes everything.\" It has 40K reposts. Nobody knows what it changes. Every client wants one anyway, and they will pay double to get it this week. All aboard.",
        bad:
          "The same rando on X posted a thread about your app. It starts with \"I have some concerns.\" Clients are quietly renegotiating, and every invoice now comes back at half. The hype train has left the rails. Mind the gap.",
      }),
    }),
    hiring: Object.freeze({
      weight: 5,
      unlockLevel: 7,
      names: Object.freeze({ good: "AGI", bad: "Union Drive" }),
      flavor: Object.freeze({
        good:
          "A lab announced AGI on a livestream with no questions taken. The board did the math: an LLM costs less than a human, so humans are now priced like one. Every hire is half off while the market panics. Nobody asked the humans.",
        bad:
          "The humans read the AGI memo too. They have a group chat, a logo, and a list of demands, and the first demand is not being priced like a chatbot. Every hire costs 50% more until the drive cools off. Solidarity is expensive.",
      }),
    }),
  }),
  /** Lucky: instant chunk. Good = 20-50x LOC/sec OR 1-75% of cash
   * (Brandon: people don't hoard cash, so up to 3/4 of cash on hand
   * is fine); bad LOC = half as bad (10-25x), bad cash stays 1-5%. */
  luckyLocMultiplier: Object.freeze({
    good: Object.freeze({ min: 20, max: 50 }),
    bad: Object.freeze({ min: 10, max: 25 }),
  }),
  luckyMoneyFraction: Object.freeze({
    good: Object.freeze({ min: 0.01, max: 0.75 }),
    bad: Object.freeze({ min: 0.01, max: 0.05 }),
  }),
  /** Frenzy: all production (LOC/sec) x2-5 for 60s; bad = x0.5 for 30s.
   * The range is deliberately LOWER than Employee's 3-15x: Frenzy
   * buffs everything, so its multiplier is smaller than the
   * single-type buff (Brandon, Nov 10). Rolled as an integer, like
   * the Click multiplier, so the display reads a clean "4x". */
  frenzyMultiplier: Object.freeze({
    good: Object.freeze({ min: 2, max: 5 }),
    bad: 0.5,
  }),
  frenzyDurationSeconds: Object.freeze({ good: 60, bad: 30 }),
  /** Click: click value x2-5 for 20s; bad = x0.5 for 10s. */
  clickMultiplier: Object.freeze({
    good: Object.freeze({ min: 2, max: 5 }),
    bad: 0.5,
  }),
  clickDurationSeconds: Object.freeze({ good: 20, bad: 10 }),
  /** Employee: one random employee type produces 3x-15x for 60s;
   * bad = 0.5x for 30s. The range is deliberately HIGHER than
   * Frenzy's 2-5x: it buffs a single type, so its multiplier is
   * bigger than the buff-everything one (Brandon, Nov 10). The type
   * stays random — never the highest-producing one. Rolled as an
   * integer, like the Click multiplier, so the display reads a clean
   * "12x". */
  employeeMultiplier: Object.freeze({
    good: Object.freeze({ min: 3, max: 15 }),
    bad: 0.5,
  }),
  employeeDurationSeconds: Object.freeze({ good: 60, bad: 30 }),
  /** Hype (issue #157): freelance cash payouts x2 for 60s (Hype Train,
   * golden); a red-star crash is x0.5 for 30s (Derailment). The first
   * star effect on payouts; applied inside freelanceShipPayoutCents. */
  hypePayoutMultiplier: Object.freeze({ good: 2, bad: 0.5 }),
  hypeDurationSeconds: Object.freeze({ good: 60, bad: 30 }),
  /** Hiring (issue #157): every employee hire cost x0.5 for 60s (AGI,
   * golden); a red-star crash is x1.5 for 30s (Union Drive). The first
   * star effect on hire costs; applied inside employeeCost, so every
   * single and bulk price path agrees. Note the direction: for this
   * effect a multiplier BELOW 1 is the good one (starBuffIsGood). */
  hiringCostMultiplier: Object.freeze({ good: 0.5, bad: 1.5 }),
  hiringDurationSeconds: Object.freeze({ good: 60, bad: 30 }),
  /**
   * Shooting Stars is a Cookie Chain (issue #138). Clicking a Shooting
   * Stars star is chain click 1 and pays startLocPerSecondMultiple x
   * LOC/s; every chain click after pays growthFactor x the previous plus
   * stepLocPerSecondMultiple x LOC/s: 7x, 77x, 777x, 7777x LOC/s. The
   * next chain star spawns spawnDelaySeconds after a click and lives
   * lifetimeSeconds. The chain ends when a chain star expires
   * unclicked, when the next payout would exceed capHoursOfProduction
   * of production or capBankFraction of the LOC on hand, or on a
   * randomEndChance roll after a click. Always good, never a debuff.
   * Tuning: lower the start multiple for longer chains; do NOT raise
   * either cap. The production cap is 1 hour since issue #170 (was 6):
   * at a plateau the bank brake never bites, so a full 6-hour chain
   * (7 + 77 + 777 + 7,777 = 8,638 s) made a gold star worth about 480 s
   * of production on average. At 1 hour the chain stops after 777 and a
   * gold star averages about 110 s, in line with a red one.
   */
  shootingStarsChain: Object.freeze({
    startLocPerSecondMultiple: 7,
    growthFactor: 10,
    stepLocPerSecondMultiple: 7,
    spawnDelaySeconds: 3,
    lifetimeSeconds: 6,
    capHoursOfProduction: 1,
    capBankFraction: 0.5,
    randomEndChance: 0.01,
  }),
});

/**
 * The LOC/s multiple chain click `step` (1-based) pays: 7, 77, 777, ...
 * Each step is growthFactor x the previous plus the step multiple, the
 * first is the start multiple. 0 for a step below 1.
 */
export function shootingStarsChainMultiple(step) {
  const n = Math.floor(Number(step) || 0);
  const config = STAR_CONFIG.shootingStarsChain;
  if (n < 1) return 0;
  let multiple = config.startLocPerSecondMultiple;
  for (let i = 2; i <= n; i += 1) {
    multiple = multiple * config.growthFactor + config.stepLocPerSecondMultiple;
  }
  return multiple;
}

/**
 * LOC chain click `step` pays at `locPerSecond` (the buffed healthy
 * rate), floored to whole LOC. NaN or negative rates pay 0.
 */
export function shootingStarsChainPayout(step, locPerSecond) {
  const rate = Number(locPerSecond);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.floor(shootingStarsChainMultiple(step) * rate);
}

/**
 * After chain click `step` was paid, decide whether the chain goes on.
 * `linesOfCode` is the LOC on hand AFTER that payout. Ends (returns
 * { continues: false, reason }) when the next payout would exceed the
 * 1-hour production cap ("cap"), would exceed half the LOC on hand
 * ("bank"), or on the 1% random roll ("luck"). Pure; `rng` injectable.
 * A missed star ("missed") is decided by the UI timer, not here.
 */
export function shootingStarsChainContinues({
  step,
  locPerSecond,
  linesOfCode,
  rng = Math.random,
}) {
  const config = STAR_CONFIG.shootingStarsChain;
  const rate = Number.isFinite(Number(locPerSecond)) ? Number(locPerSecond) : 0;
  const bank = Number.isFinite(Number(linesOfCode)) ? Number(linesOfCode) : 0;
  const nextPayout = shootingStarsChainPayout(step + 1, rate);
  if (rate <= 0 || nextPayout > rate * config.capHoursOfProduction * 3600) {
    return { continues: false, reason: "cap", nextPayout };
  }
  if (nextPayout > bank * config.capBankFraction) {
    return { continues: false, reason: "bank", nextPayout };
  }
  if (rng() < config.randomEndChance) {
    return { continues: false, reason: "luck", nextPayout };
  }
  return { continues: true, reason: null, nextPayout };
}

/**
 * The claim for one chain click (the same claim shape as every star
 * outcome, so APPLY_STAR_REWARD applies it): LOC only, always good,
 * with `chainStep` set so the label and the inbox know it is a chain
 * click (one email per chain, sent when it ends).
 */
export function shootingStarsChainClaim(step, locPerSecond) {
  return {
    effect: "shootingStars",
    good: true,
    locDelta: shootingStarsChainPayout(step, locPerSecond),
    moneyDelta: 0,
    multiplier: null,
    durationSeconds: null,
    employeeType: null,
    chainStep: Math.max(1, Math.floor(Number(step) || 1)),
  };
}

export const STAR_EFFECT_IDS = Object.freeze(Object.keys(STAR_CONFIG.effects));

/** Effect ids unlocked at a Constellation level (level 0 = none). */
export function unlockedStarEffects(constellationLevel) {
  return STAR_EFFECT_IDS.filter(
    (id) => STAR_CONFIG.effects[id].unlockLevel <= constellationLevel
  );
}

/** Spawn interval range (seconds) for a Constellation level; null at level 0. */
export function starSpawnIntervalSeconds(constellationLevel) {
  if (constellationLevel < 1) return null;
  const index = Math.min(
    constellationLevel,
    STAR_CONFIG.spawnIntervalSeconds.length
  ) - 1;
  return STAR_CONFIG.spawnIntervalSeconds[index];
}

/**
 * Roll the next star spawn time (ms since epoch) for a Constellation
 * level, from the level's spawn interval. Pure; `rng` is injectable.
 * Returns null at level 0 (no stars). The CLIENT owns this roll now
 * (the star resolution moved local when the leaderboard was killed):
 * it rolls the next spawn time and stores it in the save state, so
 * the countdown survives a reload.
 */
export function rollNextStarAtMs(constellationLevel, nowMs, rng = Math.random) {
  const interval = starSpawnIntervalSeconds(constellationLevel);
  if (!interval) return null;
  const delaySeconds =
    interval.min + rng() * (interval.max - interval.min);
  return nowMs + Math.floor(delaySeconds * 1000);
}

/**
 * Weighted pick of one effect from the unlocked pool. `rng` returns a
 * float in [0, 1); injectable so the client and tests can seed it.
 * Returns null at level 0 (no stars).
 */
export function rollStarEffect(constellationLevel, rng = Math.random) {
  const unlocked = unlockedStarEffects(constellationLevel);
  if (unlocked.length === 0) return null;
  const totalWeight = unlocked.reduce(
    (sum, id) => sum + STAR_CONFIG.effects[id].weight,
    0
  );
  let roll = rng() * totalWeight;
  for (const id of unlocked) {
    roll -= STAR_CONFIG.effects[id].weight;
    if (roll < 0) return id;
  }
  return unlocked[unlocked.length - 1];
}

/** Roll good (true) or bad (false) for a clicked star. */
export function rollStarGood(rng = Math.random) {
  return rng() < STAR_CONFIG.goodChance;
}

/**
 * Resolve one Lucky roll into an instant LOC/money delta. Pure.
 * Exactly one of locDelta / moneyDelta is nonzero (a Lucky roll gives
 * LOC or cash, never both). Losses are clamped to what the player
 * holds, so the result can never drive a balance below zero.
 * `rng` returns a float in [0, 1); injectable for tests.
 */
export function resolveLuckyReward({
  good,
  locPerSecond,
  money,
  linesOfCode,
  rng = Math.random,
}) {
  const isLoc = rng() < 0.5;
  if (isLoc) {
    const range = good
      ? STAR_CONFIG.luckyLocMultiplier.good
      : STAR_CONFIG.luckyLocMultiplier.bad;
    const amount = Math.floor(
      locPerSecond * (range.min + rng() * (range.max - range.min))
    );
    if (good) return { locDelta: amount, moneyDelta: 0 };
    return { locDelta: -Math.min(amount, linesOfCode), moneyDelta: 0 };
  }
  const range = good
    ? STAR_CONFIG.luckyMoneyFraction.good
    : STAR_CONFIG.luckyMoneyFraction.bad;
  const amount = Math.floor(
    money * (range.min + rng() * (range.max - range.min))
  );
  if (good) return { locDelta: 0, moneyDelta: amount };
  return { locDelta: 0, moneyDelta: -Math.min(amount, money) };
}

/**
 * Resolve a clicked star into a claim record — the outcome the client
 * applies. Pure; `rng` is injectable.
 *
 * Claim shape:
 *   { effect, good, locDelta, moneyDelta, multiplier, durationSeconds, employeeType }
 * Instant effects (lucky, shootingStars) carry locDelta/moneyDelta and
 * null multiplier/duration. Timed buffs (frenzy, click, employee) carry
 * a multiplier + durationSeconds and zero deltas. Shooting Stars is
 * chain click 1 of a Cookie Chain (issue #138): always good, LOC only,
 * with `chainStep: 1`.
 */
export function resolveStarClaim({
  effect,
  good,
  locPerSecond,
  money,
  linesOfCode,
  employeeCounts,
  rng = Math.random,
}) {
  const base = {
    effect,
    good,
    locDelta: 0,
    moneyDelta: 0,
    multiplier: null,
    durationSeconds: null,
    employeeType: null,
  };
  switch (effect) {
    case "lucky": {
      const { locDelta, moneyDelta } = resolveLuckyReward({
        good,
        locPerSecond,
        money,
        linesOfCode,
        rng,
      });
      return { ...base, locDelta, moneyDelta };
    }
    case "frenzy": {
      const key = good ? "good" : "bad";
      // Good Frenzy multiplier is an integer 2-5 (the config range);
      // bad is a fixed 0.5x.
      const multiplier = good
        ? Math.floor(
            STAR_CONFIG.frenzyMultiplier.good.min +
              rng() *
                (STAR_CONFIG.frenzyMultiplier.good.max -
                  STAR_CONFIG.frenzyMultiplier.good.min +
                  1)
          )
        : STAR_CONFIG.frenzyMultiplier.bad;
      return {
        ...base,
        multiplier,
        durationSeconds: STAR_CONFIG.frenzyDurationSeconds[key],
      };
    }
    case "click": {
      const key = good ? "good" : "bad";
      // Good click multiplier is an integer 2-5 (the config range).
      const multiplier = good
        ? Math.floor(
            STAR_CONFIG.clickMultiplier.good.min +
              rng() *
                (STAR_CONFIG.clickMultiplier.good.max -
                  STAR_CONFIG.clickMultiplier.good.min +
                  1)
          )
        : STAR_CONFIG.clickMultiplier.bad;
      return {
        ...base,
        multiplier,
        durationSeconds: STAR_CONFIG.clickDurationSeconds[key],
      };
    }
    case "employee": {
      const key = good ? "good" : "bad";
      // Boost a type the player actually owns, so the buff is never a
      // dud; if they own no employees yet, any type is a no-op. The
      // type stays random (Brandon, Nov 10) — never the
      // highest-producing one. Good multiplier is an integer 3-15
      // (the config range); bad is a fixed 0.5x.
      //
      // Release Manager is excluded from the pool: it produces 0
      // LOC/s and its ship timer is fixed, so a Sprint (or Meeting)
      // on it scales nothing — a dud buff with a live bar and no card
      // tint. RM unlock needs 100,000 TOTAL_LOC and 30 employees, so
      // the pool can never be RM-only in practice, but an empty
      // filtered pool still falls back to the non-RM types rather
      // than crashing.
      const buffable = EMPLOYEE_TYPES.filter(
        (type) => type !== "releaseManager"
      );
      const owned = buffable.filter(
        (type) => (employeeCounts[type] ?? 0) > 0
      );
      const pool = owned.length > 0 ? owned : buffable;
      const employeeType = pool[Math.floor(rng() * pool.length)];
      const multiplier = good
        ? Math.floor(
            STAR_CONFIG.employeeMultiplier.good.min +
              rng() *
                (STAR_CONFIG.employeeMultiplier.good.max -
                  STAR_CONFIG.employeeMultiplier.good.min +
                  1)
          )
        : STAR_CONFIG.employeeMultiplier.bad;
      return {
        ...base,
        multiplier,
        durationSeconds: STAR_CONFIG.employeeDurationSeconds[key],
        employeeType,
      };
    }
    case "shootingStars":
      // Cookie Chain (issue #138): the Shooting Stars star is chain
      // click 1 (7x LOC/s). The UI runs the rest of the chain with
      // shootingStarsChainClaim / shootingStarsChainContinues.
      return shootingStarsChainClaim(1, locPerSecond);
    // Issue #157: fixed multipliers both ways, nothing to roll.
    case "hype": {
      const key = good ? "good" : "bad";
      return {
        ...base,
        multiplier: STAR_CONFIG.hypePayoutMultiplier[key],
        durationSeconds: STAR_CONFIG.hypeDurationSeconds[key],
      };
    }
    case "hiring": {
      const key = good ? "good" : "bad";
      return {
        ...base,
        multiplier: STAR_CONFIG.hiringCostMultiplier[key],
        durationSeconds: STAR_CONFIG.hiringDurationSeconds[key],
      };
    }
    default:
      return base;
  }
}

/** The display name of a star outcome (the locked pun name). */
export function starEffectName(effect, good) {
  if (effect === "moonshot") return MOONSHOT_CONFIG.jackpotName;
  const names = STAR_CONFIG.effects[effect]?.names;
  if (!names) return "Golden Star";
  return good ? names.good : names.bad;
}

/** The inbox flavor for a star outcome, or null (the generic sign-off). */
export function starEffectFlavor(effect, good) {
  const flavor = STAR_CONFIG.effects[effect]?.flavor;
  if (!flavor) return null;
  return (good ? flavor.good : flavor.bad) ?? null;
}

/**
 * Whether a live timed buff is the good side of its effect. For every
 * effect a multiplier above 1 is good, except hiring (issue #157): it
 * multiplies a COST, so AGI's 0.5x is the good one and Union Drive's
 * 1.5x the bad one. The duration bar, its color and its name read this,
 * never `multiplier > 1` directly.
 */
export function starBuffIsGood(buff) {
  const multiplier = Number(buff?.multiplier);
  if (!Number.isFinite(multiplier)) return false;
  return buff.effect === "hiring" ? multiplier < 1 : multiplier > 1;
}

/**
 * The live multiplier of one timed star effect (issue #157), or 1 when
 * none is live. A buff is live until its expiresAtMs. Only one buff per
 * effect is ever live (a new claim replaces the old), so the first live
 * match wins. NaN-safe: a malformed entry reads as no buff.
 */
export function liveStarEffectMultiplier(activeStarEffects, effect, nowMs = Date.now()) {
  for (const buff of Array.isArray(activeStarEffects) ? activeStarEffects : []) {
    if (buff?.effect !== effect) continue;
    if (!(Number(buff.expiresAtMs) > nowMs)) continue;
    const multiplier = Number(buff.multiplier);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }
  return 1;
}

/** Hype Train / Derailment: the live freelance payout multiplier (1 when none). */
export function hypePayoutMultiplier(activeStarEffects, nowMs = Date.now()) {
  return liveStarEffectMultiplier(activeStarEffects, "hype", nowMs);
}

/** AGI / Union Drive: the live hire cost multiplier (1 when none). */
export function hiringCostMultiplier(activeStarEffects, nowMs = Date.now()) {
  return liveStarEffectMultiplier(activeStarEffects, "hiring", nowMs);
}

/**
 * ===== Prestige — Sell the Company (Slice 1) =====
 *
 * Lifetime accounting and Equity, per the v2 prestige design
 * (chatgpt-prestige-design-v2-2026-11-11.md sections 2, 3, 8) as
 * refined by Brandon's Nov 15, 2026 decisions.
 *
 * - Lifetime LOC is the existing `totalLinesOfCode`: every eligible
 *   LOC actually credited (clicks, employees, legitimate production
 *   bonuses, LOC Airdrops), counted fractionally internally and never
 *   decreased by spending. Starting balances, refunds, restored
 *   balances, conversions of previously counted LOC, and debug grants
 *   do not count; cash earnings and cash Airdrops do not count.
 *   Migration for existing saves uses that counter as-is: do not
 *   infer lifetime earnings from current inventory, and if no
 *   reliable counter exists the save starts at zero.
 * - Entitled Equity = floor(cbrt(Lifetime LOC / 10,000,000)) (cube
 *   root since issue #170, was a square root over 1M); the threshold
 *   for Equity n is 10,000,000 x n^3. A sale requires at least one
 *   NEW Equity (entitled minus Lifetime Equity earned).
 * - Lifetime Equity earned increases ONLY on sale. Spending Equity
 *   (the permanent store, Slice 2) never reduces the Founder bonus,
 *   which is based on Lifetime Equity earned, even if spent.
 * - Available Equity = claimed Equity minus permanent-store spending.
 *   Slice 1 has no store, so available equals claimed.
 */

/** Equity curve constants (issue #170). Cube root over a 10M unit:
 * the total cost of N Equity is N^3 x 10M and the next point at N
 * costs about 3N^2 x 10M, one degree steeper than the old square
 * root (the Cookie Clicker shape). Reference points: 1 Equity at 10M
 * lifetime LOC, 10 at 10B, 25 at 156B, 50 at 1.25T, 87 at 6.59T,
 * 200 at 80T, 622 (the whole store) at 2.41Qa. The full permanent
 * store costs 622 Equity: the 87 of the original six tracks plus the
 * 535 of Funding Rounds. */
export const PRESTIGE_CONFIG = Object.freeze({
  /** LOC per unit of the Equity curve (first Equity at 10M lifetime LOC). */
  equityLocUnit: 10_000_000,
  /** The curve's degree: Equity = floor((lifetime / unit)^(1/3)). */
  equityCurveExponent: 3,
  /** Total Equity the full permanent store costs. */
  totalStoreEquityCost: 622,
});

/** Lifetime LOC required to be entitled to `equityCount` Equity. */
export function equityThresholdLoc(equityCount) {
  const raw = Math.floor(Number(equityCount));
  const n = Number.isFinite(raw) && raw > 0 ? raw : 0;
  return (
    PRESTIGE_CONFIG.equityLocUnit *
    Math.pow(n, PRESTIGE_CONFIG.equityCurveExponent)
  );
}

/**
 * Whole Equity a lifetime LOC total entitles the player to: the
 * largest n with equityThresholdLoc(n) <= lifetime LOC. The root is
 * a first guess, then corrected against the exact thresholds, so a
 * float cube root that lands a hair under a whole number (or over
 * it) can never grant or withhold a point at the boundary. NaN,
 * negative and missing read as 0.
 */
export function entitledEquity(lifetimeLoc) {
  const raw = Number(lifetimeLoc);
  const loc = Number.isFinite(raw) && raw > 0 ? raw : 0;
  let n = Math.floor(
    Math.pow(
      loc / PRESTIGE_CONFIG.equityLocUnit,
      1 / PRESTIGE_CONFIG.equityCurveExponent
    )
  );
  while (n > 0 && equityThresholdLoc(n) > loc) n -= 1;
  while (equityThresholdLoc(n + 1) <= loc) n += 1;
  return n;
}

/** New Equity a sale would claim right now (entitled minus already earned). */
export function claimableEquity(lifetimeLoc, lifetimeEquityEarned) {
  return Math.max(
    0,
    entitledEquity(lifetimeLoc) - Math.max(0, lifetimeEquityEarned ?? 0)
  );
}

/** Spendable Equity: claimed minus permanent-store spending (Slice 2). */
export function availableEquity(lifetimeEquityEarned, equitySpent) {
  return Math.max(
    0,
    Math.max(0, lifetimeEquityEarned ?? 0) -
      Math.max(0, equitySpent ?? 0)
  );
}

/**
 * Founder production multiplier for P Lifetime Equity earned.
 * P <= 50: 1 + 0.10P (1.10x at P=1, 2x at P=10, 6x at P=50).
 * P > 50: 6 + 0.5 x log2(1 + (P - 50)/50) (6.5x at P=100, 7x at P=200).
 * Based on Lifetime Equity EARNED, even if spent (Brandon, Nov 15).
 */
export function founderMultiplier(lifetimeEquityEarned) {
  const p = Math.max(0, Math.floor(lifetimeEquityEarned ?? 0));
  if (p <= 50) return 1 + 0.1 * p;
  return 6 + 0.5 * Math.log2(1 + (p - 50) / 50);
}

/** Equity at which the Founder curve stops being linear (+10% each). */
export const FOUNDER_LINEAR_EQUITY_CAP = 50;
/** The Founder boost each Equity adds while the curve is linear. */
export const FOUNDER_BOOST_PER_EQUITY = 0.1;

/**
 * The Founder boost as a percent of extra LOC (issue #131): 20 for
 * 1.20x. Read off founderMultiplier itself, so the number the Sell
 * page shows is exactly the multiplier production applies (to clicks
 * and employee production). NaN or negative Equity reads as 0.
 */
export function founderBoostPercent(lifetimeEquityEarned) {
  const p = Number(lifetimeEquityEarned);
  return (founderMultiplier(Number.isFinite(p) ? p : 0) - 1) * 100;
}

/**
 * How many percentage points the NEXT Equity adds (issue #131): +10
 * up to 50 Equity, then less and less (the curve turns logarithmic).
 * The honest marginal value, from founderMultiplier itself.
 */
export function founderNextEquityBoostPercent(lifetimeEquityEarned) {
  const raw = Number(lifetimeEquityEarned);
  const p = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
  return (founderMultiplier(p + 1) - founderMultiplier(p)) * 100;
}

/**
 * Progress toward the next Equity point, for the bars (issue #131).
 * The bar spans the current bracket: entitlement n runs from
 * equityThresholdLoc(n) to equityThresholdLoc(n + 1) lifetime LOC (the
 * next Equity lands at 10,000,000 x (n + 1)^3). `seconds` is the time
 * left at the healthy rate (null with no production). NaN-guarded.
 * Returns { entitled, nextEquity, bracketLowLoc, nextThresholdLoc,
 * remainingLoc, fraction, seconds }.
 */
export function equityProgress(lifetimeLoc, healthyPassiveLocPerSec) {
  const raw = Number(lifetimeLoc);
  const loc = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const rawRate = Number(healthyPassiveLocPerSec);
  const rate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 0;
  const estimate = nextEquityEstimate(loc, rate);
  const bracketLowLoc = equityThresholdLoc(estimate.entitled);
  const span = Math.max(1, estimate.nextThresholdLoc - bracketLowLoc);
  return {
    entitled: estimate.entitled,
    nextEquity: estimate.entitled + 1,
    bracketLowLoc,
    nextThresholdLoc: estimate.nextThresholdLoc,
    remainingLoc: estimate.remainingLoc,
    fraction: Math.min(1, Math.max(0, (loc - bracketLowLoc) / span)),
    seconds: estimate.seconds,
  };
}

/**
 * Whether the next-Equity goal is visible yet (issue #131): the player
 * has Equity, or their lifetime LOC has reached the unlock visibility
 * threshold (10%) of the first Equity, the same rule every locked card
 * uses.
 */
export function equityGoalVisible(lifetimeLoc, lifetimeEquityEarned) {
  const loc = Number(lifetimeLoc);
  const earned = Number(lifetimeEquityEarned);
  return (
    (Number.isFinite(earned) && earned > 0) ||
    (Number.isFinite(loc) &&
      loc >= UNLOCK_VISIBILITY_THRESHOLD * equityThresholdLoc(1))
  );
}

/**
 * "+20%" for a boost percent: whole numbers stay whole, fractions get
 * up to two decimals ("+0.71%"). Used for the Founder copy.
 */
export function formatBoostPercent(percent) {
  const value = Number.isFinite(percent) ? percent : 0;
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0$/, "");
  return `+${text}%`;
}

/** ===== Prestige — permanent store (Slice 2) =====
 *
 * Seven upgrade tracks: Funding Rounds (issue #170, the progression
 * gate), the five of the v2 prestige design section 3, and the Night
 * Shift Contract (issue #149). Ranks are purchased in order; prices
 * are PER RANK, not cumulative; no prerequisites between tracks.
 * Purchases are available ONLY in the post-sale intermission (after
 * selling, before starting the next company). The full store costs
 * exactly 622 Equity in total (87 for the original six, 535 for
 * Funding Rounds).
 *
 * Equity prices are FIXED (5/20/60/150/300, 1/3/8, 2/5/10, 3/8/20,
 * 2/6/15, 2, 2). Do
 * NOT multiply them by LOC/s: that would penalize hiring, create
 * expensive quotes at high rates and cheap quotes after a reset, and
 * duplicate the progression already priced by the lifetime curve.
 * Cash-denominated benefits (Starting Capital) scale with production
 * time instead.
 *
 * No store item removes withdrawal, softens the SUBTRACTERALL decay,
 * or makes SUBTRACTERALL the optimal default. No permanent employee
 * price discounts or star-frequency upgrades in v1.
 *
 * Copy rules: no em dashes in any player-facing description.
 */

/** The permanent store tracks, in display order (Funding Rounds first: it is the gate). */
export const PRESTIGE_STORE_IDS = Object.freeze([
  "fundingRounds",
  "startingCapital",
  "keyboard",
  "engineeringHandbook",
  "clientNetwork",
  "companyTemplate",
  "nightShiftContract",
]);

/**
 * Per-track store config. `rankCosts` is the Equity price of each
 * rank in order (rank 1 first); `maxRank` is rankCosts.length.
 * `effect` is the per-rank effect, as a total by rank (not per
 * purchase): Keyboard rank 2 is +2 base LOC per click total, not +1
 * on top of rank 1; Handbook rank 3 is +15% total, not three
 * compounded 1.05x purchases.
 */
export const PRESTIGE_STORE_CONFIG = Object.freeze({
  // Funding Rounds (issue #170): each rank is a round (Seed, Series
  // A, Series B, Series C, IPO) and raises the level caps of the
  // gated tracks (FUNDING_ROUNDS_CONFIG.levelCaps). Prices and names
  // live in FUNDING_ROUNDS_CONFIG.
  fundingRounds: Object.freeze({
    displayName: "Funding Rounds",
    description:
      "Trade Equity for a bigger round. Every round raises the level caps on CoffeeScript, Junior Achievement, Senior Moment, Scrum Master, Commitment Issues and Ship Happens for every company after.",
    rankCosts: FUNDING_ROUNDS_CONFIG.rankCosts,
  }),
  startingCapital: Object.freeze({
    displayName: "Starting Capital",
    description:
      "Start each new company with cash from your sold company's production.",
    rankCosts: Object.freeze([1, 3, 8]),
    // Seconds of the sold company's healthy production value, by rank.
    rankSeconds: Object.freeze([0.25, 0.5, 1]),
  }),
  keyboard: Object.freeze({
    displayName: "Keyboard",
    description:
      "The last acquisition finally paid for a functioning spacebar.",
    rankCosts: Object.freeze([2, 5, 10]),
    // Base LOC per click added, by total rank (1 base becomes 4 at max).
    rankClickBonus: Object.freeze([1, 2, 3]),
  }),
  engineeringHandbook: Object.freeze({
    displayName: "Engineering Handbook",
    description: "The documentation survived. Nobody knows how.",
    rankCosts: Object.freeze([3, 8, 20]),
    // All-production bonus, by total rank (additive, not compounded).
    rankProductionBonus: Object.freeze([0.05, 0.1, 0.15]),
  }),
  clientNetwork: Object.freeze({
    displayName: "Client Network",
    description: "Same work. More people saying they know the founder.",
    rankCosts: Object.freeze([2, 6, 15]),
    // Freelance cash payout bonus, by total rank (additive).
    rankPayoutBonus: Object.freeze([0.05, 0.1, 0.15]),
  }),
  companyTemplate: Object.freeze({
    displayName: "Company Template",
    description:
      "A clean slate, prefilled with your previous mistakes. Keeps your favorited projects when you sell.",
    rankCosts: Object.freeze([2]),
  }),
  // Night Shift Contract (issue #149, Brandon's decision): Night Shift
  // resets on sale like every upgrade, and this one rank keeps one
  // earned level through it: every new company starts at Night Shift
  // level 1 (applied when the post-sale intermission completes). 2
  // Equity: the convenience tier (Company Template, Keyboard 1, Client
  // Network 1), below the always-on Handbook 1 (3). Level 1 is 10% of
  // P for 4h: about 0.4h of production per night early in a company,
  // plus skipping its 20-minute price and the 10 Juniors gate.
  nightShiftContract: Object.freeze({
    displayName: "Night Shift Contract",
    description:
      "The night crew signs on with your next company too. Every new company starts with Night Shift level 1.",
    rankCosts: Object.freeze([2]),
  }),
});

/** All store ranks at zero (a fresh save, or a save from before the store). */
export function zeroStoreRanks() {
  const ranks = {};
  for (const storeId of PRESTIGE_STORE_IDS) ranks[storeId] = 0;
  return ranks;
}

/** Max rank of a store track (0 for an unknown id). */
export function storeMaxRank(storeId) {
  return PRESTIGE_STORE_CONFIG[storeId]?.rankCosts.length ?? 0;
}

/**
 * Equity price of buying `rank` (1-based) of a track, or null when
 * the rank does not exist (unknown track, rank below 1, rank above
 * the track's max). Prices are per rank, not cumulative.
 */
export function storeRankCost(storeId, rank) {
  const config = PRESTIGE_STORE_CONFIG[storeId];
  if (!config) return null;
  const r = Math.floor(rank ?? 0);
  if (r < 1 || r > config.rankCosts.length) return null;
  return config.rankCosts[r - 1];
}

/** Equity price of the NEXT rank after `currentRank`, or null when maxed. */
export function storeNextRankCost(storeId, currentRank) {
  return storeRankCost(storeId, Math.max(0, currentRank ?? 0) + 1);
}

/** Total Equity for every rank of every track: exactly 622 (87 for
 * the original six tracks plus 535 for Funding Rounds, issue #170). */
export function storeTotalEquityCost() {
  let total = 0;
  for (const storeId of PRESTIGE_STORE_IDS) {
    for (const cost of PRESTIGE_STORE_CONFIG[storeId].rankCosts) {
      total += cost;
    }
  }
  return total;
}

/** Base LOC per click added by the Keyboard rank (0 when unowned). */
export function keyboardClickBonus(storeRanks = {}) {
  const rank = Math.max(0, storeRanks?.keyboard ?? 0);
  if (rank < 1) return 0;
  return (
    PRESTIGE_STORE_CONFIG.keyboard.rankClickBonus[
      Math.min(rank, storeMaxRank("keyboard")) - 1
    ] ?? 0
  );
}

/** All-production multiplier from the Engineering Handbook rank (1 when unowned). */
export function handbookProductionMultiplier(storeRanks = {}) {
  const rank = Math.max(0, storeRanks?.engineeringHandbook ?? 0);
  if (rank < 1) return 1;
  const bonus =
    PRESTIGE_STORE_CONFIG.engineeringHandbook.rankProductionBonus[
      Math.min(rank, storeMaxRank("engineeringHandbook")) - 1
    ] ?? 0;
  return 1 + bonus;
}

/** Freelance cash payout multiplier from the Client Network rank (1 when unowned). */
export function clientNetworkPayoutMultiplier(storeRanks = {}) {
  const rank = Math.max(0, storeRanks?.clientNetwork ?? 0);
  if (rank < 1) return 1;
  const bonus =
    PRESTIGE_STORE_CONFIG.clientNetwork.rankPayoutBonus[
      Math.min(rank, storeMaxRank("clientNetwork")) - 1
    ] ?? 0;
  return 1 + bonus;
}

/**
 * What ONE ship of a freelance project pays, in integer cents (issue
 * #176): the base reward times the Client Network multiplier, rounded
 * to whole cents per ship. This is the payout logic itself: the manual
 * Ship button and the Release Manager auto-ship both pay exactly this,
 * and the project cards display it, so the number on the card is the
 * number that lands. An unknown project key pays 0.
 */
export function freelanceShipPayoutCents(
  projectKey,
  storeRanks = {},
  { activeStarEffects = [], nowMs = Date.now() } = {}
) {
  const project = BALANCE.freelanceProjects[projectKey];
  if (!project) return 0;
  // Hype Train / Derailment (issue #157) multiplies here too, so the
  // manual Ship, the Release Manager auto-ship, the cash readout and
  // the card all pay and show the same boosted number.
  return Math.round(
    project.reward *
      clientNetworkPayoutMultiplier(storeRanks ?? {}) *
      hypePayoutMultiplier(activeStarEffects, nowMs)
  );
}

/**
 * The payout readout a project card shows (issue #176), derived from
 * the config and freelanceShipPayoutCents, never hand-written:
 *
 * - payoutCents: what one ship pays (Client Network included).
 * - centsPerLoc: the EFFECTIVE rate, payoutCents / loc. Fractional
 *   once Client Network applies (Hobby Website at rank 1: 50.4).
 * - baseCentsPerLoc: the same rate with no Client Network ranks.
 * - payoutBonus: the Client Network bonus applied (0.05 is +5%, 0 when
 *   unowned), so the card can say where the extra came from.
 * - hypeMultiplier: the live Hype Train (2) or Derailment (0.5)
 *   multiplier, 1 when neither is live (issue #157).
 *
 * The rate falls as the LOC cost rises, on purpose: small gigs pay the
 * best per LOC, big ones pay the most per ship. An unknown key returns
 * null.
 */
export function freelancePayoutQuote(projectKey, storeRanks = {}, effects = {}) {
  const project = BALANCE.freelanceProjects[projectKey];
  if (!project) return null;
  const payoutCents = freelanceShipPayoutCents(projectKey, storeRanks, effects);
  const multiplier = clientNetworkPayoutMultiplier(storeRanks ?? {});
  return {
    loc: project.loc,
    payoutCents,
    centsPerLoc: payoutCents / project.loc,
    baseCentsPerLoc: project.reward / project.loc,
    payoutBonus: Math.round((multiplier - 1) * 100) / 100,
    hypeMultiplier: hypePayoutMultiplier(effects?.activeStarEffects, effects?.nowMs ?? Date.now()),
  };
}

/**
 * Best currently available freelance payout per LOC, in cents per
 * LOC. "Best" is the highest-tier project the player has UNLOCKED:
 * rates fall as the LOC cost rises (the tradeoff is hammering the
 * cheap efficient gigs or spamming the big ones for faster money),
 * so the highest unlocked tier is the rate a player at that stage
 * actually ships at. The To Do List App has no unlock conditions,
 * so there is always at least one available project. Includes the
 * permanent Client Network payout bonus from the given store ranks
 * (the outgoing company's rank at sale time); the cash grant built
 * from this rate must never apply that bonus a second time.
 */
export function bestFreelancePayoutPerLocCents(
  unlockedFreelanceProjects = {},
  storeRanks = {}
) {
  let best = null;
  for (const key of FREELANCE_PROJECT_KEYS) {
    if (!unlockedFreelanceProjects?.[key]) continue;
    best = BALANCE.freelanceProjects[key].reward / BALANCE.freelanceProjects[key].loc;
  }
  if (best === null) {
    best =
      BALANCE.freelanceProjects.toDoListApp.reward /
      BALANCE.freelanceProjects.toDoListApp.loc;
  }
  return best * clientNetworkPayoutMultiplier(storeRanks);
}

/**
 * The Starting Capital quote for a sale: the outgoing company's
 * healthy passive production R (LOC/s, permanent bonuses included,
 * temporary star and SUBTRACTERALL multipliers excluded) and the
 * best currently available freelance payout per LOC q (cents per
 * LOC, Client Network included). Both are frozen at sale time; the
 * intermission must use these values, never the empty new company.
 * `state` is the save-shaped pre-sale state (flat employees and
 * levels, the pre-sale Founder multiplier, the pre-sale store
 * ranks).
 */
export function prestigeSaleQuote(preSaleState) {
  const ranks = preSaleState.permanentStoreRanks ?? {};
  return {
    // The buffed healthy rate (Founder and achievement buffs in,
    // issue #132): the same rate the client's production runs at.
    healthyPassiveLocPerSec: buffedLocPerSecond(preSaleState),
    bestPayoutPerLocCents: bestFreelancePayoutPerLocCents(
      preSaleState.unlockedFreelanceProjects ?? {},
      ranks
    ),
  };
}

/**
 * Starting Capital cash quote, in cents, for `rank` (0 = unowned, no
 * quote): R x q x rank seconds, rounded ONCE to whole cents. At
 * R=3,660 LOC/s and q=21c/LOC: rank 1 = 19,215c ($192.15), rank 2 =
 * 38,430c ($384.30), rank 3 = 76,860c ($768.60). A one-minute grant
 * ($46,116 at that rate) is explicitly rejected; do not use it.
 */
export function startingCapitalQuoteCents(frozenR, frozenQ, rank) {
  const r = Math.max(0, rank ?? 0);
  if (r < 1) return 0;
  const seconds =
    PRESTIGE_STORE_CONFIG.startingCapital.rankSeconds[
      Math.min(r, storeMaxRank("startingCapital")) - 1
    ] ?? 0;
  return Math.round(
    Math.max(0, frozenR ?? 0) * Math.max(0, frozenQ ?? 0) * seconds
  );
}

/**
 * Starting Capital grant, applied once when the next company starts:
 * new-company cash is max(normal new-company cash, one base-price
 * Intern, the rank quote). The one-Intern floor is the current base
 * Intern price ($25), a functional bootstrap minimum, not a
 * veteran-scale award. With no rank, cash is unchanged (normal
 * new-company defaults). The max() makes the grant idempotent: a
 * second application cannot add it again.
 */
export function startingCapitalGrantCents(money, frozenR, frozenQ, rank) {
  const current = Math.max(0, money ?? 0);
  if (Math.max(0, rank ?? 0) < 1) return current;
  return Math.max(
    current,
    BALANCE.employees.intern.baseCost,
    startingCapitalQuoteCents(frozenR, frozenQ, rank)
  );
}

/** Eligible LOC earned since the last sale (informational). */
export function companyLocEarned(state) {
  return Math.max(
    0,
    (state.totalLinesOfCode ?? 0) - (state.lifetimeLocAtLastSale ?? 0)
  );
}

/**
 * The next unearned Equity threshold and the current-rate time to
 * reach it. `healthyPassiveLocPerSec` is the healthy passive rate
 * (permanent bonuses included, temporary star and SUBTRACTERALL
 * multipliers excluded); the estimate never subtracts the LOC bank.
 * `seconds` is null when there is no passive production ("Requires
 * production" in the UI) instead of a numeric estimate.
 */
export function nextEquityEstimate(lifetimeLoc, healthyPassiveLocPerSec) {
  const loc = Math.max(0, lifetimeLoc ?? 0);
  const entitled = entitledEquity(loc);
  const nextThresholdLoc = equityThresholdLoc(entitled + 1);
  const remainingLoc = Math.max(0, nextThresholdLoc - loc);
  const rate = healthyPassiveLocPerSec ?? 0;
  return {
    entitled,
    nextThresholdLoc,
    remainingLoc,
    seconds: rate > 0 ? remainingLoc / rate : null,
  };
}

/**
 * "38m 33s" / "1h 12m" / "45s" for a duration in seconds. Exact
 * minutes drop the "0s" ("38m", not "38m 0s"); hours drop the
 * seconds (an hour-scale estimate is approximate by nature).
 */
export function formatEstimateDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const remainder = total % 60;
    return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder === 0
    ? `${hours}h`
    : `${hours}h ${minuteRemainder}m`;
}

/** ===== Night Shift: offline production (issue #149) =====
 *
 * The team keeps coding a little while the game is closed. A leveled,
 * PURCHASED company upgrade (cash, priced as time at current LOC/s);
 * level 0 is zero offline LOC. Approved design: issue #149, comment
 * 6970751928, with Brandon's decision in comment 6982217342.
 *
 *   P = buffedLocPerSecond(state): the healthy passive rate with the
 *       Founder multiplier, the achievement buff, the doubling tracks,
 *       Blocker, Project Managers and the Engineering Handbook in;
 *       star buffs and SUBTRACTERALL out. So prestige and achievements
 *       apply to offline LOC, exactly as they do to passive LOC.
 *   B = P x R (R = 60 cents per LOC, bestCentsPerLoc), the same
 *       production value the llama economy prices from.
 *
 * Settlement is SERVER-authoritative: the server settles on load,
 * from its own clock and the state it already accepted (see
 * settleNightShift and store.loadAndSettle). Offline credit is LOC
 * only: no clicks, no stars, no Release Manager shipping. SUBTRACTERALL
 * is ignored (P already excludes it).
 *
 * Night Shift is company-local: a sale resets it to 0, like every
 * other upgrade (the Nov 15 rule). The Night Shift Contract store rank
 * (PRESTIGE_STORE_CONFIG.nightShiftContract) grants level 1 at the
 * start of each new company.
 *
 * Copy rules: no em dashes in any player-facing string.
 */
export const NIGHT_SHIFT_CONFIG = Object.freeze({
  /** Highest level. */
  maxLevel: 5,
  /** An absence shorter than this credits nothing (5 minutes). An
   *  open tab saves every 60s, so a live session never reaches it:
   *  online and offline production can never cover the same time. */
  minAwaySeconds: 5 * 60,
  /** Per level (index 0 is level 1): the share of P credited while
   *  away, the hours counted per absence, the price in seconds of
   *  production value (B), and the gate (live P and a live employee
   *  count). Each level also needs the one before it. */
  levels: Object.freeze([
    Object.freeze({
      rate: 0.1,
      capHours: 4,
      priceSeconds: 20 * 60,
      gate: Object.freeze({ minLocPerSecond: 100, employeeType: "junior", employeeCount: 10 }),
    }),
    Object.freeze({
      rate: 0.2,
      capHours: 8,
      priceSeconds: 30 * 60,
      gate: Object.freeze({ minLocPerSecond: 1_000, employeeType: "senior", employeeCount: 5 }),
    }),
    Object.freeze({
      rate: 0.3,
      capHours: 12,
      priceSeconds: 45 * 60,
      gate: Object.freeze({ minLocPerSecond: 10_000, employeeType: "projectManager", employeeCount: 10 }),
    }),
    Object.freeze({
      rate: 0.4,
      capHours: 16,
      priceSeconds: 60 * 60,
      gate: Object.freeze({ minLocPerSecond: 100_000, employeeType: "releaseManager", employeeCount: 10 }),
    }),
    Object.freeze({
      rate: 0.5,
      capHours: 24,
      priceSeconds: 90 * 60,
      gate: Object.freeze({ minLocPerSecond: 1_000_000, employeeType: "senior", employeeCount: 25 }),
    }),
  ]),
});

/** A finite, non-negative number, or 0 (NaN, negatives, junk). */
function nightShiftSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A guarded Night Shift level: an integer 0..maxLevel, missing or junk reads 0. */
export function nightShiftLevelOf(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(NIGHT_SHIFT_CONFIG.maxLevel, n);
}

/** The config of level `level` (1..5), or null for 0 and anything out of range. */
export function nightShiftLevelConfig(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n < 1 || n > NIGHT_SHIFT_CONFIG.maxLevel) {
    return null;
  }
  return NIGHT_SHIFT_CONFIG.levels[n - 1];
}

/** The share of P credited while away at a level (0 at level 0). */
export function nightShiftRate(level) {
  return nightShiftLevelConfig(level)?.rate ?? 0;
}

/** The seconds counted per absence at a level (0 at level 0). */
export function nightShiftCapSeconds(level) {
  return (nightShiftLevelConfig(level)?.capHours ?? 0) * 3600;
}

/**
 * Hours of full passive production an absence of `awayHours` returns
 * at a level: rate x min(away, cap). 8h at level 5 is 4.
 */
export function nightShiftHoursOfProduction(level, awayHours) {
  const config = nightShiftLevelConfig(level);
  if (!config) return 0;
  return config.rate * Math.min(nightShiftSafeNumber(awayHours), config.capHours);
}

/**
 * The price of buying `level` (1..5), in whole cents, at buffed P:
 * priceSeconds x B. Quoted at the CURRENT P, like the barn and the
 * llamas (P floored at minPricingLocPerSecond so it is never free).
 * 0 for a level that does not exist.
 */
export function nightShiftPriceCents(level, buffedLocPerSec) {
  const config = nightShiftLevelConfig(level);
  if (!config) return 0;
  return Math.round(
    config.priceSeconds * farmProductionValueCentsPerSecond(buffedLocPerSec)
  );
}

/**
 * Gate progress for buying `level`: the live P against its minimum and
 * the live count of one employee type against its target. A missing
 * count reads 0. `met` is both. Null for a level that does not exist.
 */
export function nightShiftGateProgress(level, buffedLocPerSec, employeeCounts) {
  const config = nightShiftLevelConfig(level);
  if (!config) return null;
  const { minLocPerSecond, employeeType, employeeCount } = config.gate;
  const rate = nightShiftSafeNumber(buffedLocPerSec);
  const hired = nightShiftSafeNumber(employeeCounts?.[employeeType]);
  return {
    locPerSecond: { current: rate, target: minLocPerSecond, met: rate >= minLocPerSecond },
    employees: {
      employeeType,
      current: hired,
      target: employeeCount,
      met: hired >= employeeCount,
    },
    met: rate >= minLocPerSecond && hired >= employeeCount,
  };
}

/**
 * The next level a player could buy, or null at max: its level, price
 * (cents at current P), gate progress, whether it is affordable, and
 * whether it can be bought right now (gate met and affordable).
 */
export function nightShiftNextPurchase({ level, money, buffedLocPerSec, employeeCounts }) {
  const next = nightShiftLevelOf(level) + 1;
  if (next > NIGHT_SHIFT_CONFIG.maxLevel) return null;
  const priceCents = nightShiftPriceCents(next, buffedLocPerSec);
  const gate = nightShiftGateProgress(next, buffedLocPerSec, employeeCounts);
  const affordable = nightShiftSafeNumber(money) >= priceCents;
  return { level: next, priceCents, gate, affordable, canBuy: gate.met && affordable };
}

/**
 * The offline credit for an absence (pure; the server calls it with
 * ITS clock). Credits nothing at level 0, under minAwaySeconds, or at
 * zero production. Returns null for no credit, else the report:
 * { awaySeconds, countedSeconds, rate, creditedLoc, hoursOfProduction }.
 * creditedLoc = floor(rate x P x min(away, cap)), a whole LOC.
 */
export function nightShiftCredit(level, buffedLocPerSec, awaySeconds) {
  const config = nightShiftLevelConfig(level);
  const away = nightShiftSafeNumber(awaySeconds);
  const rate = nightShiftSafeNumber(buffedLocPerSec);
  if (!config || away < NIGHT_SHIFT_CONFIG.minAwaySeconds || rate <= 0) {
    return null;
  }
  const countedSeconds = Math.min(away, config.capHours * 3600);
  const creditedLoc = Math.floor(config.rate * rate * countedSeconds + 1e-9);
  if (creditedLoc <= 0) return null;
  return {
    awaySeconds: Math.floor(away),
    countedSeconds: Math.floor(countedSeconds),
    rate: config.rate,
    creditedLoc,
    hoursOfProduction: creditedLoc / rate / 3600,
  };
}

/**
 * Settle Night Shift on a save-shaped state for an absence of
 * `awaySeconds` (server clock). Returns `{ state, report }` with the
 * credit added to linesOfCode and totalLinesOfCode (so it counts toward
 * lifetime LOC and Equity like any LOC), or null when nothing is
 * credited. P comes from the state itself (the state the server
 * already accepted), never from the client. Nothing settles during
 * the post-sale intermission (no company is running).
 *
 * With an `emailId` (a UUID the caller mints; this stays pure), the
 * report mail is filed in the same state, keyed `night-shift:<nowMs>`:
 * the mail is stored atomically with the credit, so no later client
 * restore can lose it. The inbox keeps its cap (oldest dropped).
 */
export function settleNightShift(state, awaySeconds, { nowMs = 0, emailId = null } = {}) {
  if (!state || typeof state !== "object") return null;
  if (state.prestigeIntermission) return null;
  const report = nightShiftCredit(
    nightShiftLevelOf(state.nightShiftLevel),
    buffedLocPerSecond(state),
    awaySeconds
  );
  if (!report) return null;
  const next = {
    ...state,
    linesOfCode: nightShiftSafeNumber(state.linesOfCode) + report.creditedLoc,
    totalLinesOfCode:
      nightShiftSafeNumber(state.totalLinesOfCode) + report.creditedLoc,
  };
  const createdAtMs = Math.max(0, Math.floor(nightShiftSafeNumber(nowMs)));
  const triggerKey = `night-shift:${createdAtMs}`;
  const inbox = Array.isArray(state.emails) ? state.emails : [];
  if (emailId && !inbox.some((entry) => entry?.triggerKey === triggerKey)) {
    const mail = buildNightShiftEmail(report);
    let emails = [
      ...inbox,
      { id: emailId, triggerKey, ...mail, createdAtMs, read: false },
    ];
    while (emails.length > EMAIL_CONFIG.maxInboxEmails) emails = emails.slice(1);
    next.emails = emails;
    return { state: next, report: { ...report, emailId, triggerKey } };
  }
  return { state: next, report };
}

/** The Night Shift level a new company starts at: 1 with the Night
 *  Shift Contract store rank, else 0. */
export function nightShiftStartLevel(storeRanks) {
  return Math.max(0, Math.floor(Number(storeRanks?.nightShiftContract) || 0)) >= 1
    ? 1
    : 0;
}

/** The inbox mail for a settled absence (shown once, on return). */
export function buildNightShiftEmail(report) {
  const loc = formatNumber(nightShiftSafeNumber(report?.creditedLoc));
  const away = formatEstimateDuration(nightShiftSafeNumber(report?.awaySeconds));
  const hours = Math.round(nightShiftSafeNumber(report?.hoursOfProduction) * 10) / 10;
  const counted = nightShiftSafeNumber(report?.countedSeconds);
  const capped = counted < nightShiftSafeNumber(report?.awaySeconds);
  return {
    sender: "Night Shift Lead",
    subject: `Night Shift report: +${loc} LOC`,
    body:
      `While you were away for ${away}, the night shift wrote ${loc} LOC ` +
      `(${hours} hours of production at ${Math.round(nightShiftSafeNumber(report?.rate) * 100)}% speed).` +
      (capped
        ? ` We clocked out after ${formatEstimateDuration(counted)}. Upgrade Night Shift for longer shifts.`
        : " Nobody touched the coffee machine. Probably."),
  };
}

/** ===== Prestige: SUBTRACTERALL (Slice 3, reworked in issue #150) =====
 *
 * An optional stimulant burst with diminishing returns (Brandon,
 * Nov 16). Canonical spelling is SUBTRACTERALL with two Ls. The
 * Overtime reskin is a SETTING (a text/framing layer, not a separate
 * mechanic): the same mechanics framed as mandated overtime, with the
 * crash framed as burnout. Mechanics are identical either way.
 *
 * Unlimited uses, no cap, no purchase, drop, or refill. Use n is
 * 1-indexed and counts per company (the count resets on sale, so
 * each company starts again at use 1):
 *
 *   Burst:      3x production for 180 x 0.9^(n-1) seconds.
 *   Withdrawal: 0.5 x 0.9^(n-1) production for 180 x 1.2^(n-1)
 *               seconds, then Ready again.
 *
 * Each use makes the next boost shorter and the next crash longer and
 * harsher, so after many uses the boost is negligible and the crash
 * is severe. That is the point: no cap and no floor on the decay.
 * The withdrawal is a fixed duration at a reduced multiplier, not a
 * debt to repay. (The old tiers, liability, tolerance, and recovery
 * are gone.)
 *
 * Phase timers advance in CREDITED simulation seconds (one GAME_TICK
 * = one credited second), never wall-clock: a player who activates
 * it and closes the game comes back to the same phase with the same
 * remaining time. A wall-clock timer would let a player take a burst
 * and log out during the crash (the same anti-skip principle as the
 * star clock).
 *
 * State (persisted in the save):
 *   phase: "ready" | "burst" | "withdrawal"
 *   phaseRemainingSeconds: credited seconds left in the current phase
 *     (a non-negative number: 0.9^n durations are not whole seconds)
 *   uses: uses this company (0 = none yet; the next use is uses + 1).
 *     Resets to 0 on sale.
 *   activeUse: the use number n of the phase in progress (0 when
 *     Ready). It sets the phase's durations and multiplier, and it is
 *     why a phase that survives a sale keeps its exact terms even
 *     though `uses` resets.
 *
 * Copy rules: no em dashes in any player-facing string. The Overtime
 * framing never says "dose": the action is mandating overtime and the
 * crash is burnout.
 */

/** SUBTRACTERALL constants (issue #150). */
export const SUBTRACTERALL_CONFIG = Object.freeze({
  /** Lifetime LOC that permanently unlocks SUBTRACTERALL. */
  unlockLifetimeLoc: 100_000,
  /** Production multiplier during Burst (constant at every use). */
  burstMultiplier: 3,
  /** Burst length at use 1, in credited seconds. */
  burstBaseSeconds: 180,
  /** Each use multiplies the next burst's length by this (10% shorter). */
  burstDecayPerUse: 0.9,
  /** Withdrawal length at use 1, in credited seconds. */
  withdrawalBaseSeconds: 180,
  /** Each use multiplies the next withdrawal's length by this (20% longer). */
  withdrawalGrowthPerUse: 1.2,
  /** Withdrawal production multiplier at use 1. */
  withdrawalBaseMultiplier: 0.5,
  /** Each use multiplies the next withdrawal multiplier by this (10% worse). */
  withdrawalMultiplierDecayPerUse: 0.9,
});

/** A 1-indexed use number, guarded: anything below 1 or not finite reads as 1. */
function useIndex(n) {
  const value = Math.floor(Number(n));
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

/** Burst length for use n: 180 x 0.9^(n-1) credited seconds. */
export function subtracterallBurstSeconds(n) {
  return (
    SUBTRACTERALL_CONFIG.burstBaseSeconds *
    Math.pow(SUBTRACTERALL_CONFIG.burstDecayPerUse, useIndex(n) - 1)
  );
}

/** Withdrawal length for use n: 180 x 1.2^(n-1) credited seconds. */
export function subtracterallWithdrawalSeconds(n) {
  return (
    SUBTRACTERALL_CONFIG.withdrawalBaseSeconds *
    Math.pow(SUBTRACTERALL_CONFIG.withdrawalGrowthPerUse, useIndex(n) - 1)
  );
}

/** Withdrawal production multiplier for use n: 0.5 x 0.9^(n-1). */
export function subtracterallWithdrawalMultiplier(n) {
  return (
    SUBTRACTERALL_CONFIG.withdrawalBaseMultiplier *
    Math.pow(
      SUBTRACTERALL_CONFIG.withdrawalMultiplierDecayPerUse,
      useIndex(n) - 1
    )
  );
}

/** The terms of use n, for the card: both durations and both multipliers. */
export function subtracterallUseTerms(n) {
  return {
    use: useIndex(n),
    burstSeconds: subtracterallBurstSeconds(n),
    burstMultiplier: SUBTRACTERALL_CONFIG.burstMultiplier,
    withdrawalSeconds: subtracterallWithdrawalSeconds(n),
    withdrawalMultiplier: subtracterallWithdrawalMultiplier(n),
  };
}

/**
 * Seconds as a short label with up to two decimals, trailing zeros
 * dropped: 180 -> "3m", 162 -> "2m 42s", 145.8 -> "2m 25.8s",
 * 131.22 -> "2m 11.22s", 45 -> "45s". Card copy reads exact terms.
 * An hour or more reads in hours and minutes (formatEstimateDuration).
 */
export function formatSubtracterallSeconds(seconds) {
  const total = Math.max(0, Math.round((Number(seconds) || 0) * 100) / 100);
  if (total >= 3600) return formatEstimateDuration(total);
  const minutes = Math.floor(total / 60);
  const rest = Math.round((total - minutes * 60) * 100) / 100;
  const secondsText = `${rest}s`;
  if (minutes === 0) return secondsText;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${secondsText}`;
}

/** A multiplier as a short label: 3 -> "3x", 0.405 -> "0.405x" (4 decimals max). */
export function formatSubtracterallMultiplier(multiplier) {
  return `${Math.round((Number(multiplier) || 0) * 10000) / 10000}x`;
}

/** Framing for the SUBTRACTERALL card and phase strip. The Overtime
 * reskin (Brandon, Nov 15; reworded in issue #150) is a text layer
 * only: same mechanics, framed as mandated overtime and burnout. It
 * never says "dose". */
export const SUBTRACTERALL_FRAMING = Object.freeze({
  subtracterall: Object.freeze({
    name: "SUBTRACTERALL",
    action: "Take Dose",
    usesLabel: "Doses taken this company",
    nextLabel: "Next dose",
    burstLabel: "Burst",
    withdrawalLabel: "Withdrawal",
    withdrawalDescription:
      "The sprint has ended. The consequences have not.",
    scalingNote:
      "Each dose makes the next burst shorter and the next withdrawal longer and harsher. There is no limit, and no way back up: the returns only diminish.",
    resetNote: "Selling the company resets the count to zero.",
  }),
  overtime: Object.freeze({
    name: "Overtime",
    action: "Mandate Overtime",
    usesLabel: "Overtime mandated this company",
    nextLabel: "Next overtime",
    burstLabel: "Crunch",
    withdrawalLabel: "Burnout",
    withdrawalDescription:
      "The overtime is over. The burnout is not.",
    scalingNote:
      "Each round of overtime makes the next one shorter and the burnout after it longer and harsher. There is no limit, and no way back up: the returns only diminish.",
    resetNote: "Selling the company resets the count to zero.",
  }),
});

/** The framing for the current reskin setting (false = SUBTRACTERALL). */
export function subtracterallFraming(overtimeReskin) {
  return overtimeReskin
    ? SUBTRACTERALL_FRAMING.overtime
    : SUBTRACTERALL_FRAMING.subtracterall;
}

/** A fresh SUBTRACTERALL state (new save, or a save from before issue #150). */
export function zeroSubtracterallState() {
  return {
    phase: "ready",
    phaseRemainingSeconds: 0,
    uses: 0,
    activeUse: 0,
  };
}

const SUBTRACTERALL_KEYS = Object.freeze(Object.keys(zeroSubtracterallState()));
/** Fields only the pre-#150 tier / liability system had. */
const LEGACY_SUBTRACTERALL_KEYS = Object.freeze([
  "liability",
  "tolerance",
  "activeTier",
  "dosesUsed",
  "recoverySeconds",
]);

/**
 * The SUBTRACTERALL state to use for a stored value: a missing,
 * non-object, or pre-#150 value (it carries a removed tier /
 * liability / tolerance field, or lacks one of the new ones) becomes the
 * fresh Ready state. That is a fresh default, not a migration: no old
 * value is carried over (Brandon is fine wiping). A value already in
 * the new shape is returned as is, so the shape check still sees and
 * rejects a present-but-wrong value.
 */
export function normalizeSubtracterallState(sub) {
  if (!sub || typeof sub !== "object" || Array.isArray(sub)) {
    return zeroSubtracterallState();
  }
  const legacy =
    LEGACY_SUBTRACTERALL_KEYS.some((key) => key in sub) ||
    SUBTRACTERALL_KEYS.some((key) => !(key in sub));
  return legacy ? zeroSubtracterallState() : { ...sub };
}

/** Whether SUBTRACTERALL is permanently unlocked at this lifetime LOC. */
export function subtracterallUnlocked(lifetimeLoc) {
  return (
    Math.max(0, lifetimeLoc ?? 0) >=
    SUBTRACTERALL_CONFIG.unlockLifetimeLoc
  );
}

/**
 * Whether it can be activated right now: the phase is Ready and there
 * is at least one employee with positive healthy production
 * (`healthyPassiveLocPerSec` is the healthy passive rate, permanent
 * bonuses included, temporary star multipliers excluded). No use cap.
 * The unlock (lifetime LOC) is checked separately by the caller.
 */
export function subtracterallCanActivate(sub, healthyPassiveLocPerSec) {
  const s = sub ?? zeroSubtracterallState();
  return s.phase === "ready" && (healthyPassiveLocPerSec ?? 0) > 0;
}

/** The use count, guarded: missing, negative, or NaN reads as 0. */
function usesSoFar(sub) {
  const value = Math.floor(Number(sub?.uses ?? 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Activate: Ready -> Burst for use n = uses + 1. Returns null when
 * the phase is not Ready; the caller checks the unlock and the
 * healthy-production requirement first. There is no cap.
 */
export function subtracterallActivate(sub) {
  const s = sub ?? zeroSubtracterallState();
  if (s.phase !== "ready") return null;
  const n = usesSoFar(s) + 1;
  return {
    phase: "burst",
    phaseRemainingSeconds: subtracterallBurstSeconds(n),
    uses: n,
    activeUse: n,
  };
}

/** The production multiplier of a state's current phase (1 when Ready). */
export function subtracterallPhaseMultiplier(sub) {
  const s = sub ?? zeroSubtracterallState();
  if (s.phase === "burst") return SUBTRACTERALL_CONFIG.burstMultiplier;
  if (s.phase === "withdrawal") {
    return subtracterallWithdrawalMultiplier(s.activeUse);
  }
  return 1;
}

/**
 * Advance SUBTRACTERALL over `elapsedSeconds` of credited simulation
 * time at `healthyPerSec` (the LOC/s the player would earn without
 * SUBTRACTERALL, all other modifiers included: star buffs, Founder,
 * Handbook, doubling). Returns `{ state, credited }`: the next state
 * and the LOC credited over the interval (a float; the caller floors
 * the final total, the same rule as the tick and the click).
 *
 * The interval is split at phase boundaries, so a phase ending
 * mid-interval credits each part at its own multiplier: a burst
 * ending 0.8s into a tick credits 0.8s at 3x and 0.2s at the
 * withdrawal rate. The phase clock advances even when the rate is 0
 * (the tick IS credited simulation time).
 */
export function advanceSubtracterall(sub, healthyPerSec, elapsedSeconds) {
  const s = { ...(sub ?? zeroSubtracterallState()) };
  const rate = Math.max(0, Number(healthyPerSec) || 0);
  let remaining = Math.max(0, Number(elapsedSeconds) || 0);
  let credited = 0;
  // Each iteration ends a phase or consumes the rest of the interval,
  // so at most three iterations happen per call (burst, withdrawal,
  // ready). The guard is a safety net against a malformed state.
  let guard = 0;
  while (remaining > 0 && guard < 5) {
    guard += 1;
    if (s.phase !== "burst" && s.phase !== "withdrawal") {
      credited += rate * remaining;
      remaining = 0;
      break;
    }
    const phaseLeft = Math.max(0, Number(s.phaseRemainingSeconds) || 0);
    const seg = Math.min(remaining, phaseLeft);
    credited += subtracterallPhaseMultiplier(s) * rate * seg;
    remaining -= seg;
    s.phaseRemainingSeconds = phaseLeft - seg;
    if (s.phaseRemainingSeconds <= 1e-9) {
      if (s.phase === "burst") {
        s.phase = "withdrawal";
        s.phaseRemainingSeconds = subtracterallWithdrawalSeconds(s.activeUse);
      } else {
        s.phase = "ready";
        s.phaseRemainingSeconds = 0;
        s.activeUse = 0;
      }
    }
  }
  return { state: s, credited };
}

/**
 * Apply one click's healthy LOC through the current phase. `healthy`
 * is the LOC the click would have produced without SUBTRACTERALL (an
 * integer: the floored click total, all other modifiers included).
 * Returns `{ state, credited }` with an integer credit: burst credits
 * 3x, withdrawal credits floor(multiplier x healthy), ready credits
 * the click unchanged. A click never advances time, so it never ends
 * a phase.
 */
export function subtracterallApplyClick(sub, healthy) {
  const s = sub ?? zeroSubtracterallState();
  const healthyLoc = Math.max(0, Number(healthy) || 0);
  return {
    state: s,
    credited: Math.floor(subtracterallPhaseMultiplier(s) * healthyLoc + 1e-9),
  };
}

/**
 * Build the post-sale state for a prestige sale (Sell the Company).
 * Pure: the caller validates the sale first (see
 * `validatePrestigeSale` in server/src/validate.js — at least one
 * new Equity, prestige fields matching the stored state). Returns
 * null when there is nothing to claim, so a zero-reward sale can
 * never be applied by accident.
 *
 * Structure (Slice 3-proof): start from the pre-sale state and
 * overwrite ONLY the explicit company-local allowlist below. Any
 * field NOT on the list survives the sale by default. SUBTRACTERALL
 * (issue #150): the use count is company-local and resets to 0 in the
 * list below; a phase in progress survives with its exact remaining
 * time and terms (activeUse), so selling never cures a withdrawal.
 *
 * RESETS (company-local): cash and spendable LOC; all hired
 * employees including managers; run upgrades, project progression
 * and automation purchases (including the six doubling upgrades,
 * Constellation, OverReact, StarBroker, and every other Open Source
 * project — Brandon, Nov 15: ALL upgrades reset); run-local unlock
 * latches, re-derived from the post-sale state (LOC-gated unlocks
 * re-fire at once from lifetime LOC; count-gated ones wait for the
 * new company to re-earn them); run-local project queues; golden-star
 * buffs and uncollected stars; company-specific timers; the llama
 * farm (ownership, stalls, llamas, discovered types — Brandon,
 * Nov 15: the farm RESETS, it does not survive as a collection);
 * the SUBTRACTERALL use count (issue #150: the new company starts at
 * use 1; a phase in progress is NOT reset and survives the sale).
 *
 * PERSISTS: Lifetime LOC and earned/unspent Equity; achievements and
 * cosmetic unlocks (without regranting rewards); the inbox (its
 * triggerKey dedupe stops re-fired unlock mail from duplicating);
 * preferences, accessibility settings and statistics; the remaining
 * golden-star spawn interval (`nextStarAtMs` is an absolute
 * timestamp, so keeping its value keeps the remaining interval —
 * selling must not reroll an immediate star); the StarBroker buy
 * cooldown (`lastStarBuyAtMs`, same reasoning: keeping it can only
 * delay a future buy, never grant one); the permanent store ranks
 * (Slice 2: the store is permanent, only the company resets); the
 * favorited projects, but ONLY when Company Template is owned
 * (Slice 2: without it, favorites reset with the company). No free
 * Airdrop is generated on sale.
 *
 * INTERMISSION (Slice 2): the sale opens the post-sale intermission,
 * where the permanent store is bought. The frozen quote
 * (`prestigeSaleQuote` of the PRE-sale state: healthy passive LOC/s
 * and best payout per LOC, both including the outgoing company's
 * permanent bonuses and excluding temporary star and SUBTRACTERALL
 * effects) is stored on the post-sale state, so the Starting Capital
 * grant is computed from the sold company, never the empty new one.
 * The intermission is cleared only by completing it (see
 * `completePrestigeIntermission`); a normal save can never set or
 * clear it. Starting cash from permanent upgrades is applied at
 * intermission completion, not here: the player may buy or increase
 * the Starting Capital rank during the intermission, and the grant
 * uses the frozen quote with the rank they end up with.
 */
export function applyPrestigeSale(preSaleState, saleId) {
  const lifetimeLoc = Math.max(0, preSaleState.totalLinesOfCode ?? 0);
  const earnedBefore = Math.max(0, preSaleState.lifetimeEquityEarned ?? 0);
  const gainedEquity = claimableEquity(lifetimeLoc, earnedBefore);
  if (gainedEquity < 1) return null;

  const zeroEmployees = {};
  for (const type of EMPLOYEE_TYPES) zeroEmployees[type] = 0;
  const zeroProjects = {};
  const zeroAssignments = {};
  const zeroAutoShips = {};
  for (const key of FREELANCE_PROJECT_KEYS) {
    zeroProjects[key] = 0;
    zeroAssignments[key] = 0;
    zeroAutoShips[key] = 0;
  }
  const zeroLevels = {};
  for (const projectId of OPEN_SOURCE_IDS) zeroLevels[projectId] = 0;

  // The frozen Starting Capital quote, from the PRE-sale state: the
  // healthy passive rate and the best payout per LOC the outgoing
  // company had. The intermission carries these, so the grant is
  // priced from the sold company even though the new company starts
  // empty. The quote is computed here, before the reset, because the
  // reset destroys the company it prices.
  const quote = prestigeSaleQuote(preSaleState);
  // Company Template (Slice 2): favorited projects survive the sale
  // only when the rank is owned; otherwise favorites reset with the
  // company, like every other run-local preference.
  const keepFavorites =
    Math.max(0, preSaleState.permanentStoreRanks?.companyTemplate ?? 0) >= 1;
  const favorites = keepFavorites
    ? [...(preSaleState.favoriteOpenSourceProjects ?? [])]
    : [];

  // The post-sale state first: company-local fields reset, everything
  // else carried over untouched (see the doc comment above). The
  // unlock latches start locked and are re-derived below from the
  // post-sale state itself.
  const post = {
    ...preSaleState,
    linesOfCode: BALANCE.mechanics.startingLoc,
    money: BALANCE.mechanics.startingMoney,
    employees: zeroEmployees,
    freelanceProjectsCompleted: zeroProjects,
    releaseManagerAssignments: zeroAssignments,
    autoShipsCompleted: zeroAutoShips,
    openSourceProjects: zeroLevels,
    unlockedEmployees: {},
    unlockedOpenSourceProjects: {},
    unlockedFreelanceProjects: {},
    activeStarEffects: [],
    farm: emptyFarmState(),
    // SUBTRACTERALL (issue #150): the use count resets, so the new
    // company starts again at use 1. A phase in progress SURVIVES the
    // sale with its exact remaining time and its terms (activeUse):
    // selling does not cure a withdrawal, and activating again stays
    // disabled until the surviving phase ends.
    subtracterall: {
      ...normalizeSubtracterallState(preSaleState.subtracterall),
      uses: 0,
    },
    favoriteOpenSourceProjects: favorites,
    // Night Shift (issue #149): an upgrade like any other, so it
    // RESETS on sale (the Nov 15 rule). The Night Shift Contract
    // rank grants level 1 when the new company starts (see
    // completePrestigeIntermission), not here.
    nightShiftLevel: 0,
    lifetimeEquityEarned: earnedBefore + gainedEquity,
    saleCount: Math.max(0, preSaleState.saleCount ?? 0) + 1,
    lifetimeLocAtLastSale: lifetimeLoc,
    lastSaleId: saleId,
    prestigeIntermission: {
      saleId,
      frozenHealthyPassiveLocPerSec: quote.healthyPassiveLocPerSec,
      frozenBestPayoutPerLocCents: quote.bestPayoutPerLocCents,
    },
  };
  for (const type of EMPLOYEE_TYPES) {
    post.unlockedEmployees[type] = employeeUnlockConditionsMet(type, post);
  }
  for (const projectId of OPEN_SOURCE_IDS) {
    post.unlockedOpenSourceProjects[projectId] =
      openSourceUnlockConditionsMet(projectId, post);
  }
  for (const key of FREELANCE_PROJECT_KEYS) {
    post.unlockedFreelanceProjects[key] =
      freelanceProjectUnlockConditionsMet(key, post);
  }
  return post;
}

/**
 * Complete the post-sale intermission (Slice 2): apply the Starting
 * Capital grant once, from the FROZEN quote stored on the state, and
 * clear the intermission. Pure: the caller validates first (the
 * intermission must be active and match the stored one) and stores
 * the result. Returns null when there is no intermission to complete
 * (already completed: a retried completion is a no-op, never a
 * second grant).
 *
 * The grant uses the rank the player ends the intermission with
 * (they may have bought or increased Starting Capital during it) and
 * the frozen R and q from the sale: money becomes max(current money,
 * one base-price Intern, R x q x rank seconds). The max() makes the
 * grant idempotent even if it were applied twice, and the
 * intermission is cleared in the same step, so a retry finds nothing
 * to complete. With no Starting Capital rank, money is unchanged
 * (normal new-company defaults).
 */
export function completePrestigeIntermission(state) {
  const intermission = state.prestigeIntermission ?? null;
  if (
    !intermission ||
    typeof intermission !== "object" ||
    Array.isArray(intermission)
  ) {
    return null;
  }
  const rank = Math.max(
    0,
    state.permanentStoreRanks?.startingCapital ?? 0
  );
  return {
    ...state,
    money: startingCapitalGrantCents(
      state.money ?? 0,
      intermission.frozenHealthyPassiveLocPerSec,
      intermission.frozenBestPayoutPerLocCents,
      rank
    ),
    // Night Shift Contract (issue #149): the new company starts at
    // Night Shift level 1 when the rank is owned (bought before or
    // during the intermission). max() keeps it idempotent.
    nightShiftLevel: Math.max(
      nightShiftLevelOf(state.nightShiftLevel),
      nightShiftStartLevel(state.permanentStoreRanks)
    ),
    prestigeIntermission: null,
  };
}

/**
 * The intermission is store-only (issue #188, Brandon Nov 19: "It
 * should bring up the store to spend stuff on and nothing else"). These
 * are the company-progress fields that cannot move while the post-sale
 * intermission is open: the production, the bank, the company itself
 * (employees, levels, unlocks, the farm), the star timers and buffs,
 * and the lifetime records an intermission click or tick would feed
 * (lifetime LOC, achievements, cosmetics). The client makes all of
 * this inert; the server pins it (pinIntermissionProgress), so a
 * modified client's intermission accrual never reaches the store, the
 * stored state, or the next company.
 *
 * Not pinned: the Equity books, store ranks and the intermission
 * itself (only the sale, store-buy and complete endpoints move them,
 * and validateSave already rejects anything else), and the
 * presentation fields (emails, favorites, equipped cosmetics, the
 * overtime reskin), which are not progress.
 */
export const INTERMISSION_FROZEN_FIELDS = Object.freeze([
  "linesOfCode",
  "totalLinesOfCode",
  "money",
  "employees",
  "aiAssistants",
  "freelanceProjectsCompleted",
  "releaseManagerAssignments",
  "autoShipsCompleted",
  "openSourceProjects",
  "unlockedEmployees",
  "unlockedOpenSourceProjects",
  "unlockedFreelanceProjects",
  "activeStarEffects",
  "farm",
  "subtracterall",
  "nightShiftLevel",
  "nextStarAtMs",
  "lastStarBuyAtMs",
  "achievements",
  "unlockedCosmetics",
]);

/** Whether a state has the post-sale intermission open. */
export function intermissionOpen(state) {
  const intermission = state?.prestigeIntermission ?? null;
  return (
    intermission !== null &&
    typeof intermission === "object" &&
    !Array.isArray(intermission)
  );
}

/**
 * Pin the company-progress fields of `sentState` to `storedState`'s
 * while the STORED state has the intermission open (issue #188): the
 * result is the sent state with every INTERMISSION_FROZEN_FIELDS entry
 * replaced by the stored value. With no open intermission it returns
 * `sentState` unchanged. Pure; the caller has already validated the
 * sent state as an ordinary successor, so pinning only ever discards
 * intermission accrual, never a field the endpoints own.
 */
export function pinIntermissionProgress(storedState, sentState) {
  if (!intermissionOpen(storedState)) return sentState;
  const pinned = { ...sentState };
  for (const field of INTERMISSION_FROZEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(storedState, field)) {
      pinned[field] = structuredClone(storedState[field]);
    }
  }
  return pinned;
}

/**
 * The store purchase estimate for an unaffordable card (Slice 2):
 * how long to earn the Equity shortfall at a production rate. `c`
 * is the shortfall in Equity (price minus available Equity); the
 * target lifetime entitlement is claimed Equity + c, and the
 * remaining lifetime LOC is that threshold minus actual lifetime
 * LOC, clamped at zero. `seconds` is null when the rate is zero
 * ("Requires production") or the target is already entitled
 * ("Available after sale" in the UI when remaining is 0). The rate
 * is the frozen outgoing rate in the intermission (the only rate
 * that produces a meaningful estimate there: the new company starts
 * at zero production), or the current healthy rate when the store is
 * viewed mid-company.
 */
export function storePurchaseEstimate(
  lifetimeEquityEarned,
  lifetimeLoc,
  shortfallEquity,
  healthyPassiveLocPerSec
) {
  const c = Math.max(0, shortfallEquity ?? 0);
  const target = Math.max(0, lifetimeEquityEarned ?? 0) + c;
  const remainingLoc = Math.max(
    0,
    equityThresholdLoc(target) - Math.max(0, lifetimeLoc ?? 0)
  );
  const rate = Math.max(0, healthyPassiveLocPerSec ?? 0);
  return {
    shortfallEquity: c,
    targetEntitlement: target,
    remainingLoc,
    seconds: remainingLoc === 0 ? 0 : rate > 0 ? remainingLoc / rate : null,
  };
}

/** Total employees across all types, from flat counts. */
export function totalEmployees(employeeCounts) {
  return EMPLOYEE_TYPES.reduce(
    (sum, type) => sum + (employeeCounts[type] ?? 0),
    0
  );
}

/** Sum of one bonus type across all unlocked open-source levels. */
export function totalBonusByType(openSourceLevels, bonusType) {
  let total = 0;
  for (const projectId of OPEN_SOURCE_IDS) {
    const config = BALANCE.openSource[projectId];
    // Clamped to the levels this build defines (issue #179): a save
    // from a newer client can hold a higher level, and reading past
    // the end would throw in the production math.
    const level = Math.min(
      safeLevel(openSourceLevels?.[projectId] ?? 0),
      config.levels.length
    );
    for (let i = 0; i < level; i += 1) {
      const bonus = config.levels[i].bonus;
      if (bonus.type === bonusType) total += bonus.value;
    }
  }
  return total;
}

export function clickBonus(openSourceLevels) {
  return totalBonusByType(openSourceLevels, "CLICK_BOOST");
}

export function passiveBonus(openSourceLevels) {
  return totalBonusByType(openSourceLevels, "PASSIVE_BOOST");
}

/** LOC earned by one click, given the open-source levels and the employee
 * counts. The Commit Specialist bonus is part of the click, so it gets
 * the same OverReact click boost as the base manual click: the total is
 * floor((base + 0.2 x N) x (1 + clickBonus)). The FINAL total is floored
 * to a whole number (Brandon: a click must never yield or commit a
 * fractional amount — never 5093.1, always 5093). The floor is on the
 * total, not on the bonus in isolation, so it still holds if any part
 * of the total is ever fractional. `csSprintMultiplier` is a live Sprint
 * on Commit Specialists (default 1, i.e. no Sprint); each specialist
 * gives +0.2 LOC per click at 1x, +1.0 at 5x, +0.1 at 0.5x (a Meeting).
 * The Click star buff (AI Accelerator / Hallucination) multiplies the
 * whole click total in the client (see calculateLOCPerClick), CS bonus
 * included. `employeeCounts` may be omitted (a save from before Commit
 * Specialists shipped has no specialists, so the bonus is 0).
 * `founderMultiplierValue` is the prestige Founder multiplier
 * (1 + 0.10P, from Lifetime Equity earned): it applies ONCE to click
 * production, inside the same final floor as everything else.
 * Callers pass buffedLocMultiplier(state) (issue #132), which also
 * carries the achievement LOC buff.
 * `storeRanks` is the permanent store ranks (Slice 2): the Keyboard
 * adds to the base click (1 base becomes 4 at max rank, before
 * multipliers), and the Engineering Handbook multiplies all
 * production once (rank 3 is 1.15x, not three compounded 1.05x).
 * Both default to unowned, so existing callers are unaffected. */
export function locPerClick(
  openSourceLevels,
  employeeCounts,
  csSprintMultiplier = 1,
  founderMultiplierValue = 1,
  storeRanks = {}
) {
  // The +1e-9 guards the floor against float representation error:
  // 1 + 0.15 is 1.1499999999999999 in binary, so 100 x 1.15 floors
  // to 114 without it. The epsilon is far below any real fractional
  // LOC the game produces (a genuine 10.5 still floors to 10).
  return Math.floor(
    (BALANCE.mechanics.baseLocPerClick +
      keyboardClickBonus(storeRanks) +
      commitSpecialistClickBonus(
        employeeCounts,
        csSprintMultiplier,
        openSourceLevels
      )) *
      (1 + clickBonus(openSourceLevels)) *
      founderMultiplierValue *
      handbookProductionMultiplier(storeRanks) +
      1e-9
  );
}

/**
 * Base passive LOC/sec from employees, before the passive bonus.
 * Each type's rate is doubled per level of its doubling project
 * (issue #118): CoffeeScript doubles Interns, Junior Achievement
 * doubles Juniors, Senior Moment doubles Seniors. Project Managers,
 * Commit Specialists and Release Managers contribute 0 LOC/s here,
 * so their doubling is a no-op in this sum (their value lives in
 * the boost, the click, and the auto-ship instead).
 */
export function baseLocPerSecond(employeeCounts, openSourceLevels = {}) {
  return EMPLOYEE_TYPES.reduce(
    (sum, type) =>
      sum +
      BALANCE.employees[type].locPerSecond *
        (employeeCounts[type] ?? 0) *
        doublingMultiplier(type, openSourceLevels),
    0
  );
}

/**
 * Project Manager boost fraction: each Project Manager adds +1% to ALL
 * employee passive LOC. `pmSprintMultiplier` is a live Sprint on Project
 * Managers (default 1, i.e. no Sprint); a 5x Sprint makes each manager
 * give +5% while it is live, a Meeting halves it to +0.5% per manager.
 * Scrum Master (linear since issue #170) raises the per-manager boost
 * to 1% x (1 + level): +2% at L1, +6% at L5, +21% at L20.
 */
export function projectManagerBoostFraction(
  employeeCounts,
  pmSprintMultiplier = 1,
  openSourceLevels = {}
) {
  return (
    BALANCE.employees.projectManager.passiveBoostPerEmployee *
    (employeeCounts?.projectManager ?? 0) *
    pmSprintMultiplier *
    doublingMultiplier("projectManager", openSourceLevels)
  );
}

/** The LOC/s the Project Manager boost contributes at a 1x Sprint:
 * the boost fraction times the passive rate it scales. The
 * Engineering Handbook (Slice 2) multiplies all production, so it
 * scales this rate too, once, like the Founder multiplier. */
export function projectManagerBoostRate(
  employeeCounts,
  openSourceLevels,
  founderMultiplierValue = 1,
  storeRanks = {}
) {
  return (
    projectManagerBoostFraction(employeeCounts, 1, openSourceLevels) *
    baseLocPerSecond(employeeCounts, openSourceLevels) *
    (1 + passiveBonus(openSourceLevels)) *
    founderMultiplierValue *
    handbookProductionMultiplier(storeRanks)
  );
}

/**
 * Commit Specialist click bonus: each Commit Specialist adds +0.2 LOC to
 * a manual click, before the OverReact click boost (see locPerClick).
 * This is the RAW bonus — it is NOT floored here. The floor lives on
 * the final click total in locPerClick (Brandon: floor the final total,
 * not the bonus in isolation), so 10 specialists = +2, 15 = +3, 25 = +5
 * once the total is floored. `csSprintMultiplier` is a live Sprint on
 * Commit Specialists (default 1); a 5x Sprint makes each specialist
 * give +1.0 per click, so floor(1.0 x N) once the total is floored.
 * Commitment Issues (issue #118) doubles the per-specialist bonus
 * each level: +0.4 at L1, +0.8 at L2, +204.8 at L10 (16 levels, capped
 * by Funding Rounds since #170).
 */
export function commitSpecialistClickBonus(
  employeeCounts,
  csSprintMultiplier = 1,
  openSourceLevels = {}
) {
  // A missing, negative, or NaN count reads 0 (issue #160), so a bad
  // count can never turn the whole click into NaN.
  const count = Number(employeeCounts?.commitSpecialist);
  return (
    BALANCE.employees.commitSpecialist.clickBonusPerEmployee *
    (Number.isFinite(count) && count > 0 ? count : 0) *
    csSprintMultiplier *
    doublingMultiplier("commitSpecialist", openSourceLevels)
  );
}

/**
 * The passive LOC/s rate an Employee buff (Sprint/Meeting) scales for one
 * type: that type's contribution to the passive rate. For a normal type
 * it is the type's LOC/s times its count times the Blocker passive bonus
 * times the Project Manager boost (the boost multiplies every type's
 * contribution). For a Project Manager it is the boost contribution
 * itself (the rate the Sprint scales). A Commit Specialist contributes
 * nothing to passive LOC, so a Sprint on them scales nothing here —
 * their bonus lives on clicks, not passive.
 */
export function employeeBuffTypeRate(
  employeeType,
  employeeCounts,
  openSourceLevels,
  founderMultiplierValue = 1,
  storeRanks = {}
) {
  if (employeeType === "projectManager") {
    return projectManagerBoostRate(
      employeeCounts,
      openSourceLevels,
      founderMultiplierValue,
      storeRanks
    );
  }
  if (employeeType === "commitSpecialist") {
    return 0;
  }
  return (
    BALANCE.employees[employeeType].locPerSecond *
    (employeeCounts?.[employeeType] ?? 0) *
    doublingMultiplier(employeeType, openSourceLevels) *
    (1 + passiveBonus(openSourceLevels)) *
    (1 + projectManagerBoostFraction(employeeCounts, 1, openSourceLevels)) *
    founderMultiplierValue *
    handbookProductionMultiplier(storeRanks)
  );
}

/**
 * Total passive LOC/sec, including the Blocker passive bonus and the
 * Project Manager boost: each manager multiplies the whole passive rate
 * by (1 + 0.01 x N). Clicks are NOT boosted by managers, and the Commit
 * Specialist bonus does not touch passive. The FINAL rate is floored to
 * a whole number, the same rule as the click total (Brandon: a tick must
 * never commit a fractional amount): 10 interns with 5 managers is
 * 10 x 1.05 = 10.5, floored to 10. The floor is on the final rate, not
 * on any one component — so it also floors a pre-existing fractional
 * rate from the Blocker bonus (e.g. 3 interns at Blocker L1 is 4.5,
 * floored to 4). The floor eats at most 1 LOC/s, and the Project
 * Manager unlock (TOTAL_LOC >= 50000, 25 employees) means a player
 * reaching managers already has a rate large enough that 1% per
 * manager is worth at least 1 LOC/s.
 *
 * `founderMultiplierValue` is the prestige Founder multiplier
 * (1 + 0.10P, from Lifetime Equity earned): it applies ONCE to
 * employee production here, like the click total in locPerClick.
 * Callers pass buffedLocMultiplier(state) here (issue #132): the
 * Founder multiplier times the achievement LOC buff, one permanent
 * multiplier, so the achievement buff applies everywhere the Founder
 * multiplier does. It
 * does NOT multiply cash payouts, fixed LOC grants, or rewards
 * already calculated from boosted production. `storeRanks` is the
 * permanent store ranks (Slice 2): the Engineering Handbook
 * multiplies all production once (rank 3 is 1.15x); it defaults to
 * unowned, so existing callers are unaffected.
 */
export function locPerSecond(
  employeeCounts,
  openSourceLevels,
  founderMultiplierValue = 1,
  storeRanks = {}
) {
  // The +1e-9 guards the floor against float representation error:
  // 1 + 0.15 is 1.1499999999999999 in binary, so 100 interns at
  // Handbook rank 3 (100 x 1.15) floor to 114 without it. The
  // epsilon is far below any real fractional LOC the game produces
  // (a genuine 10.5 still floors to 10).
  return Math.floor(
    baseLocPerSecond(employeeCounts, openSourceLevels) *
      (1 + passiveBonus(openSourceLevels)) *
      (1 + projectManagerBoostFraction(employeeCounts, 1, openSourceLevels)) *
      founderMultiplierValue *
      handbookProductionMultiplier(storeRanks) +
      1e-9
  );
}

/**
 * Cost in cents of the next hire of a type, when `count` are already owned.
 * Mirrors `getEmployeeCost` in the client: round(base * multiplier ^ count).
 *
 * AGI / Union Drive (issue #157): a live hiring star effect multiplies
 * every hire here, the ONE per-hire cost every price path reads (the
 * single hire, each hire of a bulk buy via employeePurchaseCosts, the
 * card and the reducer). With no effects passed the cost is unchanged.
 */
export function employeeCost(
  employeeType,
  count,
  { activeStarEffects = [], nowMs = Date.now() } = {}
) {
  const config = BALANCE.employees[employeeType];
  return Math.round(
    config.baseCost *
      Math.pow(config.costMultiplier, count) *
      hiringCostMultiplier(activeStarEffects, nowMs)
  );
}

/** Cost in cents of buying `n` hires of a type, starting from `fromCount`. */
export function employeePurchaseCosts(employeeType, fromCount, n, effects = {}) {
  const costs = [];
  for (let i = 0; i < n; i += 1) {
    costs.push(employeeCost(employeeType, fromCount + i, effects));
  }
  return costs;
}

/**
 * LOC cost of a project's NEXT level when it sits at `level` (issue
 * #180): level 0 (a locked or unstarted project) is level 1's cost.
 * The number the card shows, the contribute action charges and the
 * Cheapest sort orders by. Null when the track has no next level
 * (maxed, or a level past what this client defines) or the id is
 * unknown. The Bridge Round (issue #192) is priced by the owned
 * Funding Rounds rank (`storeRanks`; omitted reads Bootstrapped), and
 * has no next level where no bridge is offered.
 */
export function openSourceNextLevelCost(projectId, level, storeRanks = {}) {
  const levels = BALANCE.openSource[projectId]?.levels;
  if (!levels) return null;
  const index = Number.isInteger(level) && level > 0 ? level : 0;
  if (projectId === BRIDGE_ROUND_PROJECT_ID) {
    return index < levels.length ? bridgeRoundPrice(storeRanks) : null;
  }
  return levels[index]?.locCost ?? null;
}

/**
 * Total cost in cents of buying `n` hires of a type starting from
 * `fromCount` owned (issue #181): the sum of employeePurchaseCosts.
 * The ONE number the Hire card shows, the hire action charges, and the
 * Hire tab's Cheapest sort orders by. n = 1 is exactly employeeCost.
 */
export function employeeBulkCost(employeeType, fromCount, n = 1, effects = {}) {
  if (!BALANCE.employees[employeeType]) return 0;
  const count = Number.isInteger(fromCount) && fromCount > 0 ? fromCount : 0;
  const quantity = Number.isInteger(n) && n > 0 ? n : 1;
  return employeePurchaseCosts(employeeType, count, quantity, effects).reduce(
    (sum, cost) => sum + cost,
    0
  );
}

/** Total LOC cost of raising a project from `fromLevel` to `toLevel`. */
export function openSourceLevelCosts(projectId, fromLevel, toLevel) {
  const config = BALANCE.openSource[projectId];
  let total = 0;
  for (let level = fromLevel; level < toLevel; level += 1) {
    total += config.levels[level].locCost;
  }
  return total;
}

/**
 * Whether one unlock condition is met by a save-shaped state.
 * Unknown condition types fail closed (locked), same as the client.
 *
 * New condition types (issue #19) read the freelance completion
 * counts, which the save already tracks per project — no new
 * persistent field was needed for them.
 */
export function conditionMet(condition, state) {
  switch (condition.type) {
    case "TOTAL_LOC":
      return state.totalLinesOfCode >= condition.target;
    case "TOTAL_EMPLOYEE_COUNT":
      return totalEmployees(state.employees) >= condition.target;
    case "SPECIFIC_EMPLOYEE_COUNT":
      return (
        (state.employees[condition.employeeType] ?? 0) >= condition.target
      );
    case "SPECIFIC_PROJECT_COUNT":
      return (
        (state.freelanceProjectsCompleted?.[condition.projectKey] ?? 0) >=
        condition.target
      );
    case "TOTAL_PROJECTS_COUNT":
      return (
        totalProjectsShipped(state.freelanceProjectsCompleted) >=
        condition.target
      );
    // Moonshot (issue #165): an Open Source project's level (flat
    // save-shaped levels), and the lifetime gold stars clicked. A
    // missing level or counter reads 0.
    case "OPEN_SOURCE_LEVEL":
      return (
        safeCount(state.openSourceProjects?.[condition.projectId]) >=
        condition.target
      );
    case "GOLD_STARS_CLICKED":
      return safeCount(state.achievements?.goldStarsClicked) >= condition.target;
    default:
      return false;
  }
}

/**
 * Whether the barn can be bought: every FARM_CONFIG unlock condition
 * is met by a save-shaped state (flat employee counts). A missing
 * count reads 0.
 */
export function farmUnlockConditionsMet(state) {
  return FARM_CONFIG.unlockConditions.every((condition) =>
    conditionMet(condition, {
      totalLinesOfCode: state?.totalLinesOfCode ?? 0,
      employees: state?.employees ?? {},
      freelanceProjectsCompleted: state?.freelanceProjectsCompleted ?? {},
    })
  );
}

/** Total freelance projects shipped, from the flat completion counts. */
export function totalProjectsShipped(freelanceProjectsCompleted) {
  return FREELANCE_PROJECT_KEYS.reduce(
    (sum, key) => sum + (freelanceProjectsCompleted?.[key] ?? 0),
    0
  );
}

/** Whether every unlock condition for an employee type is met. */
export function employeeUnlockConditionsMet(employeeType, state) {
  const config = BALANCE.employees[employeeType];
  if (!config) return false;
  return config.unlockConditions.every((condition) =>
    conditionMet(condition, state)
  );
}

/** Whether every unlock condition for an open-source project is met. */
export function openSourceUnlockConditionsMet(projectId, state) {
  const config = BALANCE.openSource[projectId];
  if (!config) return false;
  return config.unlockConditions.every((condition) =>
    conditionMet(condition, state)
  );
}

/** Whether every unlock condition for a freelance project is met. */
export function freelanceProjectUnlockConditionsMet(projectKey, state) {
  const config = BALANCE.freelanceProjects[projectKey];
  if (!config) return false;
  return config.unlockConditions.every((condition) =>
    conditionMet(condition, state)
  );
}

/**
 * ===== Cosmetics (issue #11) =====
 *
 * Each employee type has one cosmetic slot (its icon) and a list of
 * unlocks, each firing when the owned count reaches its trigger. The
 * visual data (name, icon, color) lives in the client's
 * COSMETICS_CONFIG (gameConfig.js) — it is React, so it cannot live
 * here. What lives here is the registry the server validates against:
 * which cosmetic belongs to which slot, and what triggers it.
 *
 * A cosmetic definition is
 *   { cosmeticId, slot, employeeType, triggerCount }.
 */

/** Every cosmetic slot, one per employee type. */
export const COSMETIC_SLOTS = Object.freeze(
  EMPLOYEE_TYPES.map((type) => BALANCE.employees[type].cosmeticSlot)
);

/** The cosmetic definition for an id, or null when it is not a known cosmetic. */
export function findCosmetic(cosmeticId) {
  for (const type of EMPLOYEE_TYPES) {
    const config = BALANCE.employees[type];
    for (const unlock of config.cosmeticUnlocks) {
      if (unlock.cosmeticId === cosmeticId) {
        return {
          cosmeticId,
          slot: config.cosmeticSlot,
          employeeType: type,
          triggerCount: unlock.triggerCount,
        };
      }
    }
  }
  return null;
}

/** Whether a cosmetic's hire-count trigger is met by a save-shaped state. */
export function cosmeticTriggerMet(cosmeticId, state) {
  const def = findCosmetic(cosmeticId);
  if (!def) return false;
  return (state.employees?.[def.employeeType] ?? 0) >= def.triggerCount;
}

/**
 * Every cosmetic whose trigger is met by a save-shaped state. Used to
 * derive the unlocked list for a save from before cosmetics shipped
 * (see normalizeSaveState): a veteran with 25+ interns gets the
 * Bronze Duck on load, not locked behind a goal they already cleared.
 */
export function deriveUnlockedCosmetics(state) {
  const unlocked = [];
  for (const type of EMPLOYEE_TYPES) {
    for (const unlock of BALANCE.employees[type].cosmeticUnlocks) {
      if (cosmeticTriggerMet(unlock.cosmeticId, state)) {
        unlocked.push(unlock.cosmeticId);
      }
    }
  }
  return unlocked;
}

/**
 * Cosmetics newly unlocked by a hire that moves a type's count from
 * `oldCount` to `newCount`. Threshold-crossing (>=), not exact match:
 * a bulk buy can jump past a trigger (5 -> 30 crosses 25), and the
 * unlock must still fire. The caller filters out cosmetics the
 * player already has.
 */
export function newlyUnlockedCosmetics(employeeType, oldCount, newCount) {
  const config = BALANCE.employees[employeeType];
  if (!config) return [];
  return config.cosmeticUnlocks
    .filter(
      (unlock) =>
        unlock.triggerCount > oldCount && unlock.triggerCount <= newCount
    )
    .map((unlock) => unlock.cosmeticId);
}

/**
 * Whether a cosmetic may be equipped in a slot, given the unlocked
 * list. `cosmeticId` null means unequip (back to the default icon),
 * which is always allowed. Otherwise the cosmetic must exist, belong
 * to that slot, and be unlocked. The client reducer and the save
 * server both use this, so the rule cannot drift between them.
 */
export function canEquipCosmetic(slot, cosmeticId, unlockedCosmetics) {
  if (cosmeticId === null) return true;
  if (typeof cosmeticId !== "string") return false;
  const def = findCosmetic(cosmeticId);
  if (!def) return false;
  if (def.slot !== slot) return false;
  return (unlockedCosmetics ?? []).includes(cosmeticId);
}

/** ===== Achievements (issue #132) =====
 *
 * A second progression layer: tiered achievements, each tier a small
 * PERMANENT boost to all LOC earned (passive LOC/s AND clicks). The
 * same achievement has several tiers (same name, higher thresholds);
 * the tier earned only ever goes up, and achievements survive a sale
 * (the sale spreads the pre-sale state and never touches them).
 *
 * The buff, in ONE place: `achievementLocMultiplier` turns the tiers
 * earned into a multiplier, and `buffedLocMultiplier` combines it with
 * the Founder multiplier. Every system that needs the player's real
 * production reads `buffedLocMultiplier` (the client's click and
 * passive rate, the healthy rate that prices StarBroker stars and
 * SUBTRACTERALL, the Starting Capital quote) or `buffedLocPerSecond`
 * (the buffed passive LOC/s for a save-shaped state). Anything priced
 * off LOC/s must price off these, never off raw base LOC/s, or prices
 * go stale-cheap as the player earns achievements.
 *
 * Buff per tier: tier 1 is +1%, tier 2 +2%, tier 3 +3%, tier 4 and up
 * +5% (ACHIEVEMENT_TIER_BUFF_PERCENTS). A higher tier never gives less
 * than a lower one. Tiers of one achievement stack (earning tier 3
 * means tiers 1, 2 and 3 are all earned: +6%), and all achievements
 * add together into one multiplier, 1 + total% / 100. The multiplier
 * is not compounded per achievement, so the number the Achievements
 * tab shows is exactly the number production uses.
 *
 * Tracking (persisted in the save as `achievements`):
 *   tiers: { [achievementId]: highest tier earned (0 = locked) }
 *   hires: { [employeeType]: lifetime hires of that type }
 *     (counts hires across every company; a sale does not reset it)
 *   clicks: lifetime manual commits (the Commit button)
 *   peakLocPerSecond: highest buffed healthy passive LOC/s reached
 *     (permanent bonuses in, temporary star and SUBTRACTERALL
 *     multipliers out, so a Frenzy cannot cheese the ladder)
 *   llamasBought / llamasSold: { [llamaType]: lifetime count }
 *     (written by the llama economy, issue #129, through
 *     recordLlamaBought / recordLlamaSold; totals are the sums)
 *   starStats (issue #157): lifetime Hype Train / AGI counters, through
 *     recordStarStat: hypeTrains (Hype Trains claimed), hypeShips
 *     (projects shipped while a Hype Train is live, manual and auto),
 *     hypeCashCents (cash those ships paid, boost included), agiTriggers
 *     (AGIs claimed), agiHires (employees hired while AGI is live),
 *     unionDrives (red-star crashes into a Union Drive). Fresh 0s for
 *     old saves, no backfill.
 * Total hires, LOC in a run (totalLinesOfCode - lifetimeLocAtLastSale),
 * lifetime LOC (totalLinesOfCode), and the achievements-unlocked count
 * (achievementTiersEarned) are derived from persisted fields, never
 * stored twice.
 *
 * No migration: a save from before achievements gets a fresh
 * zeroAchievementsState() (every counter 0, every tier locked), and
 * the next action evaluates the tiers from the live state.
 *
 * Copy rules: punny, sarcastic dev satire; no em dashes anywhere.
 */

/** The Hype Train / AGI lifetime counters (issue #157), achievements.starStats. */
export const STAR_STAT_KEYS = Object.freeze([
  "hypeTrains",
  "hypeShips",
  "hypeCashCents",
  "agiTriggers",
  "agiHires",
  "unionDrives",
]);

/** Percent of extra LOC per tier: index 0 is tier 1. Tier 4+ is 5%. */
export const ACHIEVEMENT_TIER_BUFF_PERCENTS = Object.freeze([1, 2, 3, 5]);

/** The LOC buff (percent) one tier of an achievement grants (1-based). */
export function achievementTierBuffPercent(tier) {
  const t = Math.floor(Number(tier) || 0);
  if (t < 1) return 0;
  const percents = ACHIEVEMENT_TIER_BUFF_PERCENTS;
  return percents[Math.min(t, percents.length) - 1];
}

/** Total buff percent of tiers 1..tier of one achievement. */
export function achievementCumulativeBuffPercent(tier) {
  let total = 0;
  for (let t = 1; t <= Math.floor(Number(tier) || 0); t += 1) {
    total += achievementTierBuffPercent(t);
  }
  return total;
}

function countNoun(n, singular, plural = `${singular}s`) {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

/**
 * Every achievement. `metric` names the number the tiers are measured
 * against (see achievementMetricValue); `thresholds` are the tier
 * targets in order (tier 1 first); `describe(n)` is the goal text for
 * a threshold. `hidden` achievements show as ??? until earned. The
 * order here is the display order.
 */
export const ACHIEVEMENTS = Object.freeze(
  [
    {
      id: "helloWorld",
      name: "Hello, World",
      flavor: "Every empire starts with a print statement and a dream.",
      metric: "clicks",
      thresholds: [1],
      describe: () => "Write your very first line of code by hand.",
    },
    {
      id: "carpalTunnelVision",
      name: "Carpal Tunnel Vision",
      flavor:
        "Your mouse has filed a complaint with HR. HR is an Intern, so it went nowhere.",
      metric: "clicks",
      thresholds: [100, 1000, 10000, 100000, 1000000],
      describe: (n) => `Commit by hand ${countNoun(n, "time")}.`,
    },
    {
      id: "internalAffairs",
      name: "Intern-al Affairs",
      flavor:
        "They work for exposure. Mostly exposure to the production database.",
      metric: "hires:intern",
      thresholds: [1, 5, 10, 25, 100],
      describe: (n) => `Hire ${countNoun(n, "Intern")}.`,
    },
    {
      id: "juniorMintCondition",
      name: "Junior Mint Condition",
      flavor:
        "Still has that new-grad smell and a very loud opinion about tabs.",
      metric: "hires:junior",
      thresholds: [1, 5, 10, 25, 100],
      describe: (n) => `Hire ${countNoun(n, "Junior Developer")}.`,
    },
    {
      id: "greyBeardsGreenBuilds",
      name: "Grey Beards, Green Builds",
      flavor:
        "They remember when the cloud was just someone else's computer. It still is.",
      metric: "hires:senior",
      thresholds: [1, 5, 10, 25, 100],
      describe: (n) => `Hire ${countNoun(n, "Senior Developer")}.`,
    },
    {
      id: "ganttStopWontStop",
      name: "Gantt Stop, Won't Stop",
      flavor:
        "Every meeting could have been an email. Every email is now a meeting.",
      metric: "hires:projectManager",
      thresholds: [1, 5, 10, 25, 100],
      describe: (n) => `Hire ${countNoun(n, "Project Manager")}.`,
    },
    {
      id: "commitmentCeremony",
      name: "Commitment Ceremony",
      flavor:
        "They will commit to the repo. They will not commit to a second date.",
      metric: "hires:commitSpecialist",
      thresholds: [1, 5, 10, 25, 100],
      describe: (n) => `Hire ${countNoun(n, "Commit Specialist")}.`,
    },
    {
      id: "releaseTheHounds",
      name: "Release the Hounds",
      flavor:
        "Ships every Friday at 4:59 PM. Has never once read a changelog.",
      metric: "hires:releaseManager",
      thresholds: [1, 5, 10, 25, 100],
      describe: (n) => `Hire ${countNoun(n, "Release Manager")}.`,
    },
    {
      id: "headcountHoarder",
      name: "Headcount Hoarder",
      flavor:
        "HR stopped asking questions. HR was also replaced by an Intern.",
      metric: "totalHires",
      thresholds: [1, 5, 10, 25, 100, 250, 500],
      describe: (n) =>
        `Hire ${countNoun(n, "employee")} in total, across every company you have run.`,
    },
    {
      id: "fullStack",
      name: "Full Stack",
      flavor:
        "Front end, back end, and a Project Manager in the middle end.",
      metric: "distinctRoles",
      thresholds: [EMPLOYEE_TYPES.length],
      describe: () =>
        "Employ at least one of every role at the same time.",
    },
    {
      id: "rateExpectations",
      name: "Rate Expectations",
      flavor:
        "Management has decided this is the only number. Management can count to one.",
      metric: "peakLocPerSecond",
      thresholds: [10, 100, 1000, 10000, 100000, 1000000],
      describe: (n) =>
        `Reach ${formatNumber(n)} LOC per second. Permanent bonuses count; star buffs do not.`,
    },
    {
      id: "runningCode",
      name: "Running Code",
      flavor:
        "Every line is load-bearing. Nobody remembers which ones.",
      metric: "runLoc",
      thresholds: [1000, 10000, 100000, 1000000, 10000000, 100000000],
      describe: (n) =>
        `Write ${formatNumber(n)} lines of code in one company (since your last sale).`,
    },
    {
      id: "legacyCode",
      name: "Legacy Code",
      flavor:
        "Somewhere, a stranger is maintaining all of this. Light a candle for them.",
      metric: "lifetimeLoc",
      thresholds: [
        10000, 100000, 1000000, 10000000, 100000000, 1000000000,
      ],
      describe: (n) =>
        `Write ${formatNumber(n)} lines of code over your whole career, across every sale.`,
    },
    {
      id: "shipShape",
      name: "Ship Shape",
      flavor: "Shipped to production. Production has notes.",
      metric: "projectsShipped",
      thresholds: [1, 10, 100, 1000, 10000],
      describe: (n) =>
        `Ship ${countNoun(n, "freelance project")} in one company.`,
    },
    {
      id: "buyLowSpitHigh",
      name: "Buy Low, Spit High",
      flavor:
        "Every llama comes with a lifetime warranty. Its lifetime, not yours.",
      metric: "llamasBought",
      thresholds: [1, 5, 25, 100],
      describe: (n) => `Buy ${countNoun(n, "llama")}.`,
    },
    {
      id: "noProbLlama",
      name: "No Prob-llama",
      flavor:
        "They were never really yours. They were a subscription with wool.",
      metric: "llamasSold",
      thresholds: [1, 5, 25, 100],
      describe: (n) => `Sell ${countNoun(n, "llama")}.`,
    },
    {
      id: "herdMentality",
      name: "Herd Mentality",
      flavor: "Biodiversity, but make it a dependency tree.",
      metric: "llamaTypes",
      thresholds: [2, 4, 6],
      describe: (n) => `Discover ${countNoun(n, "llama type")}.`,
    },
    {
      id: "exitStrategy",
      name: "Exit Strategy",
      flavor:
        "Founded it, flipped it, founded it again. Serial entrepreneur is a diagnosis.",
      metric: "saleCount",
      thresholds: [1, 3, 10],
      describe: (n) => `Sell the company ${countNoun(n, "time")}.`,
    },
    // Issue #157: Hype Train and AGI, and the Constellation tiers that
    // unlock them. Star stats are lifetime; the Constellation level is
    // this company's (it resets on sale), latched once reached.
    {
      id: "hypeSpringsEternal",
      name: "Hype Springs Eternal",
      flavor:
        "One stranger with a cartoon avatar posted about you, and now you have a waitlist.",
      metric: "hypeTrains",
      thresholds: [1, 5, 25],
      describe: (n) => `Catch ${countNoun(n, "Hype Train")}.`,
    },
    {
      id: "shipWhileItsHot",
      name: "Ship While It's Hot",
      flavor: "Nobody reads the spec during a hype cycle. Least of all the client.",
      metric: "hypeShips",
      thresholds: [10, 100, 1000],
      describe: (n) =>
        `Ship ${countNoun(n, "freelance project")} while a Hype Train is running. Release Manager ships count.`,
    },
    {
      id: "viralLoad",
      name: "Viral Load",
      flavor: "Engagement is up. Nobody can say what was engaged.",
      metric: "hypeCashCents",
      thresholds: [1_000_000, 100_000_000, 10_000_000_000],
      describe: (n) =>
        `Earn ${formatMoney(n)} from projects shipped during Hype Trains.`,
    },
    {
      id: "ticketToHype",
      name: "Ticket to Hype",
      flavor: "The sky has a marketing department now. It is also the sky.",
      metric: "constellationLevel",
      thresholds: [6],
      describe: () => "Raise GitNub Constellation to v6.0.",
    },
    {
      id: "artificialGeneralDiscount",
      name: "Artificial General Discount",
      flavor:
        "The board asked if the AI could replace the board. The AI said yes. The meeting ended early.",
      metric: "agiTriggers",
      thresholds: [1, 5, 25],
      describe: (n) => `Catch ${countNoun(n, "AGI star", "AGI stars")}.`,
    },
    {
      id: "fireSaleHireSale",
      name: "Fire Sale, Hire Sale",
      flavor: "Every hire comes with a model card and a severance package, in that order.",
      metric: "agiHires",
      thresholds: [10, 100, 1000],
      describe: (n) => `Hire ${countNoun(n, "employee")} while AGI has them half off.`,
    },
    {
      id: "collectiveBargainingChip",
      name: "Collective Bargaining Chip",
      flavor: "Turns out the humans read the AGI memo too. They printed it on a banner.",
      metric: "unionDrives",
      thresholds: [1, 3, 10],
      describe: (n) =>
        `Survive ${countNoun(n, "Union Drive")}. Only a red star crash calls one.`,
    },
    {
      id: "singularityAdjacent",
      name: "Singularity Adjacent",
      flavor: "Close enough to the singularity to put it on the pitch deck.",
      metric: "constellationLevel",
      thresholds: [7],
      describe: () => "Raise GitNub Constellation to v7.0.",
    },
    {
      id: "metaData",
      name: "Meta Data",
      flavor:
        "An achievement for collecting achievements. We have become the thing we parody.",
      metric: "achievementTiers",
      thresholds: [5, 10, 25, 50, 75],
      describe: (n) =>
        `Earn ${countNoun(n, "achievement tier")} (this one does not count itself).`,
    },
    {
      id: "inboxZero",
      name: "Inbox Zero",
      flavor: "Productivity influencers hate this one weird trick.",
      metric: "inboxZero",
      thresholds: [1],
      hidden: true,
      describe: () =>
        "Empty your inbox completely after writing 1K lines of code.",
    },
    {
      id: "burnRate",
      name: "Burn Rate",
      flavor: "Runway is a state of mind.",
      metric: "brokeWithPayroll",
      thresholds: [1],
      hidden: true,
      describe: () => "Hit exactly $0 with at least 10 people on payroll.",
    },
    {
      id: "noVacancy",
      name: "No Vacancy",
      flavor:
        "The barn is at capacity. The llamas are already asking about remote work.",
      metric: "fullBarn",
      thresholds: [1],
      hidden: true,
      describe: () => "Fill every stall in the barn with a llama.",
    },
    {
      id: "seeingRed",
      name: "Seeing Red",
      flavor: "The llamas are not angry. They are disappointed, in red.",
      metric: "allStallsRed",
      thresholds: [1],
      hidden: true,
      describe: () => "Set every stall in the barn to Spicy Red.",
    },
    {
      id: "borrowedTime",
      name: "Borrowed Time",
      flavor:
        "Tomorrow's productivity, today. Tomorrow's problems, also today.",
      metric: "dosesTaken",
      thresholds: [1],
      hidden: true,
      // Neutral copy (issue #150): it reads right in both framings,
      // so the Overtime reskin never shows "dose" language here.
      describe: () => "Borrow from tomorrow for the first time.",
    },
  ].map((def) =>
    Object.freeze({
      hidden: false,
      ...def,
      thresholds: Object.freeze([...def.thresholds]),
    })
  )
);

/** Achievement ids, in display order. */
export const ACHIEVEMENT_IDS = Object.freeze(ACHIEVEMENTS.map((a) => a.id));

/** The achievement definition for an id, or null. */
export function findAchievement(id) {
  return ACHIEVEMENTS.find((a) => a.id === id) ?? null;
}

/** Highest tier an achievement has (0 for an unknown id). */
export function achievementMaxTier(id) {
  return findAchievement(id)?.thresholds.length ?? 0;
}

/** The goal text for one tier (1-based) of an achievement. */
export function achievementTierDescription(id, tier) {
  const def = findAchievement(id);
  if (!def) return "";
  const t = Math.min(Math.max(1, Math.floor(tier || 1)), def.thresholds.length);
  return def.describe(def.thresholds[t - 1]);
}

/** Roman numeral for a tier (1-10), for the tier badges. */
export function achievementTierLabel(tier) {
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return numerals[Math.floor(tier) - 1] ?? String(tier);
}

/** A non-negative finite number, or 0 (the NaN guard for counters). */
function safeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A count map over `keys`, every value 0. */
function zeroCountMap(keys) {
  const map = {};
  for (const key of keys) map[key] = 0;
  return map;
}

/** A fresh achievements record: every tier locked, every counter 0. */
export function zeroAchievementsState() {
  return {
    tiers: zeroCountMap(ACHIEVEMENT_IDS),
    hires: zeroCountMap(EMPLOYEE_TYPES),
    clicks: 0,
    peakLocPerSecond: 0,
    goldStarsClicked: 0,
    llamasBought: zeroCountMap(LLAMA_TYPES),
    llamasSold: zeroCountMap(LLAMA_TYPES),
    starStats: zeroCountMap(STAR_STAT_KEYS),
  };
}

/** The keys of an achievements record, for the exact-keys shape check. */
export const ACHIEVEMENTS_STATE_KEYS = Object.freeze([
  "tiers",
  "hires",
  "clicks",
  "peakLocPerSecond",
  "goldStarsClicked",
  "llamasBought",
  "llamasSold",
  "starStats",
]);

/**
 * Fill in what an achievements record is MISSING (undefined), the
 * same rule as normalizeSaveState: a missing record becomes a fresh
 * one, a missing count becomes 0, a missing tier becomes locked. A
 * present-but-wrong value is left alone so the save shape check
 * rejects it. Used by normalizeSaveState (server and load).
 */
export function normalizeAchievementsState(achievements) {
  if (
    achievements === undefined ||
    achievements === null ||
    typeof achievements !== "object" ||
    Array.isArray(achievements)
  ) {
    return achievements === undefined || achievements === null
      ? zeroAchievementsState()
      : achievements;
  }
  const next = { ...achievements };
  const fillMap = (field, keys) => {
    const value = next[field];
    if (value === undefined || value === null) {
      next[field] = zeroCountMap(keys);
      return;
    }
    if (typeof value !== "object" || Array.isArray(value)) return;
    const filled = { ...value };
    for (const key of keys) {
      if (filled[key] === undefined) filled[key] = 0;
    }
    next[field] = filled;
  };
  fillMap("tiers", ACHIEVEMENT_IDS);
  fillMap("hires", EMPLOYEE_TYPES);
  fillMap("llamasBought", LLAMA_TYPES);
  fillMap("llamasSold", LLAMA_TYPES);
  // Issue #157: fresh 0s, no backfill.
  fillMap("starStats", STAR_STAT_KEYS);
  if (next.clicks === undefined) next.clicks = 0;
  if (next.peakLocPerSecond === undefined) next.peakLocPerSecond = 0;
  // Moonshot (issue #165): fresh default, no backfill. Nothing counted
  // gold star clicks before, so every save starts at 0.
  if (next.goldStarsClicked === undefined) next.goldStarsClicked = 0;
  return next;
}

/**
 * Coerce an achievements record into a well-formed one: every known
 * key present, every counter a finite non-negative whole number (NaN,
 * negative, or missing becomes 0), every tier clamped to 0..max,
 * unknown keys dropped. The client runs this before every unlock
 * evaluation and before every save write, so a NaN can never reach a
 * tier check or the server. The peak LOC/s may be fractional (it is
 * a rate), so it is only guarded, not floored.
 */
export function sanitizeAchievementsState(achievements) {
  const source =
    achievements && typeof achievements === "object" && !Array.isArray(achievements)
      ? achievements
      : {};
  const intMap = (value, keys) => {
    const map = {};
    for (const key of keys) map[key] = Math.floor(safeCount(value?.[key]));
    return map;
  };
  const tiers = {};
  for (const id of ACHIEVEMENT_IDS) {
    tiers[id] = Math.min(
      Math.floor(safeCount(source.tiers?.[id])),
      achievementMaxTier(id)
    );
  }
  return {
    tiers,
    hires: intMap(source.hires, EMPLOYEE_TYPES),
    clicks: Math.floor(safeCount(source.clicks)),
    peakLocPerSecond: safeCount(source.peakLocPerSecond),
    goldStarsClicked: Math.floor(safeCount(source.goldStarsClicked)),
    llamasBought: intMap(source.llamasBought, LLAMA_TYPES),
    llamasSold: intMap(source.llamasSold, LLAMA_TYPES),
    starStats: intMap(source.starStats, STAR_STAT_KEYS),
  };
}

/**
 * Shape-check an achievements record (the save payload check). Returns
 * an error string, or null when it is well-formed. Shared, so the
 * server's save validation and the client's pre-write check are the
 * same rule.
 */
export function achievementsStateError(achievements) {
  if (
    achievements === null ||
    typeof achievements !== "object" ||
    Array.isArray(achievements)
  ) {
    return "achievements must be an object";
  }
  const keys = Object.keys(achievements);
  if (
    keys.length !== ACHIEVEMENTS_STATE_KEYS.length ||
    !ACHIEVEMENTS_STATE_KEYS.every((key) => key in achievements)
  ) {
    return "achievements has unknown or missing keys";
  }
  const countMapError = (value, allowedKeys, label) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return `achievements.${label} must be an object`;
    }
    for (const [key, count] of Object.entries(value)) {
      if (!allowedKeys.includes(key)) {
        return `achievements.${label} has an unknown key: ${key}`;
      }
      if (!Number.isInteger(count) || count < 0) {
        return `achievements.${label}.${key} must be a non-negative integer`;
      }
    }
    for (const key of allowedKeys) {
      if (!(key in value)) {
        return `achievements.${label} is missing ${key}`;
      }
    }
    return null;
  };
  const tiersError = countMapError(achievements.tiers, ACHIEVEMENT_IDS, "tiers");
  if (tiersError) return tiersError;
  for (const id of ACHIEVEMENT_IDS) {
    if (achievements.tiers[id] > achievementMaxTier(id)) {
      return `achievements.tiers.${id} exceeds its max tier`;
    }
  }
  const hiresError = countMapError(achievements.hires, EMPLOYEE_TYPES, "hires");
  if (hiresError) return hiresError;
  const boughtError = countMapError(
    achievements.llamasBought,
    LLAMA_TYPES,
    "llamasBought"
  );
  if (boughtError) return boughtError;
  const soldError = countMapError(
    achievements.llamasSold,
    LLAMA_TYPES,
    "llamasSold"
  );
  if (soldError) return soldError;
  const starStatsError = countMapError(
    achievements.starStats,
    STAR_STAT_KEYS,
    "starStats"
  );
  if (starStatsError) return starStatsError;
  if (!Number.isInteger(achievements.clicks) || achievements.clicks < 0) {
    return "achievements.clicks must be a non-negative integer";
  }
  if (
    !Number.isInteger(achievements.goldStarsClicked) ||
    achievements.goldStarsClicked < 0
  ) {
    return "achievements.goldStarsClicked must be a non-negative integer";
  }
  if (
    typeof achievements.peakLocPerSecond !== "number" ||
    !Number.isFinite(achievements.peakLocPerSecond) ||
    achievements.peakLocPerSecond < 0
  ) {
    return "achievements.peakLocPerSecond must be a non-negative number";
  }
  return null;
}

/**
 * The counters that only grow, as [label, prev, next] pairs, for the
 * server's MONOTONIC rule: tiers, lifetime hires, clicks, peak LOC/s,
 * llamas bought and sold. Returns the label of the first counter that
 * went down, or null. Both records must already be well-formed.
 */
export function achievementsDecreased(prev, next) {
  if (!prev || !next) return null;
  for (const id of ACHIEVEMENT_IDS) {
    if ((next.tiers?.[id] ?? 0) < (prev.tiers?.[id] ?? 0)) {
      return `tiers.${id}`;
    }
  }
  for (const type of EMPLOYEE_TYPES) {
    if ((next.hires?.[type] ?? 0) < (prev.hires?.[type] ?? 0)) {
      return `hires.${type}`;
    }
  }
  for (const type of LLAMA_TYPES) {
    if ((next.llamasBought?.[type] ?? 0) < (prev.llamasBought?.[type] ?? 0)) {
      return `llamasBought.${type}`;
    }
    if ((next.llamasSold?.[type] ?? 0) < (prev.llamasSold?.[type] ?? 0)) {
      return `llamasSold.${type}`;
    }
  }
  for (const key of STAR_STAT_KEYS) {
    if ((next.starStats?.[key] ?? 0) < (prev.starStats?.[key] ?? 0)) {
      return `starStats.${key}`;
    }
  }
  if ((next.clicks ?? 0) < (prev.clicks ?? 0)) return "clicks";
  if ((next.peakLocPerSecond ?? 0) < (prev.peakLocPerSecond ?? 0)) {
    return "peakLocPerSecond";
  }
  return null;
}

/** Sum of a per-type count map (total llamas bought, total hires). */
export function sumCounts(map) {
  return Object.values(map ?? {}).reduce(
    (sum, count) => sum + safeCount(count),
    0
  );
}

/** Record `n` hires of a type on an achievements record (pure). */
export function recordHires(achievements, employeeType, n = 1) {
  const base = sanitizeAchievementsState(achievements);
  if (!EMPLOYEE_TYPES.includes(employeeType)) return base;
  return {
    ...base,
    hires: {
      ...base.hires,
      [employeeType]: base.hires[employeeType] + Math.floor(safeCount(n)),
    },
  };
}

/**
 * Record `n` gold star clicks (pure). Moonshot (issue #165) unlocks at
 * 25 lifetime gold star clicks. Natural and bought gold stars count;
 * red stars and Shooting Stars chain clicks do not.
 */
export function recordGoldStarClicks(achievements, n = 1) {
  const base = sanitizeAchievementsState(achievements);
  return {
    ...base,
    goldStarsClicked: base.goldStarsClicked + Math.floor(safeCount(n)),
  };
}

/**
 * Add `n` to one Hype Train / AGI counter (issue #157, pure). Unknown
 * keys and junk amounts change nothing (a NaN never reaches a counter).
 */
export function recordStarStat(achievements, key, n = 1) {
  const base = sanitizeAchievementsState(achievements);
  if (!STAR_STAT_KEYS.includes(key)) return base;
  const amount = Math.floor(safeCount(n));
  if (amount === 0) return base;
  return {
    ...base,
    starStats: { ...base.starStats, [key]: base.starStats[key] + amount },
  };
}

/**
 * The achievement counters one star claim moves (issue #157): a golden
 * Hype Train counts toward hypeTrains, a golden AGI toward agiTriggers,
 * and a red-star crash into a Union Drive toward unionDrives. Every
 * other claim returns the record unchanged.
 */
export function recordStarClaimStats(achievements, claim) {
  if (!claim) return achievements;
  if (claim.effect === "hype" && claim.good) {
    return recordStarStat(achievements, "hypeTrains", 1);
  }
  if (claim.effect === "hiring") {
    return recordStarStat(achievements, claim.good ? "agiTriggers" : "unionDrives", 1);
  }
  return achievements;
}

/** Record `n` manual commits on an achievements record (pure). */
export function recordClicks(achievements, n = 1) {
  const base = sanitizeAchievementsState(achievements);
  return { ...base, clicks: base.clicks + Math.floor(safeCount(n)) };
}

/**
 * Record `n` llamas of a type bought (pure). The llama economy (issue
 * #129) calls this on every successful buy; the bought total is
 * sumCounts(achievements.llamasBought).
 */
export function recordLlamaBought(achievements, llamaType, n = 1) {
  const base = sanitizeAchievementsState(achievements);
  if (!LLAMA_TYPES.includes(llamaType)) return base;
  return {
    ...base,
    llamasBought: {
      ...base.llamasBought,
      [llamaType]: base.llamasBought[llamaType] + Math.floor(safeCount(n)),
    },
  };
}

/**
 * Record `n` llamas of a type sold (pure). The llama economy (issue
 * #129) calls this on every successful sale; the sold total is
 * sumCounts(achievements.llamasSold).
 */
export function recordLlamaSold(achievements, llamaType, n = 1) {
  const base = sanitizeAchievementsState(achievements);
  if (!LLAMA_TYPES.includes(llamaType)) return base;
  return {
    ...base,
    llamasSold: {
      ...base.llamasSold,
      [llamaType]: base.llamasSold[llamaType] + Math.floor(safeCount(n)),
    },
  };
}

/**
 * Raise the recorded peak LOC/s to `locPerSecondValue` if it is
 * higher (pure). The caller passes the BUFFED healthy passive rate
 * (buffedLocPerSecond), so star buffs never count toward the ladder.
 */
export function recordPeakLocPerSecond(achievements, locPerSecondValue) {
  const base = sanitizeAchievementsState(achievements);
  const rate = safeCount(locPerSecondValue);
  if (rate <= base.peakLocPerSecond) return base;
  return { ...base, peakLocPerSecond: rate };
}

/** How many achievement tiers are earned in total (the unlocked count). */
export function achievementTiersEarned(achievements, { excludeId = null } = {}) {
  let total = 0;
  for (const id of ACHIEVEMENT_IDS) {
    if (id === excludeId) continue;
    total += Math.min(
      Math.floor(safeCount(achievements?.tiers?.[id])),
      achievementMaxTier(id)
    );
  }
  return total;
}

/** Total LOC buff percent from every tier earned (e.g. 12 for +12%). */
export function achievementBuffPercent(achievements) {
  let total = 0;
  for (const id of ACHIEVEMENT_IDS) {
    const tier = Math.min(
      Math.floor(safeCount(achievements?.tiers?.[id])),
      achievementMaxTier(id)
    );
    total += achievementCumulativeBuffPercent(tier);
  }
  return total;
}

/** The highest buff percent the achievements can ever grant. */
export function maxAchievementBuffPercent() {
  return ACHIEVEMENTS.reduce(
    (sum, def) => sum + achievementCumulativeBuffPercent(def.thresholds.length),
    0
  );
}

/**
 * THE achievement LOC buff: the permanent multiplier every tier earned
 * adds to all LOC (passive and clicks). 1 with nothing earned.
 */
export function achievementLocMultiplier(achievements) {
  return 1 + achievementBuffPercent(achievements) / 100;
}

/**
 * The permanent LOC multiplier a state's production runs at: the
 * Founder multiplier (Lifetime Equity earned) times the achievement
 * buff. This is the ONE helper production and pricing read; it takes
 * any state with `lifetimeEquityEarned` and `achievements`, so it
 * works on the client's reducer state and on a save-shaped state.
 */
export function buffedLocMultiplier(state) {
  return (
    founderMultiplier(state?.lifetimeEquityEarned ?? 0) *
    achievementLocMultiplier(state?.achievements)
  );
}

/**
 * The buffed healthy passive LOC/s for a SAVE-SHAPED state (flat
 * employee counts and open-source levels): employees, open-source
 * bonuses, the Engineering Handbook, the Founder multiplier and the
 * achievement buff all in; temporary star and SUBTRACTERALL
 * multipliers out. Price anything LOC/s-scaled off this (P in the
 * llama economy), never off raw baseLocPerSecond.
 */
export function buffedLocPerSecond(state) {
  return locPerSecond(
    state?.employees ?? {},
    state?.openSourceProjects ?? {},
    buffedLocMultiplier(state),
    state?.permanentStoreRanks ?? {}
  );
}

/**
 * The live number an achievement metric reads. `ctx` is save-shaped
 * (flat counts): { achievements, totalLinesOfCode,
 * lifetimeLocAtLastSale, employees, freelanceProjectsCompleted, money,
 * saleCount, farm, emailCount, subtracterall, constellationLevel }. Every value is guarded
 * against NaN and missing fields (a missing count reads 0).
 */
export function achievementMetricValue(metric, ctx = {}) {
  const achievements = ctx.achievements ?? {};
  if (metric.startsWith("hires:")) {
    return safeCount(achievements.hires?.[metric.slice("hires:".length)]);
  }
  switch (metric) {
    case "clicks":
      return safeCount(achievements.clicks);
    case "totalHires":
      return sumCounts(achievements.hires);
    case "distinctRoles":
      return EMPLOYEE_TYPES.filter((type) => safeCount(ctx.employees?.[type]) > 0)
        .length;
    case "peakLocPerSecond":
      return safeCount(achievements.peakLocPerSecond);
    case "runLoc":
      return Math.max(
        0,
        safeCount(ctx.totalLinesOfCode) - safeCount(ctx.lifetimeLocAtLastSale)
      );
    case "lifetimeLoc":
      return safeCount(ctx.totalLinesOfCode);
    case "projectsShipped":
      return sumCounts(ctx.freelanceProjectsCompleted);
    case "llamasBought":
      return sumCounts(achievements.llamasBought);
    case "llamasSold":
      return sumCounts(achievements.llamasSold);
    case "llamaTypes":
      return Array.isArray(ctx.farm?.unlockedTypes)
        ? ctx.farm.unlockedTypes.length
        : 0;
    case "saleCount":
      return safeCount(ctx.saleCount);
    // Issue #157.
    case "hypeTrains":
    case "hypeShips":
    case "hypeCashCents":
    case "agiTriggers":
    case "agiHires":
    case "unionDrives":
      return safeCount(achievements.starStats?.[metric]);
    case "constellationLevel":
      return safeCount(ctx.constellationLevel);
    case "achievementTiers":
      return achievementTiersEarned(achievements, { excludeId: "metaData" });
    case "inboxZero":
      return safeCount(ctx.emailCount) === 0 &&
        safeCount(ctx.totalLinesOfCode) >= 1000
        ? 1
        : 0;
    case "brokeWithPayroll":
      return safeCount(ctx.money) === 0 && totalEmployees(ctx.employees ?? {}) >= 10
        ? 1
        : 0;
    case "fullBarn": {
      const stalls = ctx.farm?.owned ? (ctx.farm.stalls ?? []) : [];
      return stalls.length === FARM_CONFIG.stallCount &&
        stalls.every((stall) => stall?.llama)
        ? 1
        : 0;
    }
    case "allStallsRed": {
      const stalls = ctx.farm?.owned ? (ctx.farm.stalls ?? []) : [];
      return stalls.length === FARM_CONFIG.stallCount &&
        stalls.every((stall) => stall?.lighting === "red")
        ? 1
        : 0;
    }
    case "dosesTaken": {
      const sub = ctx.subtracterall ?? {};
      return safeCount(sub.uses) > 0 ||
        (sub.phase !== undefined && sub.phase !== "ready")
        ? 1
        : 0;
    }
    default:
      return 0;
  }
}

/** The highest tier `value` reaches on an achievement (0 = none). */
function tierForValue(def, value) {
  let tier = 0;
  for (const threshold of def.thresholds) {
    if (value >= threshold) tier += 1;
    else break;
  }
  return tier;
}

/**
 * Evaluate every achievement against the live state and latch any new
 * tiers. Tiers only go up. Pure: returns `{ achievements, unlocked }`
 * where `unlocked` lists each newly earned { id, tier } (one entry per
 * tier, lowest first), and `achievements` is the same object when
 * nothing changed. The meta achievement is evaluated last, against the
 * tiers just earned, so earning your 5th tier and Meta Data I can land
 * in the same action.
 */
export function evaluateAchievements(achievements, ctx = {}) {
  const base = sanitizeAchievementsState(achievements);
  const tiers = { ...base.tiers };
  const unlocked = [];
  const latch = (def, current) => {
    const reached = tierForValue(def, current);
    const had = tiers[def.id] ?? 0;
    if (reached > had) {
      for (let t = had + 1; t <= reached; t += 1) {
        unlocked.push({ id: def.id, tier: t });
      }
      tiers[def.id] = reached;
    }
  };
  for (const def of ACHIEVEMENTS) {
    if (def.metric === "achievementTiers") continue;
    latch(def, achievementMetricValue(def.metric, { ...ctx, achievements: base }));
  }
  for (const def of ACHIEVEMENTS) {
    if (def.metric !== "achievementTiers") continue;
    latch(
      def,
      achievementMetricValue(def.metric, {
        ...ctx,
        achievements: { ...base, tiers },
      })
    );
  }
  if (unlocked.length === 0) {
    return { achievements: base, unlocked };
  }
  return { achievements: { ...base, tiers }, unlocked };
}

/**
 * Progress toward the next tier of one achievement, for the view:
 * { tier, maxTier, current, nextThreshold, fraction, complete }.
 * `fraction` is 0..1 toward the next tier (1 when every tier is done).
 */
export function achievementProgress(id, ctx = {}) {
  const def = findAchievement(id);
  if (!def) return null;
  const tier = Math.min(
    Math.floor(safeCount(ctx.achievements?.tiers?.[id])),
    def.thresholds.length
  );
  const current = achievementMetricValue(def.metric, ctx);
  const complete = tier >= def.thresholds.length;
  const nextThreshold = complete ? null : def.thresholds[tier];
  return {
    tier,
    maxTier: def.thresholds.length,
    current,
    nextThreshold,
    fraction: complete
      ? 1
      : Math.max(0, Math.min(1, nextThreshold > 0 ? current / nextThreshold : 0)),
    complete,
  };
}

/**
 * The closing paragraph of every achievement email. The detail view
 * renders it under the linked trophy list (issue #173), and the body
 * text ends with it, so both say the same thing.
 */
export const ACHIEVEMENT_EMAIL_OUTRO =
  `Every tier is a permanent boost to all LOC, clicks and passive ` +
  `alike, and it survives selling the company. Check the Trophies ` +
  `tab for what is next. Nobody asked for a trophy case. You got ` +
  `one anyway.`;

/**
 * The trophies one achievement email covers, one entry per trophy
 * (issue #173). `trophies` is the email's stored list of earned tiers
 * ([{ id, tier }], evaluateAchievements' shape); tiers of the same
 * trophy group into one entry. Every name, goal and flavor line comes
 * from the ACHIEVEMENTS definitions, never from the email, so a
 * stored mail cannot drift from the Trophies tab. Unknown ids and bad
 * tiers are dropped (sanitizeEmailTrophies). Each entry:
 *   { id, name, tiers, tierText, goal, flavor, buffPercent, target }
 * where `tierText` is "" for a one-tier trophy, else " I" / " I, II",
 * `goal` is the highest tier's goal, `buffPercent` sums the tiers,
 * and `target` links to the trophy on the Achievements tab.
 */
export function achievementEmailEntries(trophies) {
  const clean = sanitizeEmailTrophies(trophies) ?? [];
  const byId = new Map();
  for (const { id, tier } of clean) {
    const tiers = byId.get(id) ?? [];
    if (!tiers.includes(tier)) tiers.push(tier);
    byId.set(id, tiers);
  }
  const entries = [];
  for (const [id, tiers] of byId) {
    const def = findAchievement(id);
    tiers.sort((a, b) => a - b);
    const multiTier = def.thresholds.length > 1;
    entries.push({
      id,
      name: def.name,
      tiers,
      tierText: multiTier
        ? ` ${tiers.map((t) => achievementTierLabel(t)).join(", ")}`
        : "",
      goal: achievementTierDescription(id, tiers[tiers.length - 1]),
      flavor: def.flavor,
      buffPercent: tiers.reduce(
        (sum, t) => sum + achievementTierBuffPercent(t),
        0
      ),
      target: emailTarget("achievements", id),
    });
  }
  return entries;
}

/**
 * The inbox mail for newly earned achievement tiers (one mail per
 * action, however many tiers landed, so a big moment never floods the
 * 25-mail inbox). `unlocked` is evaluateAchievements' list.
 *
 * Issue #173: the mail lists each trophy on its own line with its
 * name and its flavor line (from the definitions), and carries the
 * earned tiers as `trophies` so the inbox can link every entry to
 * its card on the Achievements tab. `target` points at the first
 * trophy. The body is the plain-text copy (list preview, old
 * clients); it stays under EMAIL_CONFIG.maxBodyLength by dropping
 * the flavor lines, then the tail of the list, on a huge batch. The
 * linked list in the detail view always shows every trophy.
 */
export function buildAchievementEmail({ unlocked }) {
  const trophies = sanitizeEmailTrophies(unlocked) ?? [];
  const entries = achievementEmailEntries(trophies);
  const tierCount = trophies.length;
  const first = entries[0] ?? null;
  const subject =
    tierCount === 1
      ? `Achievement unlocked: ${first?.name ?? "Something"}`
      : `${tierCount} achievements unlocked`;
  const header = (entry) =>
    `${entry.name}${entry.tierText} (+${entry.buffPercent}% LOC)`;
  const outro = `\n\n${ACHIEVEMENT_EMAIL_OUTRO}`;
  const fits = (lines) =>
    lines.join("\n").length + outro.length <= EMAIL_CONFIG.maxBodyLength;
  let lines = entries.map((entry) => `${header(entry)}: ${entry.flavor}`);
  if (!fits(lines)) lines = entries.map(header);
  if (!fits(lines)) {
    // Keep as many headers as fit, then say how many more there are.
    for (let keep = entries.length - 1; keep >= 0; keep -= 1) {
      const more = entries.length - keep;
      lines = [
        ...entries.slice(0, keep).map(header),
        `...and ${more} more in the Trophies tab.`,
      ];
      if (fits(lines)) break;
    }
  }
  const mail = {
    sender: "The Trophy Case",
    subject,
    body: `${lines.join("\n")}${outro}`,
  };
  if (trophies.length > 0) {
    mail.target = first.target;
    mail.trophies = trophies;
  }
  return mail;
}

/** The save state a brand-new player starts from. Unlocks derive from the configs. */
export function initialSaveState() {
  const employees = {};
  const unlockedEmployees = {};
  for (const type of EMPLOYEE_TYPES) {
    employees[type] = 0;
    unlockedEmployees[type] =
      BALANCE.employees[type].unlockConditions.length === 0;
  }
  const unlockedOpenSourceProjects = {};
  const openSourceProjects = {};
  for (const projectId of OPEN_SOURCE_IDS) {
    openSourceProjects[projectId] = 0;
    unlockedOpenSourceProjects[projectId] =
      BALANCE.openSource[projectId].unlockConditions.length === 0;
  }
  const unlockedFreelanceProjects = {};
  for (const projectKey of FREELANCE_PROJECT_KEYS) {
    unlockedFreelanceProjects[projectKey] =
      BALANCE.freelanceProjects[projectKey].unlockConditions.length === 0;
  }
  // Shipped counts derive from the keys (same pattern as the
  // employees above): a hardcoded list here went stale when the
  // big projects shipped, and a fresh server-minted save would have
  // lacked the new keys.
  const freelanceProjectsCompleted = {};
  for (const projectKey of FREELANCE_PROJECT_KEYS) {
    freelanceProjectsCompleted[projectKey] = 0;
  }
  // Release Manager assignments (which project each manager is
  // assigned to, as a count per project) and the cumulative auto-ship
  // counts (how many of each project the managers have shipped).
  // Assignments sum to at most the owned Release Manager count; the
  // rest are unassigned and do nothing. autoShipsCompleted is the
  // cumulative counter the save engine derives actions.autoShips
  // from (new - baseline), so the server can rate-cap auto-ships.
  const releaseManagerAssignments = {};
  const autoShipsCompleted = {};
  for (const projectKey of FREELANCE_PROJECT_KEYS) {
    releaseManagerAssignments[projectKey] = 0;
    autoShipsCompleted[projectKey] = 0;
  }
  return {
    linesOfCode: BALANCE.mechanics.startingLoc,
    totalLinesOfCode: 0,
    money: BALANCE.mechanics.startingMoney,
    employees,
    aiAssistants: { noPilot: 0 },
    freelanceProjectsCompleted,
    releaseManagerAssignments,
    autoShipsCompleted,
    openSourceProjects,
    unlockedEmployees,
    unlockedOpenSourceProjects,
    unlockedFreelanceProjects,
    // Prestige (Sell the Company, Slice 1). Lifetime LOC is
    // totalLinesOfCode (never decreases); these are the Equity books.
    // lifetimeEquityEarned (P) drives the Founder multiplier and
    // only grows on sale; equitySpent is permanent-store spending
    // (Slice 2 — always 0 in Slice 1); saleCount is cosmetic /
    // analytics only; lifetimeLocAtLastSale makes Company LOC earned
    // (total minus this) derivable without a second counter;
    // lastSaleId is the idempotency key for the sale endpoint, so a
    // retried sale grants its reward once (criterion 5).
    lifetimeEquityEarned: 0,
    equitySpent: 0,
    saleCount: 0,
    lifetimeLocAtLastSale: 0,
    lastSaleId: null,
    // Permanent store (Slice 2). Ranks persist across sales (the
    // store is permanent, only the company resets); the intermission
    // is null outside a sale; no projects are favorited yet.
    permanentStoreRanks: zeroStoreRanks(),
    prestigeIntermission: null,
    favoriteOpenSourceProjects: [],
    // SUBTRACTERALL (issue #150): phase, remaining credited seconds,
    // per-company use count, and the active use. Overtime reskin: a
    // text/framing layer over SUBTRACTERALL, never a separate
    // mechanic. It persists across sales.
    subtracterall: zeroSubtracterallState(),
    // Night Shift (issue #149): the purchased offline-production level,
    // 0..5. Company-local: a sale resets it (the Night Shift Contract
    // store rank grants level 1 at the next company start).
    nightShiftLevel: 0,
    overtimeReskin: false,
    // Timed golden-star buffs active right now. Each entry is
    // { effect, multiplier, expiresAtMs, employeeType }. Short-lived
    // (10-60s); expired entries are dropped by the client tick.
    activeStarEffects: [],
    // In-game inbox (issue #31). Each entry is
    // { id, triggerKey, sender, subject, body, createdAtMs, read }.
    // Capped at EMAIL_CONFIG.maxInboxEmails; the client trims the
    // oldest when a new one arrives past the cap.
    emails: [],
    // Cosmetics (issue #11). unlockedCosmetics is the list of
    // cosmeticIds the player has earned (hire-count triggers); it
    // only grows. equippedCosmetics maps a cosmetic slot to the
    // equipped cosmeticId — the player can switch freely between
    // unlocked cosmetics, or unequip back to the default icon.
    unlockedCosmetics: [],
    equippedCosmetics: {},
    // Llama farm (issue #79). A save from before the farm shipped has
    // no farm field at all — normalizeSaveState backfills it to the
    // empty (unbought) farm, so old saves keep validating.
    farm: emptyFarmState(),
    // Golden-star schedule (client-rolled now): the wall-clock time
    // the next natural star is due (null = no star scheduled, e.g.
    // Constellation level 0), and the wall-clock time the last
    // StarBroker star was bought (null = never bought; the buy
    // cooldown runs from it). The client rolls and persists them;
    // the server only bounds the shape.
    nextStarAtMs: null,
    lastStarBuyAtMs: null,
    // Achievements (issue #132): every tier locked, every counter 0.
    // Survives a sale (applyPrestigeSale spreads the pre-sale state);
    // only a progress reset starts it over.
    achievements: zeroAchievementsState(),
  };
}

/**
 * Fill in the fields a save state predates (a save stored before
 * Constellation, project unlocks, or cosmetics shipped). Returns a
 * shallow copy with the new fields defaulted; states that already
 * have them are unchanged. Only the NEW fields are defaulted — a
 * missing old field is still a shape error, so this never masks a
 * malformed save.
 */
export function normalizeSaveState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return state;
  }
  const next = { ...state };
  if (
    next.openSourceProjects &&
    typeof next.openSourceProjects === "object" &&
    !Array.isArray(next.openSourceProjects) &&
    next.openSourceProjects.constellation === undefined
  ) {
    next.openSourceProjects = {
      ...next.openSourceProjects,
      constellation: 0,
    };
  }
  if (
    next.openSourceProjects &&
    typeof next.openSourceProjects === "object" &&
    !Array.isArray(next.openSourceProjects) &&
    next.openSourceProjects.starBroker === undefined
  ) {
    // StarBroker shipped after Constellation: a save from before it
    // has no starBroker key. Default it to 0, same as constellation.
    next.openSourceProjects = {
      ...next.openSourceProjects,
      starBroker: 0,
    };
  }
  if (
    next.openSourceProjects &&
    typeof next.openSourceProjects === "object" &&
    !Array.isArray(next.openSourceProjects)
  ) {
    // The doubling upgrades (issue #118) shipped after StarBroker: a
    // save from before them has none of the six keys. Default each
    // missing one to 0, same as constellation and starBroker — without
    // this, the exact-keys shape check rejects the old save.
    let changed = false;
    const filled = { ...next.openSourceProjects };
    for (const projectId of LATER_OPEN_SOURCE_IDS) {
      if (filled[projectId] === undefined) {
        filled[projectId] = 0;
        changed = true;
      }
    }
    if (changed) next.openSourceProjects = filled;
  }
  if (
    next.unlockedOpenSourceProjects &&
    typeof next.unlockedOpenSourceProjects === "object" &&
    !Array.isArray(next.unlockedOpenSourceProjects)
  ) {
    // Constellation gained an unlock condition (TOTAL_LOC >= 500,
    // star fix slice) after shipping unlocked. Saves from before the
    // condition carry latch=true with lifetime LOC below the
    // threshold, so the latch is re-derived from the save's own
    // lifetime LOC here — a veteran at/above 500 LOC keeps the unlock,
    // a veteran below it gets it locked (with progress shown) instead
    // of having saves rejected by the UNLOCK rule. A veteran who
    // already bought Constellation levels is safe: L1 costs 1000 LOC,
    // so their lifetime LOC is necessarily at/above the threshold.
    // Both the stored and the incoming state are normalized the same
    // way, so this never flips a latch back for the MONOTONIC rule.
    // StarBroker is re-derived the same way: it shipped WITH its
    // TOTAL_LOC >= 5000 condition, so no save can carry a stale
    // latch=true for it — but re-deriving keeps the two projects
    // consistent, and a save that predates StarBroker gets its latch
    // from its own lifetime LOC instead of defaulting to locked
    // behind a goal it already cleared.
    next.unlockedOpenSourceProjects = {
      ...next.unlockedOpenSourceProjects,
      constellation: openSourceUnlockConditionsMet("constellation", next),
      starBroker: openSourceUnlockConditionsMet("starBroker", next),
    };
    // The doubling upgrades (issue #118): a save that predates them
    // has no latch for them — derive each MISSING latch from the
    // save's own employee counts (own 10 of that type) instead of
    // defaulting to locked behind a goal it already cleared. Existing
    // latches are trusted, not re-derived: these projects ship with
    // their conditions, so no stale latch can exist (unlike
    // Constellation, which gained its condition after shipping
    // unlocked), and only filling missing ones keeps normalize
    // idempotent for current saves.
    for (const projectId of LATER_OPEN_SOURCE_IDS) {
      if (next.unlockedOpenSourceProjects[projectId] === undefined) {
        next.unlockedOpenSourceProjects[projectId] =
          openSourceUnlockConditionsMet(projectId, next);
      }
    }
  }
  if (!Array.isArray(next.activeStarEffects)) {
    next.activeStarEffects = [];
  }
  if (!Array.isArray(next.emails)) {
    next.emails = [];
  }
  if (
    next.unlockedFreelanceProjects === undefined ||
    typeof next.unlockedFreelanceProjects !== "object" ||
    Array.isArray(next.unlockedFreelanceProjects)
  ) {
    // A save from before project unlocks shipped (issue #19) has no
    // freelance latch at all. Derive it from the save's own shipped
    // counts, so a player who already shipped 50 To Do List Apps gets
    // the Hobby Website unlocked on load instead of locked behind a
    // goal they already cleared.
    const unlocked = {};
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      unlocked[projectKey] = freelanceProjectUnlockConditionsMet(
        projectKey,
        next
      );
    }
    next.unlockedFreelanceProjects = unlocked;
  }
  if (
    next.freelanceProjectsCompleted &&
    typeof next.freelanceProjectsCompleted === "object" &&
    !Array.isArray(next.freelanceProjectsCompleted)
  ) {
    // The four big projects shipped after the first three: a save
    // from before them lacks those keys. Default the missing counts
    // to 0 instead of failing the shape check, same pattern as the
    // employee migration below.
    let changed = false;
    const completed = { ...next.freelanceProjectsCompleted };
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      if (completed[projectKey] === undefined) {
        completed[projectKey] = 0;
        changed = true;
      }
    }
    if (changed) next.freelanceProjectsCompleted = completed;
  }
  if (
    next.releaseManagerAssignments === undefined ||
    next.releaseManagerAssignments === null ||
    typeof next.releaseManagerAssignments !== "object" ||
    Array.isArray(next.releaseManagerAssignments)
  ) {
    // A save from before the Release Manager shipped has no
    // assignments at all. Default them to all-zero (no manager
    // assigned) instead of failing the shape check, same pattern as
    // the freelance migration above.
    const assignments = {};
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      assignments[projectKey] = 0;
    }
    next.releaseManagerAssignments = assignments;
  } else {
    // The assignments exist: only fill in keys that are genuinely
    // missing (a save from before the big projects lacks their keys).
    // A present-but-wrong value is left alone so the shape check
    // rejects it.
    let changed = false;
    const assignments = { ...next.releaseManagerAssignments };
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      if (assignments[projectKey] === undefined) {
        assignments[projectKey] = 0;
        changed = true;
      }
    }
    if (changed) next.releaseManagerAssignments = assignments;
  }
  if (
    next.autoShipsCompleted === undefined ||
    next.autoShipsCompleted === null ||
    typeof next.autoShipsCompleted !== "object" ||
    Array.isArray(next.autoShipsCompleted)
  ) {
    // Same migration for the cumulative auto-ship counts: a save
    // from before the Release Manager shipped has none. Default them
    // to all-zero — no manager has auto-shipped anything yet.
    const autoShips = {};
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      autoShips[projectKey] = 0;
    }
    next.autoShipsCompleted = autoShips;
  } else {
    let changed = false;
    const autoShips = { ...next.autoShipsCompleted };
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      if (autoShips[projectKey] === undefined) {
        autoShips[projectKey] = 0;
        changed = true;
      }
    }
    if (changed) next.autoShipsCompleted = autoShips;
  }
  if (
    next.unlockedFreelanceProjects &&
    typeof next.unlockedFreelanceProjects === "object" &&
    !Array.isArray(next.unlockedFreelanceProjects)
  ) {
    // Same migration for the unlock latch: a save from before the big
    // projects lacks their latch keys. Derive each missing latch from
    // the save's own shipped counts, so a veteran who already shipped
    // 25 Blockchain Projects gets the AI-Powered Dashboard unlocked
    // on load instead of locked behind a goal they already cleared.
    let changed = false;
    const unlocked = { ...next.unlockedFreelanceProjects };
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      if (unlocked[projectKey] === undefined) {
        unlocked[projectKey] = freelanceProjectUnlockConditionsMet(
          projectKey,
          next
        );
        changed = true;
      }
    }
    if (changed) next.unlockedFreelanceProjects = unlocked;
  }
  if (!Array.isArray(next.unlockedCosmetics)) {
    // A save from before cosmetics shipped (issue #11) has no
    // cosmetic fields at all. Derive the unlocked list from the
    // save's own employee counts, so a player who already hired 25
    // interns gets the Bronze Duck on load instead of locked behind
    // a goal they already cleared. Same pattern as the freelance
    // latch (issue #19).
    next.unlockedCosmetics = deriveUnlockedCosmetics(next);
  }
  if (
    next.equippedCosmetics === undefined ||
    typeof next.equippedCosmetics !== "object" ||
    Array.isArray(next.equippedCosmetics)
  ) {
    next.equippedCosmetics = {};
  }
  if (
    next.employees &&
    typeof next.employees === "object" &&
    !Array.isArray(next.employees)
  ) {
    // Project Manager and Commit Specialist shipped after the first
    // three employees: a save from before them lacks those keys.
    // Default the missing counts to 0 instead of failing the shape
    // check, same pattern as the open-source migration above.
    let changed = false;
    const employees = { ...next.employees };
    for (const type of EMPLOYEE_TYPES) {
      if (employees[type] === undefined) {
        employees[type] = 0;
        changed = true;
      }
    }
    if (changed) next.employees = employees;
  }
  if (
    next.unlockedEmployees &&
    typeof next.unlockedEmployees === "object" &&
    !Array.isArray(next.unlockedEmployees)
  ) {
    // Same migration for the unlock latch: a save from before the new
    // types lacks their latch keys. Derive each missing latch from the
    // save's own state, so a veteran who already meets a new type's
    // condition gets it unlocked on load instead of locked behind a
    // goal they already cleared.
    let changed = false;
    const unlocked = { ...next.unlockedEmployees };
    for (const type of EMPLOYEE_TYPES) {
      if (unlocked[type] === undefined) {
        unlocked[type] = employeeUnlockConditionsMet(type, next);
        changed = true;
      }
    }
    if (changed) next.unlockedEmployees = unlocked;
  }
  if (
    next.farm === undefined ||
    next.farm === null ||
    typeof next.farm !== "object" ||
    Array.isArray(next.farm)
  ) {
    // A save from before the llama farm shipped (issue #79) has no
    // farm field at all. Backfill it to the empty (unbought) farm so
    // the save keeps validating — the player just has not bought the
    // farm yet, which is the same as a fresh save.
    next.farm = emptyFarmState();
  } else {
    // The farm exists: only fill in fields that are genuinely missing
    // (undefined). A present-but-wrong value is left alone so the
    // shape check rejects it — the backfill must never silently
    // repair a tampered save. In particular, an unbought farm that
    // claims llamas is NOT reset to empty here; the shape check
    // rejects it, which is the correct outcome for a save that
    // claims llamas without owning the farm.
    const farm = { ...next.farm };
    if (farm.owned === undefined) farm.owned = false;
    if (!Array.isArray(farm.stalls)) {
      farm.stalls = emptyFarmState().stalls;
    } else {
      farm.stalls = farm.stalls.map((stall) => {
        if (!stall || typeof stall !== "object" || Array.isArray(stall)) {
          return { llama: null, lighting: "warm" };
        }
        return {
          llama: stall.llama === undefined ? null : stall.llama,
          lighting: stall.lighting === undefined ? "warm" : stall.lighting,
        };
      });
    }
    if (!Array.isArray(farm.unlockedTypes)) {
      // Derive the unlocked list from the llamas actually in the
      // stalls, so a farm that predates the unlocked-types field
      // keeps the types it already bred instead of losing them.
      const presentTypes = farm.stalls
        .map((stall) => stall.llama)
        .filter(Boolean);
      farm.unlockedTypes = [...new Set(presentTypes)].filter((type) =>
        LLAMA_TYPES.includes(type)
      );
    }
    next.farm = farm;
  }
  // Golden-star timers (client-rolled now): a save from before this
  // slice has neither field. Default a MISSING field to null (no star
  // scheduled, never bought) so the save keeps validating — the client
  // rolls a fresh schedule on load when Constellation is unlocked. A
  // present-but-wrong value is left alone so the shape check rejects
  // it, the same rule as the farm backfill above.
  if (next.nextStarAtMs === undefined) next.nextStarAtMs = null;
  if (next.lastStarBuyAtMs === undefined) next.lastStarBuyAtMs = null;
  // Prestige (Sell the Company, Slice 1): a save from before prestige
  // shipped has none of these fields. Backfill them to their fresh
  // values — 0 Equity earned, 0 spent, 0 sales, Company LOC counted
  // from zero, no sale id — so the save keeps validating. Lifetime
  // LOC is the existing totalLinesOfCode counter, which the save
  // already carries: migration uses it as-is and never infers
  // lifetime earnings from current inventory. A present-but-wrong
  // value is left alone so the shape check rejects it.
  if (next.lifetimeEquityEarned === undefined) {
    next.lifetimeEquityEarned = 0;
  }
  if (next.equitySpent === undefined) next.equitySpent = 0;
  if (next.saleCount === undefined) next.saleCount = 0;
  if (next.lifetimeLocAtLastSale === undefined) {
    next.lifetimeLocAtLastSale = 0;
  }
  if (next.lastSaleId === undefined) next.lastSaleId = null;
  // Permanent store (Slice 2): a save from before the store shipped
  // has none of these fields. Backfill the ranks to all-zero, the
  // intermission to null (not mid-sale), and favorites to empty, so
  // the save keeps validating. Only MISSING keys are filled: a
  // present-but-wrong rank is left alone so the shape check rejects
  // it, and a present intermission is never cleared here (clearing
  // it would silently drop a frozen Starting Capital quote).
  if (
    next.permanentStoreRanks === undefined ||
    next.permanentStoreRanks === null ||
    typeof next.permanentStoreRanks !== "object" ||
    Array.isArray(next.permanentStoreRanks)
  ) {
    next.permanentStoreRanks = zeroStoreRanks();
  } else {
    let changed = false;
    const ranks = { ...next.permanentStoreRanks };
    for (const storeId of PRESTIGE_STORE_IDS) {
      if (ranks[storeId] === undefined) {
        ranks[storeId] = 0;
        changed = true;
      }
    }
    if (changed) next.permanentStoreRanks = ranks;
  }
  if (next.prestigeIntermission === undefined) {
    next.prestigeIntermission = null;
  }
  if (!Array.isArray(next.favoriteOpenSourceProjects)) {
    next.favoriteOpenSourceProjects = [];
  } else {
    // Favorites are a list of project ids: drop anything that is not
    // a real project id, and dedupe. A present-but-unknown id is a
    // stale favorite (a project removed or renamed), not a tampered
    // save, so trimming it here is safe; the shape check still
    // rejects a non-array.
    const kept = [
      ...new Set(
        next.favoriteOpenSourceProjects.filter((id) =>
          OPEN_SOURCE_IDS.includes(id)
        )
      ),
    ];
    if (kept.length !== next.favoriteOpenSourceProjects.length) {
      next.favoriteOpenSourceProjects = kept;
    }
  }
  // SUBTRACTERALL (issue #150): a save from before it shipped has no
  // subtracterall field, and a save from before the rework carries
  // the removed tier / liability / tolerance fields. Both get the
  // fresh Ready state (use count 0), so the save keeps validating.
  // That is a fresh default, not a migration: nothing old carries
  // over. A value already in the new shape is left alone, so the
  // shape check still rejects a present-but-wrong value.
  next.subtracterall = normalizeSubtracterallState(next.subtracterall);
  // Night Shift (issue #149): a save from before it shipped has no
  // level. A fresh default of 0, no backfill; a present-but-wrong
  // value is left alone so the shape check rejects it.
  if (next.nightShiftLevel === undefined) next.nightShiftLevel = 0;
  if (next.overtimeReskin === undefined) next.overtimeReskin = false;
  // Achievements (issue #132): a save from before achievements has no
  // record at all. Default it to a fresh one (no backfill: every tier
  // starts locked and every counter starts at 0, and the client
  // evaluates the tiers from the live state on its next action). Only
  // MISSING keys are filled; a present-but-wrong value is left alone
  // so the shape check rejects it.
  next.achievements = normalizeAchievementsState(next.achievements);
  return next;
}

/**
 * Fill in the fields on an actions object that predates them (a client
 * from before a later slice): the constellation / starBroker keys in
 * openSourceLevelsBought, the new employee keys in employeesBought,
 * the big-project keys in projectsCompleted, and autoShips. Same rule
 * as normalizeSaveState: only the new fields are defaulted.
 *
 * The star/farm claim keys (starClaims, farmBreedClaims) are gone:
 * the client rolls those outcomes locally now and they arrive inside
 * the save state, so they are no longer part of the actions at all.
 * An actions object that still carries them (an old client bundle)
 * has them stripped here, so it still validates against the new
 * 5-key shape instead of 400ing on a deploy.
 */
export function normalizeActions(actions) {
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) {
    return actions;
  }
  const next = { ...actions };
  // Legacy claim keys: drop them (see the doc comment above).
  delete next.starClaims;
  delete next.farmBreedClaims;
  if (
    next.openSourceLevelsBought &&
    typeof next.openSourceLevelsBought === "object" &&
    !Array.isArray(next.openSourceLevelsBought) &&
    next.openSourceLevelsBought.constellation === undefined
  ) {
    next.openSourceLevelsBought = {
      ...next.openSourceLevelsBought,
      constellation: 0,
    };
  }
  if (
    next.openSourceLevelsBought &&
    typeof next.openSourceLevelsBought === "object" &&
    !Array.isArray(next.openSourceLevelsBought) &&
    next.openSourceLevelsBought.starBroker === undefined
  ) {
    // Same migration as constellation: a client from before StarBroker
    // shipped has no starBroker key in its level deltas.
    next.openSourceLevelsBought = {
      ...next.openSourceLevelsBought,
      starBroker: 0,
    };
  }
  if (
    next.openSourceLevelsBought &&
    typeof next.openSourceLevelsBought === "object" &&
    !Array.isArray(next.openSourceLevelsBought)
  ) {
    // Same migration for the doubling upgrades (issue #118): a client
    // from before they shipped has none of the six keys in its level
    // deltas. Default each missing one to 0, or the exact-keys shape
    // check rejects the save.
    let changed = false;
    const filled = { ...next.openSourceLevelsBought };
    for (const projectId of LATER_OPEN_SOURCE_IDS) {
      if (filled[projectId] === undefined) {
        filled[projectId] = 0;
        changed = true;
      }
    }
    if (changed) next.openSourceLevelsBought = filled;
  }
  if (
    next.employeesBought &&
    typeof next.employeesBought === "object" &&
    !Array.isArray(next.employeesBought)
  ) {
    // A new employee type shipped after the client (or test fixture)
    // was built: an action from an older client lacks that key.
    // Default the missing counts to 0 instead of failing the shape
    // check — an old client cannot have hired a type it does not
    // know about, so 0 is the correct count. Same pattern as the
    // projectsCompleted migration above. A present-but-wrong value is
    // left alone so the shape check rejects it.
    let changed = false;
    const bought = { ...next.employeesBought };
    for (const type of EMPLOYEE_TYPES) {
      if (bought[type] === undefined) {
        bought[type] = 0;
        changed = true;
      }
    }
    if (changed) next.employeesBought = bought;
  }
  if (
    next.projectsCompleted &&
    typeof next.projectsCompleted === "object" &&
    !Array.isArray(next.projectsCompleted)
  ) {
    // The four big projects shipped after the first three: an action
    // from an older client (or an older test fixture) lacks those
    // keys. Default the missing counts to 0 instead of failing the
    // shape check, same pattern as the open-source migration above.
    let changed = false;
    const completed = { ...next.projectsCompleted };
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      if (completed[projectKey] === undefined) {
        completed[projectKey] = 0;
        changed = true;
      }
    }
    if (changed) next.projectsCompleted = completed;
  }
  if (
    next.autoShips === undefined ||
    next.autoShips === null ||
    typeof next.autoShips !== "object" ||
    Array.isArray(next.autoShips)
  ) {
    // Release Manager auto-ships (per project, this window): a client
    // from before the Release Manager shipped has no autoShips key.
    // Default it to all-zero instead of failing the shape check, same
    // pattern as the open-source migration above.
    const autoShips = {};
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      autoShips[projectKey] = 0;
    }
    next.autoShips = autoShips;
  } else {
    // The autoShips map exists: only fill in keys that are genuinely
    // missing (an action from an older client lacks the big-project
    // keys). A present-but-wrong value is left alone so the shape
    // check rejects it.
    let changed = false;
    const autoShips = { ...next.autoShips };
    for (const projectKey of FREELANCE_PROJECT_KEYS) {
      if (autoShips[projectKey] === undefined) {
        autoShips[projectKey] = 0;
        changed = true;
      }
    }
    if (changed) next.autoShips = autoShips;
  }
  return next;
}

/**
 * ===== In-game email (issue #31) =====
 *
 * The inbox is a fictional mailbox in the game world, not real email.
 * Email content is data: one builder per trigger, each returning
 * { sender, subject, body }. The client email module calls the builder
 * for the trigger that fired and stores the result in the inbox. The
 * server never renders email — it only enforces the shape and the cap.
 */

/**
 * Display names for employees and open-source projects. These are the
 * single source of truth for names: the client display config
 * (gameConfig.js) spreads them in alongside icons/colors/descriptions,
 * and the email module reads them from here so it stays free of the
 * client's icon imports (react-icons), which the save server's test
 * environment does not install.
 */
export const EMPLOYEE_DISPLAY_NAMES = Object.freeze({
  intern: "Intern",
  junior: "Junior Developer",
  senior: "Senior Developer",
  projectManager: "Project Manager",
  commitSpecialist: "Commit Specialist",
  releaseManager: "Release Manager",
});

export const OPEN_SOURCE_DISPLAY_NAMES = Object.freeze({
  overReactFramework: "OverReact Framework",
  blocker: "Blocker Containerization Platform",
  constellation: "GitNub Constellation",
  starBroker: "StarBroker",
  moonshot: "Moonshot",
  launchPad: "Launch Pad",
  coffeeScript: "CoffeeScript",
  juniorAchievement: "Junior Achievement",
  seniorMoment: "Senior Moment",
  scrumMaster: "Scrum Master",
  commitmentIssues: "Commitment Issues",
  shipHappens: "Ship Happens",
  bridgeRound: "Bridge Round",
});

export const FREELANCE_PROJECT_DISPLAY_NAMES = Object.freeze({
  toDoListApp: "To Do List App",
  hobbyWebsite: "Hobby Website",
  paradigmShiftingBlockchainProject: "Paradigm-Shifting Blockchain Project",
  aiPoweredDashboard: "AI-Powered Dashboard",
  nftMarketplace: "NFT Marketplace",
  metaverseRealEstate: "Metaverse Real Estate",
  quantumToDoList: "Quantum To-Do List",
});

/**
 * Unlock visibility threshold: a locked card (and its teaser email)
 * appears once ANY unlock condition reaches this fraction of its target.
 * Lives here (not in the client display config) because the unlock
 * helpers in client/src/utils/unlockProgress.js read it, and that module
 * must stay free of client-only imports for the server tests.
 */
export const UNLOCK_VISIBILITY_THRESHOLD = 0.1;

/** Inbox bounds and field length caps (server-enforced in the save shape check). */
export const EMAIL_CONFIG = Object.freeze({
  /** Max emails in the inbox; the client deletes the oldest past this. */
  maxInboxEmails: 25,
  maxTriggerKeyLength: 128,
  maxSenderLength: 100,
  maxSubjectLength: 200,
  maxBodyLength: 2000,
  /** Max length of an email link's item id (issue #173). */
  maxTargetItemIdLength: 64,
  /** Max earned tiers one achievement email can list: every tier of
   *  every achievement (ACHIEVEMENTS is defined above). */
  maxTrophies: ACHIEVEMENTS.reduce((sum, def) => sum + def.thresholds.length, 0),
});

/** ===== Email links (issue #173) =====
 *
 * An email that mentions a specific thing links to it. The link is an
 * optional `target` on the email record: { tab, itemId }, where `tab`
 * is one of EMAIL_LINK_TABS (the client's nav tab ids) and `itemId`
 * names the card on that tab (an employee type, an open-source
 * project id, a freelance project key, an achievement id). The Farm
 * has no per-item cards, so its links take itemId null and land on
 * the tab's top panel. Achievement emails also carry
 * `trophies` ([{ id, tier }]), one link per trophy (see
 * achievementEmailEntries).
 *
 * Both fields are optional: old emails have neither and render no
 * link. A missing or malformed target reads as "no link" on the
 * client (sanitizeEmailTarget) and fails the server's save shape
 * check (emailTargetError), so a bad one is never stored.
 */
export const EMAIL_LINK_TABS = Object.freeze([
  "shop",
  "projects",
  "openSource",
  "farm",
  "achievements",
]);

/** The ids a target's itemId may name on each tab (null: tab only). */
function emailTargetItemIds(tab) {
  switch (tab) {
    case "shop":
      return EMPLOYEE_TYPES;
    case "projects":
      return FREELANCE_PROJECT_KEYS;
    case "openSource":
      return OPEN_SOURCE_IDS;
    case "achievements":
      return ACHIEVEMENTS.map((def) => def.id);
    default:
      return [];
  }
}

/**
 * Why a value is not a valid email target, or null when it is. A
 * target is { tab, itemId } (exactly those keys): tab one of
 * EMAIL_LINK_TABS, itemId a known id on that tab (null on the Farm,
 * which has no per-item cards). Undefined or null (no target) is
 * valid: the field is optional.
 */
export function emailTargetError(target) {
  if (target === undefined || target === null) return null;
  if (typeof target !== "object" || Array.isArray(target)) {
    return "emails target must be an object";
  }
  const keys = Object.keys(target);
  if (
    keys.length !== 2 ||
    !keys.includes("tab") ||
    !keys.includes("itemId")
  ) {
    return "emails target must have exactly tab and itemId";
  }
  if (!EMAIL_LINK_TABS.includes(target.tab)) {
    return "emails target tab is not a linkable tab";
  }
  // A tab with cards links to one of them; the Farm (no per-item
  // cards) links to the tab itself, itemId null.
  const itemIds = emailTargetItemIds(target.tab);
  if (itemIds.length === 0) {
    return target.itemId === null
      ? null
      : "emails target itemId must be null on that tab";
  }
  if (
    typeof target.itemId !== "string" ||
    target.itemId.length < 1 ||
    target.itemId.length > EMAIL_CONFIG.maxTargetItemIdLength ||
    !itemIds.includes(target.itemId)
  ) {
    return "emails target itemId is not an item on that tab";
  }
  return null;
}

/** A clean copy of a valid target, or null (missing or malformed). */
export function sanitizeEmailTarget(target) {
  if (target === undefined || target === null) return null;
  if (emailTargetError(target) !== null) return null;
  return { tab: target.tab, itemId: target.itemId };
}

/** A target for `tab` (and `itemId`, default none), or null if invalid. */
export function emailTarget(tab, itemId = null) {
  return sanitizeEmailTarget({ tab, itemId: itemId ?? null });
}

/**
 * Builder helper: the mail content with `target` attached when there
 * is one. A builder called without a valid item id (an old call site,
 * a test) builds no link at all, never a broken one.
 */
function withEmailTarget(target, content) {
  return target ? { ...content, target } : content;
}

/** ===== Save wipe explanation mail (issue #172) =====
 *
 * When the server wipes a save that predates the current schema
 * (lockSaveRow in server/src/store.js), the fresh state's inbox holds
 * one mail saying why. A brand-new player (a mint) was never reset and
 * never gets it. Keyed by schema version: a future deliberate wipe adds
 * its own entry here; a version without one wipes silently.
 */
const SAVE_WIPE_EMAILS = Object.freeze({
  2: Object.freeze({
    sender: "GitNub",
    subject: "Your company was reset (so was everyone's)",
    body:
      `Git Rich Quick just shipped its biggest rebalance yet: Funding ` +
      `Rounds. Equity, the Open Source tracks and the permanent store ` +
      `all work differently now, and the old numbers could not survive ` +
      `the move.\n\n` +
      `So every company was reset, and you are starting fresh. This is ` +
      `not a bug, and nothing you did caused it. It was not just you, ` +
      `either: every single player was reset at the same time. Your LOC, ` +
      `your Equity and your trophies are gone, and so are everyone ` +
      `else's. The playing field has never been flatter.\n\n` +
      `What changed: Equity now grows with the cube root of lifetime ` +
      `LOC, the Open Source tracks multiply 1.4x per level, and the ` +
      `higher versions open as you raise Funding Rounds (Seed, Series A, ` +
      `Series B, Series C, IPO) in the permanent store after a sale.\n\n` +
      `Think of it as a pivot. Investors love a pivot. Start typing.`,
  }),
  // Issue #192: Bridge Rounds and the Ship Happens gate. A save holding
  // Ship Happens above its new cap would fail the cap check, and
  // clamping is migration code, so schema 3 starts everyone fresh.
  3: Object.freeze({
    sender: "GitNub",
    subject: "Your company was reset again (so was everyone's)",
    body:
      `Git Rich Quick just rewired the Funding Rounds wall, and the old ` +
      `companies could not make the trip. Every save was reset at the ` +
      `same time. Not a bug, not your fault, and not just you: the ` +
      `whole leaderboard of nobody is back at zero.\n\n` +
      `What changed: when the caps stop you, a Bridge Round on the Open ` +
      `Source tab rents the next round's caps for one company, paid in ` +
      `LOC. Ship Happens now opens up round by round like the other ` +
      `tracks, so your Release Managers stop printing money in the ` +
      `first company. Raise the real round with Equity after a sale and ` +
      `the caps are yours for good.\n\n` +
      `Call it a down round. Everyone survives those. Start typing.`,
  }),
});

/** The fixed trigger key of a schema version's wipe mail. */
export function saveWipeEmailTriggerKey(schemaVersion) {
  return `save-wipe:v${schemaVersion}`;
}

/** The wipe mail content for a schema version, or null (wipe silently). */
export function buildSaveWipeEmail(schemaVersion) {
  const mail = SAVE_WIPE_EMAILS[schemaVersion];
  return mail ? { ...mail } : null;
}

/**
 * The fresh state a wiped save is replaced with: initialSaveState(),
 * plus the version's explanation mail (unread) when it has one.
 * `emailId` is the new mail's UUID (the server's randomUUID), `nowMs`
 * its arrival time. Only the wipe path calls this; a mint uses
 * initialSaveState() directly, so a new player's inbox stays empty.
 */
export function wipedSaveState(schemaVersion, { emailId, nowMs }) {
  const state = initialSaveState();
  const mail = buildSaveWipeEmail(schemaVersion);
  if (mail && typeof emailId === "string" && emailId.length > 0) {
    const createdAtMs = Math.max(0, Math.floor(Number(nowMs) || 0));
    state.emails = [
      {
        id: emailId,
        triggerKey: saveWipeEmailTriggerKey(schemaVersion),
        ...mail,
        createdAtMs,
        read: false,
      },
    ];
  }
  return state;
}

/** Whether one { id, tier } names a real tier of a real achievement. */
function isEmailTrophy(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const def = findAchievement(entry.id);
  return (
    def !== null &&
    Number.isInteger(entry.tier) &&
    entry.tier >= 1 &&
    entry.tier <= def.thresholds.length
  );
}

/**
 * Why a value is not a valid achievement-email trophy list, or null
 * when it is (undefined: no list, valid). A list is a non-empty array
 * of up to EMAIL_CONFIG.maxTrophies { id, tier } entries (exactly
 * those keys), each a real tier of a real achievement.
 */
export function emailTrophiesError(trophies) {
  if (trophies === undefined) return null;
  if (!Array.isArray(trophies) || trophies.length < 1) {
    return "emails trophies must be a non-empty array";
  }
  if (trophies.length > EMAIL_CONFIG.maxTrophies) {
    return "emails trophies exceeds the trophy cap";
  }
  for (const entry of trophies) {
    if (
      !isEmailTrophy(entry) ||
      Object.keys(entry).length !== 2
    ) {
      return "emails trophies entries must be { id, tier } of a real achievement tier";
    }
  }
  return null;
}

/**
 * The valid { id, tier } entries of a trophy list, copied, capped at
 * EMAIL_CONFIG.maxTrophies; null when none are valid (or it is not
 * an array). Extra keys on an entry are dropped.
 */
export function sanitizeEmailTrophies(trophies) {
  if (!Array.isArray(trophies)) return null;
  const clean = trophies
    .filter(isEmailTrophy)
    .slice(0, EMAIL_CONFIG.maxTrophies)
    .map(({ id, tier }) => ({ id, tier }));
  return clean.length > 0 ? clean : null;
}

/**
 * Total duration (seconds) of a timed star buff, from its effect and
 * whether it is good or bad. The stored buff (activeStarEffects) only
 * carries expiresAtMs — not its total duration — so the effect
 * duration bar derives the total from the config instead of growing
 * the save shape. Good is a multiplier above 1x, bad below 1x (the
 * config only ever issues those: good 2-7x, bad 0.5x).
 */
export function starBuffDurationSeconds(effect, good) {
  const key = good ? "good" : "bad";
  switch (effect) {
    case "frenzy":
      return STAR_CONFIG.frenzyDurationSeconds[key];
    case "click":
      return STAR_CONFIG.clickDurationSeconds[key];
    case "employee":
      return STAR_CONFIG.employeeDurationSeconds[key];
    case "moonshot":
      return MOONSHOT_CONFIG.jackpotDurationSeconds;
    case "hype":
      return STAR_CONFIG.hypeDurationSeconds[key];
    case "hiring":
      return STAR_CONFIG.hiringDurationSeconds[key];
    default:
      return null;
  }
}

/**
 * The effective production multiplier for one employee type right now.
 *
 * A Frenzy buff (Overclock / Throttling) scales ALL production, and an
 * Employee buff (Sprint / Meeting) scales one type's production — and
 * the production math multiplies them (see calculateLOCPerSecond: the
 * Employee extra is added to the base rate, then Frenzy scales the
 * whole rate), so the two combine as a product, never a sum. Each
 * defaults to 1 when no live buff of that kind is active, and expired
 * entries are ignored (same expiry check as activeStarBuff).
 *
 * The employee card's tint and boosted amount both read this one
 * number, so they can never disagree with each other or with the
 * actual production rate. A combined 1 — including a Frenzy bad
 * (0.5x) cancelled by an Employee good (2x) — means no tint and no
 * boosted amount, because production is genuinely unchanged.
 *
 * The Project Manager boost is part of this multiplier too: each
 * manager adds +1% to ALL employee passive LOC, so a type's
 * production is its base rate times (1 + 0.01 x N) even with no star
 * buff live. That means a card tints green whenever managers are
 * owned — the boost is permanent, not a star effect, so the tint no
 * longer means "a star buff is live" by itself. The PM Sprint
 * scaling is NOT folded in here: a Sprint on Project Managers is a
 * buff on the Project Manager type itself, shown on the PM card, not
 * on every type's card.
 *
 * @param {Array} activeStarEffects - the state's live timed buffs
 * @param {string} employeeType - intern / junior / senior
 * @param {number} nowMs - the clock reading (injectable for tests)
 * @param {object|null} employeeCounts - flat employee counts, when the
 *   caller wants the Project Manager boost included; omit for the
 *   star-buff-only multiplier (the boost factor is then 1)
 * @returns {number} the combined multiplier (1 when nothing is live)
 */
export function effectiveEmployeeMultiplier(
  activeStarEffects,
  employeeType,
  nowMs = Date.now(),
  employeeCounts = null,
  openSourceLevels = {}
) {
  let multiplier = 1;
  for (const buff of activeStarEffects ?? []) {
    if (buff.expiresAtMs <= nowMs) continue;
    // To the Moon (issue #165) scales all production like Frenzy, and
    // stacks with it (a separate effect).
    if (buff.effect === "frenzy" || buff.effect === "moonshot") {
      multiplier *= buff.multiplier;
    } else if (
      buff.effect === "employee" &&
      buff.employeeType === employeeType
    ) {
      multiplier *= buff.multiplier;
    }
  }
  if (employeeCounts) {
    multiplier *=
      1 + projectManagerBoostFraction(employeeCounts, 1, openSourceLevels);
  }
  // The type's doubling project (issue #118) doubles its output per
  // level, on top of the star buffs and the Project Manager boost.
  multiplier *= doublingMultiplier(employeeType, openSourceLevels);
  return multiplier;
}

/**
 * The reward detail for a resolved star claim ("+500 LOC",
 * "Production 7x", "Senior Developers 0.5x productivity"). Timed
 * multipliers read "{multiplier}x" so the email renderer can color
 * them (green above 1x, red below 1x), and the employee detail says
 * "productivity" so it reads as a production change, not a bare
 * multiplier.
 */
export function starRewardDetail(claim, employeeTypeName) {
  switch (claim.effect) {
    case "lucky": {
      if (claim.locDelta !== 0) {
        const formatted = formatNumber(claim.locDelta);
        return claim.locDelta > 0 ? `+${formatted} LOC` : `${formatted} LOC`;
      }
      const sign = claim.moneyDelta > 0 ? "+" : "-";
      return `${sign}${formatMoney(Math.abs(claim.moneyDelta))}`;
    }
    case "shootingStars": {
      // Cookie Chain (issue #138): "+777 LOC (chain x3)".
      const parts = [];
      if (claim.locDelta !== 0)
        parts.push(`+${formatNumber(claim.locDelta)} LOC`);
      if (claim.moneyDelta !== 0)
        parts.push(`+${formatMoney(claim.moneyDelta)}`);
      if (claim.chainStep) parts.push(`(chain x${claim.chainStep})`);
      return parts.join(" ");
    }
    case "frenzy":
      return `Production ${claim.multiplier}x`;
    // To the Moon (issue #165): "Production 25x for 15s".
    case "moonshot":
      return `Production ${claim.multiplier}x for ${claim.durationSeconds ?? MOONSHOT_CONFIG.jackpotDurationSeconds}s`;
    case "click":
      return `Clicks ${claim.multiplier}x`;
    case "employee": {
      const typeName = employeeTypeName ?? claim.employeeType;
      return `${typeName}s ${claim.multiplier}x productivity`;
    }
    // Issue #157. "{n}x" colors in the inbox (green above 1x, red
    // below), which reads right for payouts. Hire costs run the other
    // way (0.5x is the good one), so they are worded as a percent.
    case "hype":
      return `Freelance payouts ${claim.multiplier}x`;
    case "hiring": {
      const percent = Math.round(Math.abs(1 - claim.multiplier) * 100);
      return claim.multiplier < 1
        ? `Hires ${percent}% off`
        : `Hires cost ${percent}% more`;
    }
    default:
      return "";
  }
}

/**
 * An employee became VISIBLE but is not unlocked yet — a teaser and a
 * goal. `requirementText` is the human-readable unlock requirement
 * (e.g. "Earn 100 total lines of code"), supplied by the caller.
 */
export function buildEmployeeVisibleEmail({ employeeName, requirementText, employeeType = null }) {
  return withEmailTarget(emailTarget("shop", employeeType), {
    sender: "HR Dept",
    subject: `We found a ${employeeName}!`,
    body:
      `We found a ${employeeName}! They're interested, but not impressed ` +
      `yet. They want to see a bigger operation first.\n\n` +
      `To win them over: ${requirementText}.\n\n` +
      `Keep shipping. They'll be watching your commit history.`,
  });
}

/** An employee's unlock requirement is met — they are hireable now. */
export function buildEmployeeUnlockedEmail({ employeeName, employeeType = null }) {
  return withEmailTarget(emailTarget("shop", employeeType), {
    sender: "HR Dept",
    subject: `${employeeName} is available to hire!`,
    body:
      `Good news: the ${employeeName} looked at your commit history and ` +
      `decided you're worth working for.\n\n` +
      `They're on the market now. Hire them before some other startup does.`,
  });
}

/** A freelance project became VISIBLE but is not unlocked yet — a teaser and a goal. */
export function buildFreelanceProjectVisibleEmail({ projectName, requirementText, projectKey = null }) {
  return withEmailTarget(emailTarget("projects", projectKey), {
    sender: "Freelance Board",
    subject: `${projectName} is on the board!`,
    body:
      `A client posted a ${projectName} gig, but they're not taking ` +
      `newcomers. They want to see a track record first.\n\n` +
      `To land it: ${requirementText}.\n\n` +
      `Ship more gigs and they'll come around. They always do.`,
  });
}

/** A freelance project's unlock requirement is met — it can be shipped now. */
export function buildFreelanceProjectUnlockedEmail({ projectName, projectKey = null }) {
  return withEmailTarget(emailTarget("projects", projectKey), {
    sender: "Freelance Board",
    subject: `${projectName} is available to ship!`,
    body:
      `Your track record convinced the client: the ${projectName} gig ` +
      `is yours now.\n\n` +
      `It's a bigger job with a bigger payout. Ship it before someone ` +
      `else does.`,
  });
}

/** An open-source project became VISIBLE but is not unlocked yet — a teaser and a goal. */
export function buildOpenSourceVisibleEmail({ projectName, requirementText, projectId = null }) {
  return withEmailTarget(emailTarget("openSource", projectId), {
    sender: "GitNub",
    subject: `${projectName} is on the horizon!`,
    body:
      `Word is ${projectName} will open for contributions soon. The ` +
      `maintainers are watching for one thing:\n\n` +
      `${requirementText}.\n\n` +
      `Get there and the repo is yours to spam with pull requests.`,
  });
}

/** An open-source project's unlock requirement is met. */
export function buildOpenSourceUnlockedEmail({ projectName, projectId = null }) {
  return withEmailTarget(emailTarget("openSource", projectId), {
    sender: "GitNub",
    subject: `${projectName} is open for contributions!`,
    body:
      `You can now contribute LOC to ${projectName}. The maintainers have ` +
      `been waiting. Mostly patiently.\n\n` +
      `Ship some code their way and they'll owe you one. Or at least a ` +
      `shoutout in the changelog.`,
  });
}

/** An open-source project reached a new level. */
export function buildOpenSourceLevelEmail({ projectName, level, projectId = null }) {
  return withEmailTarget(emailTarget("openSource", projectId), {
    sender: "GitNub",
    subject: `${projectName} reached v${level}.0!`,
    body:
      `Your contributions pushed ${projectName} to v${level}.0. The ` +
      `changelog just says "various bug fixes and performance ` +
      `improvements", but you know what you did.\n\n` +
      `Keep contributing. The next version has your name on it. Figuratively.`,
  });
}

/**
 * A golden star was claimed. The subject is the benefit or debuff
 * (`effectName: rewardText`, e.g. "Airdrop: +500 LOC"), so the inbox
 * list shows what the star did at a glance. `effectName` is the
 * locked pun name (Airdrop, Rug Pull, ...), `rewardText` is the
 * starRewardDetail string, and `good` picks the sign-off.
 */
export function buildStarRewardEmail({ effectName, rewardText, good, flavor = null }) {
  // An effect with its own story (Hype Train, AGI and their crashes,
  // issue #157) tells it; the rest keep the generic sign-off.
  return {
    sender: "GitNub",
    subject: `${effectName}: ${rewardText}`,
    body:
      typeof flavor === "string" && flavor.length > 0
        ? flavor
        : good
          ? "The GitNub sky provides. Mostly."
          : "The GitNub sky giveth, and the GitNub sky taketh away.",
  };
}

/**
 * The one email for a whole Shooting Stars chain (issue #138), sent
 * when the chain ends: how many stars, the LOC total, and why it ended
 * ("missed", "cap", "bank", or "luck").
 */
export function buildShootingStarsChainEmail({ stars, totalLoc, reason }) {
  const endings = {
    missed: "One got away. Shooting stars wait for no one.",
    cap: "The chain hit six hours of production in one star. Even the sky has a rate limit.",
    bank: "The next star would have paid more than half your bank. The sky does not do loans.",
    luck: "The sky just stopped. It does that. Nobody files a ticket.",
  };
  return {
    sender: "GitNub",
    subject: `Shooting Stars chain: ${stars} ${stars === 1 ? "star" : "stars"}, +${formatNumber(totalLoc)} LOC`,
    body:
      `You caught ${stars} shooting ${stars === 1 ? "star" : "stars"} in a ` +
      `row for +${formatNumber(totalLoc)} LOC. ` +
      `${endings[reason] ?? endings.luck}`,
  };
}

/** The llama farm was bought — the barn opens empty. */
export function buildFarmPurchasedEmail() {
  return withEmailTarget(emailTarget("farm"), {
    sender: "Your Team",
    subject: "We bought a llama farm??",
    body:
      `So. The team has been threatening to quit and start an alpaca ` +
      `farm for months, and you finally let them build one. The barn ` +
      `is up, the mood lighting is installed, and it is completely ` +
      `empty. No llamas come with it. You still have not accepted ` +
      `their notice of quitting, so technically they are still ` +
      `employees. HR has questions. You do not have answers.\n\n` +
      `Buy some llamas, move them in, set the lights, and let them ` +
      `breed. Sell the kids for cash: a llama goes for half of what ` +
      `it would cost you today, and that price grows with your ` +
      `team. Get a Mama Llama. Trust us on the Mama Llama.`,
  });
}

/**
 * The farm became VISIBLE but is not unlocked yet (the first Senior
 * Developer was hired): a teaser and a goal. `requirementText` is the
 * human-readable requirement, e.g. "Hire 10 Senior Developers".
 */
export function buildFarmVisibleEmail({ requirementText }) {
  return withEmailTarget(emailTarget("farm"), {
    sender: "Your Team",
    subject: "A Senior wants to talk about alpacas",
    body:
      `Your new Senior Developer used the phrase "exit strategy" in ` +
      `standup, then showed everyone pictures of a barn. This is how ` +
      `it starts.\n\n` +
      `To unlock the Llama Farm: ${requirementText}. Get enough of ` +
      `them dreaming the same dream and they will build it for you. ` +
      `You still pay for the barn. They are dreamers, not donors.`,
  });
}

/** The farm's unlock requirement is met: the barn can be bought now. */
export function buildFarmUnlockedEmail() {
  return withEmailTarget(emailTarget("farm"), {
    sender: "Your Team",
    subject: "The Seniors have drawn up barn plans",
    body:
      `Ten Senior Developers, one shared dream. They have stopped ` +
      `pretending to code and started sketching stalls on the ` +
      `whiteboard. The Llama Farm is unlocked: open the Farm tab and ` +
      `buy the barn before they put the deposit on the company card.`,
  });
}

/** A brand-new llama type was discovered by breeding. */
export function buildFarmNewTypeEmail({ typeName, typeDescription }) {
  return withEmailTarget(emailTarget("farm"), {
    sender: "Your Team",
    subject: `A ${typeName} was born!`,
    body:
      `One of the llamas had a kid, and it is not like the others. ` +
      `Meet the ${typeName}.\n\n` +
      `${typeDescription}\n\n` +
      `Keep breeding. There are more types out there, and the barn ` +
      `only gets weirder from here.`,
  });
}
