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
    commitSpecialist: Object.freeze({
      baseCost: 500000,
      locPerSecond: 0,
      costMultiplier: 1.2,
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
]);

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
 * unlock, so it costs $10,000, not $250. No free llamas — the barn
 * arrives empty and you buy llamas yourself. Breeding is slow (a
 * 60s tick, not 5s) and the roll happens on the CLIENT now (it used
 * to be server-rolled and issued): the client rolls the outcome from
 * the shared odds (rollFarmBreeding) and the save carries the new
 * kid in the farm stalls.
 */
export const FARM_CONFIG = Object.freeze({
  /**
   * One-time purchase cost, in cents ($10,000). The money is the gate —
   * the farm has no unlock condition in v1. Tuning value (Brandon:
   * "at least 10k").
   */
  purchaseCostCents: 1000000,
  /**
   * Price of one base llama (Classic or Drama), in cents ($500).
   * Bred types are never for sale — they come only from breeding.
   * Tuning value: cheap enough that a player who just spent $10,000
   * on the barn can afford a pair to start breeding.
   */
  llamaPriceCents: 50000,
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
  "spaghetti",
  "quantum",
  "blockchain",
  "ai",
]);

/** The two base types for sale in the shop. Bred types are never sold. */
export const LLAMA_BASE_TYPES = Object.freeze(["classic", "drama"]);

