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
 *     { overReactFramework, blocker, constellation }
 *   aiAssistants: flat counts { noPilot }
 *   activeStarEffects: timed golden-star buffs
 *     [{ effect, multiplier, expiresAtMs, employeeType }]
 */

// Number abbreviation (issue #42) — the shared formatter, used by
// starRewardDetail so star-reward text (floating text + email) abbreviates
// large LOC/money the same way every other display does.
import { formatMoney, formatNumber } from "./formatNumber.js";

export const BALANCE = Object.freeze({
  mechanics: Object.freeze({
    tickIntervalMs: 1000,
    baseLocPerClick: 1,
    startingMoney: 0, // cents
    startingLoc: 0,
  }),

  employees: Object.freeze({
    intern: Object.freeze({
      baseCost: 2500, // cents
      locPerSecond: 1,
      costMultiplier: 1.1,
      unlockConditions: Object.freeze([]),
    }),
    junior: Object.freeze({
      baseCost: 20000,
      locPerSecond: 5,
      costMultiplier: 1.15,
      unlockConditions: Object.freeze([
        Object.freeze({ type: "TOTAL_LOC", target: 100 }),
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
  }),

  openSource: Object.freeze({
    overReactFramework: Object.freeze({
      unlockConditions: Object.freeze([]),
      levels: Object.freeze([
        Object.freeze({
          locCost: 100,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 1 }),
        }),
        Object.freeze({
          locCost: 500,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 2 }),
        }),
        Object.freeze({
          locCost: 3000,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 4 }),
        }),
        // Extra levels (issue #33 slice): same per-level click boost
        // as the existing levels (doubles each level).
        Object.freeze({
          locCost: 15000,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 8 }),
        }),
        Object.freeze({
          locCost: 75000,
          bonus: Object.freeze({ type: "CLICK_BOOST", value: 16 }),
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
    // mechanic itself lives in STAR_CONFIG below.
    constellation: Object.freeze({
      unlockConditions: Object.freeze([]),
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
      ]),
    }),
  }),
});

export const EMPLOYEE_TYPES = Object.freeze(["intern", "junior", "senior"]);
export const FREELANCE_PROJECT_KEYS = Object.freeze([
  "toDoListApp",
  "hobbyWebsite",
  "paradigmShiftingBlockchainProject",
]);
export const OPEN_SOURCE_IDS = Object.freeze([
  "overReactFramework",
  "blocker",
  "constellation",
]);

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
  /** Chance a clicked star is a good outcome (vs bad). */
  goodChance: 0.75,
  /**
   * Constellation level that unlocks the next-star countdown display
   * (issue #29). The server tells the client when the next star is
   * coming; the client only SHOWS that countdown once the player
   * reaches this level. Default 2 (early enough to be reachable, late
   * enough to be a reward) — adjustable, NOT a locked decision.
   * The star itself still spawns on schedule before this level; only
   * the timer display is gated.
   */
  countdownUnlockLevel: 2,
  /** Spawn interval range (seconds) per Constellation level, index level-1. */
  spawnIntervalSeconds: Object.freeze([
    Object.freeze({ min: 90, max: 180 }), // L1
    Object.freeze({ min: 90, max: 180 }), // L2 (same — more tiers to work toward)
    Object.freeze({ min: 60, max: 120 }), // L3 (faster)
    Object.freeze({ min: 60, max: 120 }), // L4 (same)
    Object.freeze({ min: 45, max: 90 }), // L5 (faster)
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
  }),
  /** Lucky: instant chunk. Good = 20-50x LOC/sec OR 1-10% of cash; bad = half as bad. */
  luckyLocMultiplier: Object.freeze({
    good: Object.freeze({ min: 20, max: 50 }),
    bad: Object.freeze({ min: 10, max: 25 }),
  }),
  luckyMoneyFraction: Object.freeze({
    good: Object.freeze({ min: 0.01, max: 0.1 }),
    bad: Object.freeze({ min: 0.01, max: 0.05 }),
  }),
  /** Frenzy: all production (LOC/sec) x7 for 60s; bad = x0.5 for 30s. */
  frenzyMultiplier: Object.freeze({ good: 7, bad: 0.5 }),
  frenzyDurationSeconds: Object.freeze({ good: 60, bad: 30 }),
  /** Click: click value x2-5 for 20s; bad = x0.5 for 10s. */
  clickMultiplier: Object.freeze({
    good: Object.freeze({ min: 2, max: 5 }),
    bad: 0.5,
  }),
  clickDurationSeconds: Object.freeze({ good: 20, bad: 10 }),
  /** Employee: one random employee type produces 2x for 60s; bad = 0.5x for 30s. */
  employeeMultiplier: Object.freeze({ good: 2, bad: 0.5 }),
  employeeDurationSeconds: Object.freeze({ good: 60, bad: 30 }),
  /** Shooting Stars: one click grants a burst worth this many Lucky rolls. */
  shootingStarsCount: 5,
});

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
 * Returns null at level 0 (no stars). The server owns this roll
 * (issue #29): it decides when the next star appears and tells the
 * client, so the client never picks its own spawn time.
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
 * Resolve a clicked star into a claim record — the shape the server
 * validates and the client applies. Pure; `rng` is injectable.
 *
 * Claim shape:
 *   { effect, good, locDelta, moneyDelta, multiplier, durationSeconds, employeeType }
 * Instant effects (lucky, shootingStars) carry locDelta/moneyDelta and
 * null multiplier/duration. Timed buffs (frenzy, click, employee) carry
 * a multiplier + durationSeconds and zero deltas. Shooting Stars is a
 * burst of five GOOD Lucky rolls (a rare L5 windfall, never a loss).
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
      return {
        ...base,
        multiplier: STAR_CONFIG.frenzyMultiplier[key],
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
      // dud; if they own no employees yet, any type is a no-op.
      const owned = EMPLOYEE_TYPES.filter(
        (type) => (employeeCounts[type] ?? 0) > 0
      );
      const pool = owned.length > 0 ? owned : EMPLOYEE_TYPES;
      const employeeType = pool[Math.floor(rng() * pool.length)];
      return {
        ...base,
        multiplier: STAR_CONFIG.employeeMultiplier[key],
        durationSeconds: STAR_CONFIG.employeeDurationSeconds[key],
        employeeType,
      };
    }
    case "shootingStars": {
      // A burst of five good Lucky rolls, summed into one claim.
      let locDelta = 0;
      let moneyDelta = 0;
      for (let i = 0; i < STAR_CONFIG.shootingStarsCount; i += 1) {
        const roll = resolveLuckyReward({
          good: true,
          locPerSecond,
          money,
          linesOfCode,
          rng,
        });
        locDelta += roll.locDelta;
        moneyDelta += roll.moneyDelta;
      }
      return { ...base, good: true, locDelta, moneyDelta };
    }
    default:
      return base;
  }
}