/** Display names for the llama types. */
export const LLAMA_TYPE_NAMES = Object.freeze({
  classic: "Classic Llama",
  drama: "Drama Llama",
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
  if (rng() >= lighting.kidChance) return null;
  const parentTypes = farmStallNeighbours(stallIndex)
    .map((n) => stalls[n].llama)
    .filter(Boolean);
  if (parentTypes.length < 2) return null;
  const undiscovered = LLAMA_TYPES.filter(
    (type) => !(unlockedTypes ?? []).includes(type)
  );
  if (undiscovered.length > 0 && rng() < lighting.newTypeChance) {
    return undiscovered[Math.floor(rng() * undiscovered.length)];
  }
  return parentTypes[Math.floor(rng() * parentTypes.length)];
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
  /** Chance a clicked star is a good outcome (vs bad). */
  goodChance: 0.75,
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
      const owned = EMPLOYEE_TYPES.filter(
        (type) => (employeeCounts[type] ?? 0) > 0
      );
      const pool = owned.length > 0 ? owned : EMPLOYEE_TYPES;
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
 * Specialists shipped has no specialists, so the bonus is 0). */
export function locPerClick(
  openSourceLevels,
  employeeCounts,
  csSprintMultiplier = 1
) {
  return Math.floor(
    (BALANCE.mechanics.baseLocPerClick +
      commitSpecialistClickBonus(employeeCounts, csSprintMultiplier)) *
      (1 + clickBonus(openSourceLevels))
  );
}

/** Base passive LOC/sec from employees, before the passive bonus. */
export function baseLocPerSecond(employeeCounts) {
  return EMPLOYEE_TYPES.reduce(
    (sum, type) =>
      sum + BALANCE.employees[type].locPerSecond * (employeeCounts[type] ?? 0),
    0
  );
}

/**
 * Project Manager boost fraction: each Project Manager adds +1% to ALL
 * employee passive LOC. `pmSprintMultiplier` is a live Sprint on Project
 * Managers (default 1, i.e. no Sprint); a 5x Sprint makes each manager
 * give +5% while it is live, a Meeting halves it to +0.5% per manager.
 */
export function projectManagerBoostFraction(
  employeeCounts,
  pmSprintMultiplier = 1
) {
  return (
    BALANCE.employees.projectManager.passiveBoostPerEmployee *
    (employeeCounts?.projectManager ?? 0) *
    pmSprintMultiplier
  );
}

/** The LOC/s the Project Manager boost contributes at a 1x Sprint:
 * the boost fraction times the passive rate it scales. */
export function projectManagerBoostRate(employeeCounts, openSourceLevels) {
  return (
    projectManagerBoostFraction(employeeCounts) *
    baseLocPerSecond(employeeCounts) *
    (1 + passiveBonus(openSourceLevels))
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
 */
export function commitSpecialistClickBonus(
  employeeCounts,
  csSprintMultiplier = 1
) {
  return (
    BALANCE.employees.commitSpecialist.clickBonusPerEmployee *
    (employeeCounts?.commitSpecialist ?? 0) *
    csSprintMultiplier
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
export function employeeBuffTypeRate(employeeType, employeeCounts, openSourceLevels) {
  if (employeeType === "projectManager") {
    return projectManagerBoostRate(employeeCounts, openSourceLevels);
  }
  if (employeeType === "commitSpecialist") {
    return 0;
  }
  return (
    BALANCE.employees[employeeType].locPerSecond *
    (employeeCounts?.[employeeType] ?? 0) *
    (1 + passiveBonus(openSourceLevels)) *
    (1 + projectManagerBoostFraction(employeeCounts))
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
 */
export function locPerSecond(employeeCounts, openSourceLevels) {
  return Math.floor(
    baseLocPerSecond(employeeCounts) *
      (1 + passiveBonus(openSourceLevels)) *
      (1 + projectManagerBoostFraction(employeeCounts))
  );
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
});

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
  employeeCounts = null
) {
  let multiplier = 1;
  for (const buff of activeStarEffects ?? []) {
    if (buff.expiresAtMs <= nowMs) continue;
    if (buff.effect === "frenzy") {
      multiplier *= buff.multiplier;
    } else if (
      buff.effect === "employee" &&
      buff.employeeType === employeeType
    ) {
      multiplier *= buff.multiplier;
    }
  }
  if (employeeCounts) {
    multiplier *= 1 + projectManagerBoostFraction(employeeCounts);
  }
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
      const parts = [];
      if (claim.locDelta !== 0)
        parts.push(`+${formatNumber(claim.locDelta)} LOC`);
      if (claim.moneyDelta !== 0)
        parts.push(`+${formatMoney(claim.moneyDelta)}`);
      return parts.join(" ");
    }
    case "frenzy":
      return `Production ${claim.multiplier}x`;
    case "click":
      return `Clicks ${claim.multiplier}x`;
    case "employee": {
      const typeName = employeeTypeName ?? claim.employeeType;
      return `${typeName}s ${claim.multiplier}x productivity`;
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
      `yet. They want to see a bigger operation first.\n\n` +
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
      `newcomers. They want to see a track record first.\n\n` +
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
      `Keep contributing. The next version has your name on it. Figuratively.`,
  };
}

/**
 * A golden star was claimed. The subject is the benefit or debuff
 * (`effectName: rewardText`, e.g. "Airdrop: +500 LOC"), so the inbox
 * list shows what the star did at a glance. `effectName` is the
 * locked pun name (Airdrop, Rug Pull, ...), `rewardText` is the
 * starRewardDetail string, and `good` picks the sign-off.
 */
export function buildStarRewardEmail({ effectName, rewardText, good }) {
  return {
    sender: "GitNub",
    subject: `${effectName}: ${rewardText}`,
    body: good
      ? "The GitNub sky provides. Mostly."
      : "The GitNub sky giveth, and the GitNub sky taketh away.",
  };
}

/** The llama farm was bought — the barn opens empty. */
export function buildFarmPurchasedEmail() {
  return {
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
      `breed. The llamas generate no cash yet. They generate vibes.`,
  };
}

/** A brand-new llama type was discovered by breeding. */
export function buildFarmNewTypeEmail({ typeName, typeDescription }) {
  return {
    sender: "Your Team",
    subject: `A ${typeName} was born!`,
    body:
      `One of the llamas had a kid, and it is not like the others. ` +
      `Meet the ${typeName}.\n\n` +
      `${typeDescription}\n\n` +
      `Keep breeding. There are more types out there, and the barn ` +
      `only gets weirder from here.`,
  };
}