/** The display name of a star outcome (the locked pun name). */
export function starEffectName(effect, good) {
  const names = STAR_CONFIG.effects[effect]?.names;
  if (!names) return "Golden Star";
  return good ? names.good : names.bad;
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
    const level = openSourceLevels[projectId] ?? 0;
    const config = BALANCE.openSource[projectId];
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

/** LOC earned by one click, given the open-source levels. */
export function locPerClick(openSourceLevels) {
  return BALANCE.mechanics.baseLocPerClick * (1 + clickBonus(openSourceLevels));
}

/** Base passive LOC/sec from employees, before the passive bonus. */
export function baseLocPerSecond(employeeCounts) {
  return EMPLOYEE_TYPES.reduce(
    (sum, type) =>
      sum + BALANCE.employees[type].locPerSecond * (employeeCounts[type] ?? 0),
    0
  );
}

/** Total passive LOC/sec, including the Blocker passive bonus. */
export function locPerSecond(employeeCounts, openSourceLevels) {
  return baseLocPerSecond(employeeCounts) * (1 + passiveBonus(openSourceLevels));
}

/**
 * Cost in cents of the next hire of a type, when `count` are already owned.
 * Mirrors `getEmployeeCost` in the client: round(base * multiplier ^ count).
 */
export function employeeCost(employeeType, count) {
  const config = BALANCE.employees[employeeType];
  return Math.round(
    config.baseCost * Math.pow(config.costMultiplier, count)
  );
}

/** Cost in cents of buying `n` hires of a type, starting from `fromCount`. */
export function employeePurchaseCosts(employeeType, fromCount, n) {
  const costs = [];
  for (let i = 0; i < n; i += 1) {
    costs.push(employeeCost(employeeType, fromCount + i));
  }
  return costs;
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
    default:
      return false;
  }
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

/** The save state a brand-new player starts from. Unlocks derive from the configs. */
export function initialSaveState() {
  const unlockedEmployees = {};
  for (const type of EMPLOYEE_TYPES) {
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
  return {
    linesOfCode: BALANCE.mechanics.startingLoc,
    totalLinesOfCode: 0,
    money: BALANCE.mechanics.startingMoney,
    employees: { intern: 0, junior: 0, senior: 0 },
    aiAssistants: { noPilot: 0 },
    freelanceProjectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    openSourceProjects,
    unlockedEmployees,
    unlockedOpenSourceProjects,
    unlockedFreelanceProjects,
    // Timed golden-star buffs active right now. Each entry is
    // { effect, multiplier, expiresAtMs, employeeType }. Short-lived
    // (10-60s); expired entries are dropped by the client tick.
    activeStarEffects: [],
    // In-game inbox (issue #31). Each entry is
    // { id, triggerKey, sender, subject, body, createdAtMs, read }.
    // Capped at EMAIL_CONFIG.maxInboxEmails; the client trims the
    // oldest when a new one arrives past the cap.
    emails: [],
  };
}

/**
 * Fill in the star-era fields on a save state that predates them (a save
 * stored before Constellation shipped). Returns a shallow copy with the
 * new fields defaulted; states that already have them are unchanged.
 * Only the NEW fields are defaulted — a missing old field is still a
 * shape error, so this never masks a malformed save.
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
    next.unlockedOpenSourceProjects &&
    typeof next.unlockedOpenSourceProjects === "object" &&
    !Array.isArray(next.unlockedOpenSourceProjects) &&
    next.unlockedOpenSourceProjects.constellation === undefined
  ) {
    // Constellation has no unlock conditions, so it starts unlocked.
    next.unlockedOpenSourceProjects = {
      ...next.unlockedOpenSourceProjects,
      constellation: true,
    };
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
  return next;
}

/**
 * Fill in the star-era fields on an actions object that predates them
 * (a client from before the star slice): the starClaims list, and the
 * constellation key in openSourceLevelsBought. Same rule as
 * normalizeSaveState: only the new fields are defaulted.
 */
export function normalizeStarActions(actions) {
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) {
    return actions;
  }
  const next = { ...actions };
  if (!Array.isArray(next.starClaims)) {
    next.starClaims = [];
  }
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
});

export const OPEN_SOURCE_DISPLAY_NAMES = Object.freeze({
  overReactFramework: "OverReact Framework",
  blocker: "Blocker Containerization Platform",
  constellation: "GitNub Constellation",
});

export const FREELANCE_PROJECT_DISPLAY_NAMES = Object.freeze({
  toDoListApp: "To Do List App",
  hobbyWebsite: "Hobby Website",
  paradigmShiftingBlockchainProject: "Paradigm-Shifting Blockchain Project",
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
});

/** The reward detail for a resolved star claim ("+500 LOC", "Production x7"). */
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
      const parts = [];
      if (claim.locDelta !== 0)
        parts.push(`+${formatNumber(claim.locDelta)} LOC`);
      if (claim.moneyDelta !== 0)
        parts.push(`+${formatMoney(claim.moneyDelta)}`);
      return parts.join(" ");
    }
    case "frenzy":
      return `Production x${claim.multiplier}`;
    case "click":
      return `Clicks x${claim.multiplier}`;
    case "employee": {
      const typeName = employeeTypeName ?? claim.employeeType;
      return `${typeName}s x${claim.multiplier}`;
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
export function buildEmployeeVisibleEmail({ employeeName, requirementText }) {
  return {
    sender: "HR Dept",
    subject: `We found a ${employeeName}!`,
    body:
      `We found a ${employeeName}! They're interested, but not impressed ` +
      `yet — they want to see a bigger operation first.\n\n` +
      `To win them over: ${requirementText}.\n\n` +
      `Keep shipping. They'll be watching your commit history.`,
  };
}

/** An employee's unlock requirement is met — they are hireable now. */
export function buildEmployeeUnlockedEmail({ employeeName }) {
  return {
    sender: "HR Dept",
    subject: `${employeeName} is available to hire!`,
    body:
      `Good news: the ${employeeName} looked at your commit history and ` +
      `decided you're worth working for.\n\n` +
      `They're on the market now. Hire them before some other startup does.`,
  };
}

/** A freelance project became VISIBLE but is not unlocked yet — a teaser and a goal. */
export function buildFreelanceProjectVisibleEmail({ projectName, requirementText }) {
  return {
    sender: "Freelance Board",
    subject: `${projectName} is on the board!`,
    body:
      `A client posted a ${projectName} gig, but they're not taking ` +
      `newcomers — they want to see a track record first.\n\n` +
      `To land it: ${requirementText}.\n\n` +
      `Ship more gigs and they'll come around. They always do.`,
  };
}

/** A freelance project's unlock requirement is met — it can be shipped now. */
export function buildFreelanceProjectUnlockedEmail({ projectName }) {
  return {
    sender: "Freelance Board",
    subject: `${projectName} is available to ship!`,
    body:
      `Your track record convinced the client: the ${projectName} gig ` +
      `is yours now.\n\n` +
      `It's a bigger job with a bigger payout. Ship it before someone ` +
      `else does.`,
  };
}

/** An open-source project became VISIBLE but is not unlocked yet — a teaser and a goal. */
export function buildOpenSourceVisibleEmail({ projectName, requirementText }) {
  return {
    sender: "GitNub",
    subject: `${projectName} is on the horizon!`,
    body:
      `Word is ${projectName} will open for contributions soon. The ` +
      `maintainers are watching for one thing:\n\n` +
      `${requirementText}.\n\n` +
      `Get there and the repo is yours to spam with pull requests.`,
  };
}

/** An open-source project's unlock requirement is met. */
export function buildOpenSourceUnlockedEmail({ projectName }) {
  return {
    sender: "GitNub",
    subject: `${projectName} is open for contributions!`,
    body:
      `You can now contribute LOC to ${projectName}. The maintainers have ` +
      `been waiting. Mostly patiently.\n\n` +
      `Ship some code their way and they'll owe you one. Or at least a ` +
      `shoutout in the changelog.`,
  };
}

/** An open-source project reached a new level. */
export function buildOpenSourceLevelEmail({ projectName, level }) {
  return {
    sender: "GitNub",
    subject: `${projectName} reached v${level}.0!`,
    body:
      `Your contributions pushed ${projectName} to v${level}.0. The ` +
      `changelog just says "various bug fixes and performance ` +
      `improvements", but you know what you did.\n\n` +
      `Keep contributing — the next version has your name on it. Figuratively.`,
  };
}

/**
 * A golden star was claimed. `effectName` is the locked pun name
 * (Airdrop, Rug Pull, ...), `rewardText` is the starRewardDetail
 * string, and `good` picks the sign-off.
 */
export function buildStarRewardEmail({ effectName, rewardText, good }) {
  return {
    sender: "GitNub",
    subject: "A star fell on your repo!",
    body:
      `${effectName}: ${rewardText}.\n\n` +
      (good
        ? "The GitNub sky provides. Mostly."
        : "The GitNub sky giveth, and the GitNub sky taketh away."),
  };
}
