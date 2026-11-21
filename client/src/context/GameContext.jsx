import {
  useReducer,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";

// Server-authoritative saves (Slice 2, guest-only). The engine is
// framework-free; the provider owns it because it owns the reducer state
// the engine reads and restores.
import { serverNowMs } from "../save/serverClock.js";
import { SaveSync } from "../save/saveSync.js";
import { saveStateToGameFields } from "../save/serialize.js";
// Tap-latency diagnostics (PR #101): the instrument that records slow
// Commit taps so a "taps don't register" report can be diagnosed from
// evidence. Framework-free like SaveSync; the provider owns it.
import {
  TapDiagnostics,
  goldenStarOnScreen,
} from "../save/tapDiagnostics.js";

// Shared balance numbers — the reducer uses them for bulk pricing
// (BUY_EMPLOYEE). Display configs live in gameConfig.js.
import * as shared from "../../../shared/game-balance.js";

// Game configs (immutable display + balance data) and pure helpers.
// Configs and helpers live in their own modules so this file only
// exports the context object and the provider component (react-refresh).
import {
  GAME_BALANCE_CONFIG,
  NAV_TABS,
  EMPLOYEE_CONFIGS,
  FREELANCE_PROJECTS_CONFIG,
  OPEN_SOURCE_PROJECTS_CONFIG,
} from "./gameConfig.js";
import {
  calculateLOCPerClick,
  calculateCPS,
  calculateLOCPerSecond,
  getBaseLocPerSecond,
  achievementContext,
  isEmployeeUnlocked,
  isOpenSourceProjectUnlocked,
  isFreelanceProjectUnlocked,
  isFarmUnlockMet,
  flatEmployeeCounts,
  flatOpenSourceLevels,
  getReleaseManagerEconomics,
} from "./gameLogic.js";
import {
  addEmail,
  collectTriggerEmails,
  deleteEmail,
  markAllEmailsRead,
  markEmailRead,
} from "../email/email.js";
import {
  NO_HIGHLIGHT,
  clearHighlight,
  consumeHighlight,
  navigateToTarget,
} from "../navigation/highlight.js";
import { GameContext } from "./gameContext.js";
import { applyLlamaBuy } from "../utils/llamaShop.js";
import { isActionBlockedDuringIntermission } from "./intermissionGate.js";
import { nextAutoShipPulse } from "../utils/shipFeel.js";
import {
  DEFAULT_SIDE_PANES,
  DESKTOP_START_SECTION,
  SIDE_PANES_STORAGE_KEY,
  chooseSectionForPane,
  isSectionOnScreen,
  normalizeCenter,
  readSidePanes,
  setLayoutMode,
  showSection,
} from "../navigation/panes.js";
import {
  STAT_GAIN_NEVER_ACTIONS,
  nextStatGain,
  statGainFlags,
} from "../utils/statGain.js";

// Initial state of the game
// All monetary values are in CENTS to avoid floating-point errors
// Initial values are derived from GAME_BALANCE_CONFIG
const initialState = {
  // Core currencies
  linesOfCode: GAME_BALANCE_CONFIG.STARTING_LOC,
  totalLinesOfCode: 0, // cumulative LOC written over time, never decreases
  money: GAME_BALANCE_CONFIG.STARTING_MONEY,
  // Prestige (Sell the Company, Slice 1). Lifetime LOC is
  // totalLinesOfCode above; these are the Equity books. Saved with
  // the game state (see serialize.js); a save from before prestige
  // shipped backfills them to 0/null on load.
  lifetimeEquityEarned: 0,
  equitySpent: 0,
  saleCount: 0,
  lifetimeLocAtLastSale: 0,
  lastSaleId: null,
  // Permanent store (Slice 2). The store ranks (persist across
  // sales), the post-sale intermission with its frozen Starting
  // Capital quote (null outside a sale), and the favorited
  // open-source projects. Saved with the game state (see
  // serialize.js); a save from before the store shipped backfills
  // them to all-zero / null / empty on load.
  permanentStoreRanks: shared.zeroStoreRanks(),
  prestigeIntermission: null,
  favoriteOpenSourceProjects: [],
  // SUBTRACTERALL (issue #150). Phase, remaining credited seconds,
  // the per-company use count, and the use number of the active
  // phase. Saved with the game state; a save from before the rework
  // loads as a fresh Ready state (no migration). The
  // Overtime reskin is a setting (a text/framing layer, never a
  // separate mechanic) that persists across sales.
  subtracterall: shared.zeroSubtracterallState(),
  overtimeReskin: false,
  // Night Shift (issue #149): the purchased offline-production level
  // (0..5). Company-local; settled by the server on load.
  nightShiftLevel: 0,
  // Achievements (issue #132): tier state and the lifetime counters
  // the achievements read (hires per type, clicks, peak LOC/s, llamas
  // bought and sold). Saved with the game state; a save without it
  // restores a fresh record. Evaluated after every game action (see
  // withAchievements), and the tiers earned are a permanent LOC buff
  // (shared.buffedLocMultiplier).
  achievements: shared.zeroAchievementsState(),
  // The focus section: the one mobile pane, and the desktop center
  // pane (issue #174). On desktop it is never a side pane's section.
  activeTab: "shop",
  // Choosable panes (issue #174): the two pinned desktop side panes,
  // a device preference (localStorage grq:sidePanes, read at start by
  // initGameState), never saved. layoutMode is "desktop" or "mobile",
  // set from App's media query (SET_LAYOUT_MODE). See navigation/panes.js.
  sidePanes: { ...DEFAULT_SIDE_PANES },
  layoutMode: "mobile",
  // Click tracking for CPS calculation
  clickHistory: [], // Array of timestamps: [{ timestamp: Date.now(), count: 1 }, ...]
  currentCPS: 0, // Cached CPS for display

  // Permanent unlock tracking (the latch)
  // Dynamically generated: employees with no unlock conditions start unlocked,
  // employees with conditions start locked
  unlockedEmployees: Object.keys(EMPLOYEE_CONFIGS).reduce((acc, key) => {
    const config = EMPLOYEE_CONFIGS[key];
    acc[key] = !config.unlockConditions || config.unlockConditions.length === 0;
    return acc;
  }, {}),

  // Employees (count only - config comes from EMPLOYEE_CONFIGS)
  employees: Object.keys(EMPLOYEE_CONFIGS).reduce((acc, key) => {
    acc[key] = { count: 0 };
    return acc;
  }, {}),

  // AI Assistants (count only - config comes from AI_ASSISTANT_CONFIGS)
  aiAssistants: {
    // eventually these will be populated from AI_ASSISTANT_CONFIGS
    // dynamically, but for now, for testing, we hard code
    noPilot: { count: 0 },
  },

  freelanceProjectsCompleted: Object.keys(FREELANCE_PROJECTS_CONFIG).reduce(
    (acc, key) => {
      acc[key] = 0;
      return acc;
    },
    {}
  ),
  // Release Manager assignments (issue: auto-ships). A count per
  // freelance project: how many Release Managers are assigned to
  // ship that project. The sum is at most the owned Release Manager
  // count; the rest are unassigned and do nothing. Saved with the
  // game state. The cumulative auto-ship counts (how many of each
  // project the managers have shipped) are saved too — the save
  // engine derives actions.autoShips from their delta, so the server
  // can rate-cap auto-ships.
  releaseManagerAssignments: Object.keys(FREELANCE_PROJECTS_CONFIG).reduce(
    (acc, key) => {
      acc[key] = 0;
      return acc;
    },
    {}
  ),
  autoShipsCompleted: Object.keys(FREELANCE_PROJECTS_CONFIG).reduce(
    (acc, key) => {
      acc[key] = 0;
      return acc;
    },
    {}
  ),
  // Transient auto-ship clock (not saved): counts GAME_TICKs toward
  // the next auto-ship, which runs every
  // RELEASE_MANAGER_CONFIG.shipIntervalSeconds ticks. Resets on load
  // (like farmBreedTicks) — the first ship after a load is a full
  // interval away, never instant.
  releaseManagerShipTicks: 0,
  openSourceProjects: Object.keys(OPEN_SOURCE_PROJECTS_CONFIG).reduce(
    (acc, key) => {
      acc[key] = { level: 0 };
      return acc;
    },
    {}
  ),
  unlockedOpenSourceProjects: Object.keys(OPEN_SOURCE_PROJECTS_CONFIG).reduce(
    (acc, key) => {
      const config = OPEN_SOURCE_PROJECTS_CONFIG[key];
      // Only unlocked if NO conditions, otherwise starts locked
      acc[key] =
        !config.unlockConditions || config.unlockConditions.length === 0;
      return acc;
    },
    {}
  ),
  // Freelance project unlock latch (issue #19). Same pattern as the
  // other two latches: projects with no unlock conditions (the To Do
  // List App) start unlocked, the rest start locked.
  unlockedFreelanceProjects: Object.keys(FREELANCE_PROJECTS_CONFIG).reduce(
    (acc, key) => {
      const config = FREELANCE_PROJECTS_CONFIG[key];
      acc[key] =
        !config.unlockConditions || config.unlockConditions.length === 0;
      return acc;
    },
    {}
  ),

  // Timed golden-star buffs (issue #33). Each entry is
  // { effect, multiplier, expiresAtMs, employeeType }. Saved with the
  // game state, so a buff live at save time is still live on load.
  // Expired entries are dropped by the GAME_TICK.
  activeStarEffects: [],

  // Golden-star schedule (client-rolled now). nextStarAtMs is the
  // wall-clock time the next natural star is due (null = no star
  // scheduled, e.g. Constellation level 0); lastStarBuyAtMs is the
  // wall-clock time the last StarBroker star was bought (null = never
  // bought; the buy cooldown runs from it). Both are saved with the
  // game state, so the countdown and the cooldown survive a reload.
  nextStarAtMs: null,
  lastStarBuyAtMs: null,

  // In-game inbox (issue #31). Plain records, owned by the email
  // module (client/src/email/email.js). Saved with the game state.
  emails: [],
  // Cosmetics (issue #11). unlockedCosmetics is the list of
  // cosmeticIds the player has earned (hire-count triggers); it only
  // grows. equippedCosmetics maps a cosmetic slot to the equipped
  // cosmeticId. Saved with the game state.
  unlockedCosmetics: [],
  equippedCosmetics: {},
  // Llama farm (issue #79). The farm state (owned, stalls, unlocked
  // types) is saved with the game state; farmBreedTicks and
  // farmBreedDue are transient (not saved) — farmBreedTicks counts
  // GAME_TICKs toward the next breeding check, which runs every
  // FARM_CONFIG.breedingTickSeconds, and farmBreedDue is set when a
  // check is due so the provider's breed effect rolls it locally
  // (shared.rollFarmBreeding, the same odds the server used) and
  // dispatches FARM_BREED_RESULT. The roll is client-side now — the
  // server never sees a breed, only the kids in the next save.
  farm: shared.emptyFarmState(),
  farmBreedTicks: 0,
  farmBreedDue: false,
  // The email currently open in the Email tab (transient UI state, not saved).
  selectedEmailId: null,
  // The email the notification bar is showing (transient UI state, not saved).
  emailNotification: null,
  // Email deep links (issue #173): the card a followed link should
  // scroll to and flash ({ tab, itemId, key }), consumed once by its
  // HighlightAnchor; highlightSeq numbers the navigations. Transient
  // UI state, not saved (see navigation/highlight.js).
  highlightTarget: NO_HIGHLIGHT,
  highlightSeq: 0,

  uiState: {
    sections: {
      shop: { isDescriptionVisible: true },
      projects: { isDescriptionVisible: true },
      openSource: { isDescriptionVisible: true },
      farm: { isDescriptionVisible: true },
      settings: { isDescriptionVisible: true },
      email: { isDescriptionVisible: true },
      achievements: { isDescriptionVisible: true },
    },
  },
};

/**
 * Ship While It's Hot and Viral Load (issue #157): projects shipped
 * while a Hype Train (the GOOD hype buff) is live count toward
 * hypeShips, and what they paid (the boost included) toward
 * hypeCashCents. A Derailment ship counts toward neither. Manual ships
 * and Release Manager auto-ships both come through here. Nothing
 * shipped returns the record untouched.
 */
function recordHypeShips(state, ships, cashCents) {
  if (!(ships > 0)) return state.achievements;
  const hype = shared.hypePayoutMultiplier(state.activeStarEffects ?? []);
  if (!shared.starBuffIsGood({ effect: "hype", multiplier: hype })) {
    return state.achievements;
  }
  return shared.recordStarStat(
    shared.recordStarStat(state.achievements, "hypeShips", ships),
    "hypeCashCents",
    cashCents
  );
}

/**
 * Opening the Farm tab clears its birth badge (issue #204): when a tab
 * change lands on the farm, unseenBirths goes to 0. Any other tab, or a
 * state with no farm, is returned unchanged.
 */
function withFarmVisit(state) {
  // Issue #174: the Farm counts as visited wherever it is on screen
  // (the center, a desktop side pane, or the one mobile pane).
  if (!isSectionOnScreen(state, "farm") || !state.farm) return state;
  const farm = shared.farmSeen(state.farm);
  return farm === state.farm ? state : { ...state, farm };
}

function gameReducer(state, action) {
  // Store-only intermission (issue #188): while the post-sale
  // intermission is open, every game action is inert (no tick, click,
  // hire, ship, contribute or buy). Only adopting a server state and
  // pure view preferences run. See context/intermissionGate.js.
  if (isActionBlockedDuringIntermission(state, action)) {
    return state;
  }
  switch (action.type) {
    // Player changes active tab (shop, projects, or openSource)
    case "SET_ACTIVE_TAB": {
      const { tab } = action.payload;
      const validTabs = NAV_TABS.map((t) => t.id);
      const activeTab = validTabs.includes(tab) ? tab : "shop";
      if (!validTabs.includes(tab)) {
        console.warn(`Invalid tab: ${tab}. Defaulting to shop.`);
      }
      // A manual tab switch drops any highlight no card picked up, so
      // it cannot flash by surprise later (issue #173). Then the nav's
      // one rule (issue #174, showSection): on desktop a section already
      // on screen never moves (a side pane's bar flashes), an off-screen
      // one opens in the center. Opening the Farm clears its birth
      // badge (issue #204).
      return withFarmVisit(showSection(clearHighlight(state), activeTab));
    }

    // Choosable panes (issue #174): the media query changed. Payload:
    // { mode: "desktop" | "mobile" }. Turning desktop moves a center
    // that collides with a side pane to the first free section.
    case "SET_LAYOUT_MODE": {
      return withFarmVisit(setLayoutMode(state, action.payload?.mode));
    }

    // Choosable panes (issue #174): the pane picker. Payload:
    // { pane: "left" | "center" | "right", sectionId }. A section open
    // in another pane swaps with this pane's; any pending highlight is
    // dropped. Desktop only.
    case "CHOOSE_PANE_SECTION": {
      return withFarmVisit(
        chooseSectionForPane(state, action.payload?.pane, action.payload?.sectionId)
      );
    }

    // Follow an email link (issue #173): switch to the target's tab
    // and record the highlight its card consumes. Payload: { target }.
    // A missing or malformed target is a no-op.
    case "NAVIGATE_TO_TARGET": {
      // An email link to the farm opens it, so it clears the badge too.
      return withFarmVisit(navigateToTarget(state, action.payload?.target));
    }

    // The linked card scrolled into view and flashed: clear the
    // target so it never flashes again. Payload: { key }.
    case "CONSUME_HIGHLIGHT": {
      return consumeHighlight(state, action.payload?.key);
    }
    // Player clicks the "Write Code" button
    case "WRITE_CODE": {
      // SUBTRACTERALL (issue #150): the click's healthy LOC (the
      // floored click total, all other modifiers included) is run
      // through the current phase. Burst credits 3x; withdrawal
      // credits floor(the use's withdrawal multiplier x the click);
      // ready credits the healthy click. A click never ends a phase.
      const healthyClick = calculateLOCPerClick(state);
      const clickResult = shared.subtracterallApplyClick(
        state.subtracterall ?? shared.zeroSubtracterallState(),
        healthyClick
      );
      const locPerClick = clickResult.credited;
      // Update click history for CPS calculation
      const newClickHistory = [...state.clickHistory, Date.now()];
      // Clean up old clicks (older than 10 seconds to save memory)
      // We are saving more than 1 second for history to allow players to choose
      // longer timeframes for CPS if desired in future features
      const cleanedHistory = newClickHistory.filter(
        (ts) => ts > Date.now() - 10000
      );
      // Build newState with all changes from this action
      const newState = {
        ...state,
        linesOfCode: state.linesOfCode + locPerClick,
        totalLinesOfCode: state.totalLinesOfCode + locPerClick,
        subtracterall: clickResult.state,
        // Achievements (issue #132): every manual commit counts.
        achievements: shared.recordClicks(state.achievements, 1),
        clickHistory: cleanedHistory,
        currentCPS: calculateCPS(cleanedHistory),
      };

      // Check for unlocks instantly (not waiting for GAME_TICK)
      // Writing code could trigger unlocks so we run both unlock checks
      const latched = {
        ...newState,
        unlockedEmployees: updateUnlockLatch(newState),
        unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
        unlockedFreelanceProjects:
          updateFreelanceProjectUnlockLatch(newState),
      };
      // Unlocks and new visibility send mail (issue #31).
      return withEmailTriggers(state, latched);
    }
    // Buy employee(s) (intern, junior, or senior). `quantity` is the
    // bulk-buy amount from the Shop selector (default 1). The total
    // cost is the sum of the next `quantity` individual costs — each
    // successive hire costs more — computed by the same shared helper
    // the save server uses for money accounting (rule 7), so the
    // displayed price and the charged price can never disagree.
    case "BUY_EMPLOYEE": {
      const { employeeType, quantity = 1 } = action.payload;
      const config = EMPLOYEE_CONFIGS[employeeType];
      const employee = state.employees[employeeType];

      // Validate employee type exists
      if (!config || !employee) {
        console.warn(`Unknown employee type: ${employeeType}`);
        return state;
      }
      // Check if employee is unlocked
      if (!isEmployeeUnlocked(employeeType, state)) {
        console.warn(`Attempted to buy locked employee: ${employeeType}`);
        return state;
      }

      // Total cost for `quantity` hires, starting from the owned count:
      // the shared helper the card shows and the Cheapest sort uses.
      // A live AGI / Union Drive (issue #157) multiplies each hire
      // inside the shared employeeCost, threaded through that helper.
      const hireEffects = { activeStarEffects: state.activeStarEffects ?? [] };
      const totalCost = shared.employeeBulkCost(
        employeeType,
        employee.count,
        quantity,
        hireEffects
      );
      // Fire Sale, Hire Sale (issue #157): hires made while AGI is live.
      const agiLive = shared.starBuffIsGood({
        effect: "hiring",
        multiplier: shared.hiringCostMultiplier(hireEffects.activeStarEffects),
      });

      // Check if player has enough money, if so run the purchase
      if (state.money >= totalCost) {
        // Build newState with all changes from this action
        const newState = {
          ...state,
          money: state.money - totalCost,
          employees: {
            ...state.employees,
            [employeeType]: {
              ...employee,
              count: employee.count + quantity,
            },
          },
          // Achievements (issue #132): lifetime hires per type. A bulk
          // buy counts every hire in it.
          achievements: shared.recordStarStat(
            shared.recordHires(state.achievements, employeeType, quantity),
            "agiHires",
            agiLive ? quantity : 0
          ),
          // Cosmetics (issue #11): a hire can cross a cosmetic's
          // hire-count trigger — threshold-crossing, so a bulk buy
          // that jumps past a trigger still unlocks it. Only
          // cosmetics the player does not already have are added.
          unlockedCosmetics: [
            ...(state.unlockedCosmetics ?? []),
            ...shared
              .newlyUnlockedCosmetics(
                employeeType,
                employee.count,
                employee.count + quantity
              )
              .filter(
                (cosmeticId) =>
                  !(state.unlockedCosmetics ?? []).includes(cosmeticId)
              ),
          ],
        };

        // Check for unlocks instantly (buying changed employee count)
        const latched = {
          ...newState,
          unlockedEmployees: updateUnlockLatch(newState),
          unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
          unlockedFreelanceProjects:
            updateFreelanceProjectUnlockLatch(newState),
        };
        // Unlocks and new visibility send mail (issue #31).
        return withEmailTriggers(state, latched);
      }

      return state;
    }

    // Assign Release Managers to a freelance project (auto-ships).
    // Payload: { projectKey, count } — the NEW count of managers
    // assigned to that project (not a delta). The assignment is a
    // strategy choice: park managers on the efficient small project
    // and they hammer it on a timer. Rules, enforced here and by the
    // server: the project must exist and be unlocked (the UI only
    // offers unlocked projects); the count must be a non-negative
    // integer; and the total assigned across all projects cannot
    // exceed the managers owned — the rest are unassigned and do
    // nothing. Assignments change freely, so there is no monotonic
    // constraint. An assignment change is a big-action save trigger
    // (see serialize.js), so it persists promptly. An invalid
    // assignment is ignored here; the server rejects it too.
    case "SET_RELEASE_MANAGER_ASSIGNMENT": {
      const { projectKey, count } = action.payload ?? {};
      const project = FREELANCE_PROJECTS_CONFIG[projectKey];
      if (!project) return state;
      if (!isFreelanceProjectUnlocked(projectKey, state)) return state;
      if (
        typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 0
      ) {
        return state;
      }
      const assignments = {
        ...(state.releaseManagerAssignments ?? {}),
      };
      const oldCount = assignments[projectKey] ?? 0;
      const totalAssigned = Object.values(assignments).reduce(
        (sum, n) => sum + (n ?? 0),
        0
      );
      const owned = state.employees.releaseManager?.count ?? 0;
      if (totalAssigned - oldCount + count > owned) return state;
      assignments[projectKey] = count;
      return { ...state, releaseManagerAssignments: assignments };
    }

    // Equip (or unequip) a cosmetic in a slot (issue #11).
    // Payload: { slot, cosmeticId } — cosmeticId null means unequip,
    // back to the default icon. The equip is validated against the
    // shared rule (shared.canEquipCosmetic): the cosmetic must exist,
    // belong to that slot, and be unlocked. An invalid equip is
    // ignored here (the server rejects it too, so a tampered save
    // cannot equip what it has not earned). A valid equip is a
    // big-action save trigger (see serialize.js), so it persists
    // promptly.
    case "EQUIP_COSMETIC": {
      const { slot, cosmeticId } = action.payload ?? {};
      if (
        typeof slot !== "string" ||
        !shared.canEquipCosmetic(
          slot,
          cosmeticId ?? null,
          state.unlockedCosmetics ?? []
        )
      ) {
        return state;
      }
      const equippedCosmetics = { ...(state.equippedCosmetics ?? {}) };
      if (cosmeticId === null || cosmeticId === undefined) {
        delete equippedCosmetics[slot];
      } else {
        equippedCosmetics[slot] = cosmeticId;
      }
      return { ...state, equippedCosmetics };
    }

    // Buy the llama farm (issue #79). A one-time money purchase: the
    // money is the gate, the farm has no unlock condition in v1. The
    // barn arrives EMPTY — no free llamas (issue #79 feedback); buy
    // base llamas with BUY_LLAMA to move in. It is a big-action save
    // trigger (see serialize.js), so the purchase persists promptly. A
    // second buy (already owned) or an unaffordable buy is ignored
    // here; the server rejects it too, so a tampered save cannot buy
    // the farm twice or for free.
    case "BUY_FARM": {
      const farm = state.farm ?? shared.emptyFarmState();
      if (farm.owned) return state;
      // The barn is locked until 10 Senior Developers are on payroll
      // (FARM_CONFIG.unlockConditions). The Farm tab disables the
      // button; this is the second line of defence.
      if (!isFarmUnlockMet(state)) return state;
      // Llama economy v2 (issue #129): the barn costs 3 minutes of
      // production at the player's BUFFED LOC/s, priced right now.
      const barnCost = shared.farmPurchaseCostCents(getBaseLocPerSecond(state));
      if (state.money < barnCost) return state;
      const newState = {
        ...state,
        money: state.money - barnCost,
        farm: shared.initialFarmState(),
      };
      const latched = {
        ...newState,
        unlockedEmployees: updateUnlockLatch(newState),
        unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
        unlockedFreelanceProjects:
          updateFreelanceProjectUnlockLatch(newState),
      };
      return withEmailTriggers(state, latched);
    }

    // Set a barn stall's lighting (mood) color (issue #79). Payload:
    // { stallIndex, lighting }. The lighting is a free choice — it
    // switches freely, like an equipped cosmetic — and the empty
    // stall's own lighting sets the breeding odds for a kid appearing
    // there. An unknown stall or color is ignored here; the server
    // rejects it too. A lighting change is a big-action save trigger
    // (see serialize.js), so it persists promptly.
    case "SET_STALL_LIGHTING": {
      const { stallIndex, lighting } = action.payload ?? {};
      const farm = state.farm ?? shared.emptyFarmState();
      if (
        typeof stallIndex !== "number" ||
        stallIndex < 0 ||
        stallIndex >= shared.FARM_CONFIG.stallCount ||
        !shared.FARM_LIGHTING_COLORS.includes(lighting)
      ) {
        return state;
      }
      const stalls = farm.stalls.map((stall, i) =>
        i === stallIndex ? { ...stall, lighting } : stall
      );
      return { ...state, farm: { ...farm, stalls } };
    }

    // Buy one llama into an empty stall (issue #79 feedback — no free
    // llamas, each llama is bought separately). Payload: { stallIndex,
    // type }. For sale: the base types, plus every bred type this farm
    // has discovered (shared.llamaShopTypes, issue #203); an
    // undiscovered bred type comes only from breeding. The farm must
    // be owned, the stall must be empty, and the player must afford
    // FARM_CONFIG.llamaPriceCents. Buying unlocks the type (a bought
    // Classic unlocks Classic) and is a big-action save trigger (the
    // farm llama count changes, see serialize.js), so it persists
    // promptly. An invalid buy is ignored here: not owned, an occupied
    // stall, too little cash, or a type that is not for sale.
    case "BUY_LLAMA": {
      const { stallIndex, type } = action.payload ?? {};
      const bought = applyLlamaBuy({
        farm: state.farm ?? shared.emptyFarmState(),
        money: state.money,
        stallIndex,
        type,
        buffedLocPerSec: getBaseLocPerSecond(state),
      });
      if (!bought) return state;
      const newState = {
        ...state,
        money: bought.money,
        farm: bought.farm,
        // Achievements (issue #132): lifetime llamas bought, per type.
        achievements: shared.recordLlamaBought(state.achievements, type, 1),
      };
      const latched = {
        ...newState,
        unlockedEmployees: updateUnlockLatch(newState),
        unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
        unlockedFreelanceProjects:
          updateFreelanceProjectUnlockLatch(newState),
      };
      return withEmailTriggers(state, latched);
    }

    // Sell the llama in a stall (issue #129). Payload: { stallIndex }.
    // A llama sells for half its CURRENT buy price (time at the
    // player's buffed LOC/s right now, never the price paid), so its
    // value rises as production rises. The stall empties and keeps its
    // lighting. The sale is recorded per type in the achievements
    // record (shared.recordLlamaSold): the server only lets a llama
    // leave the barn through a recorded sale. Bred types sell too;
    // that is the point of breeding them. An empty stall, an unowned
    // farm, or a bad index is ignored.
    case "SELL_LLAMA": {
      const { stallIndex } = action.payload ?? {};
      const farm = state.farm ?? shared.emptyFarmState();
      if (!farm.owned) return state;
      if (
        !Number.isInteger(stallIndex) ||
        stallIndex < 0 ||
        stallIndex >= shared.FARM_CONFIG.stallCount
      ) {
        return state;
      }
      const type = farm.stalls[stallIndex]?.llama ?? null;
      if (!type) return state;
      const value = shared.llamaSellPriceCents(type, getBaseLocPerSecond(state));
      if (!Number.isFinite(value) || value < 0) return state;
      const stalls = farm.stalls.map((entry, i) =>
        i === stallIndex ? { ...entry, llama: null } : entry
      );
      return {
        ...state,
        money: state.money + value,
        farm: { ...farm, stalls },
        achievements: shared.recordLlamaSold(state.achievements, type, 1),
      };
    }

    // Move a llama to an EMPTY stall (issue #129). Payload:
    // { fromIndex, toIndex }. Pure placement (shared.moveFarmLlama):
    // the llama moves, each stall keeps its own lighting. Moving is
    // free; it is how the player builds breeding nests. An invalid
    // move (occupied target, empty source, same stall) is ignored.
    case "MOVE_LLAMA": {
      const { fromIndex, toIndex } = action.payload ?? {};
      const moved = shared.moveFarmLlama(state.farm, fromIndex, toIndex);
      if (!moved) return state;
      return { ...state, farm: moved };
    }

    // Apply a locally-rolled breeding result (issue #79 feedback).
    // Payload: { kids } — the list of { stallIndex, type } the
    // provider's breed effect converted from the roll
    // (shared.farmKidsFromRoll). Placement lives in
    // shared.applyFarmBreedKids (pure, tested): a kid is placed only
    // if its stall is still empty (a llama bought into that stall
    // after the roll wins — the kid is then never born; the reducer
    // is the authority, so the roll and the state can never
    // disagree), and a malformed kids payload is treated as no kids
    // instead of throwing. New types join the unlocked list. The
    // farmBreedDue flag is cleared here: the next breeding check is
    // due after another breedingTickSeconds ticks. A payload with no
    // kids (a no-birth tick) just clears the flag.
    case "FARM_BREED_RESULT": {
      const farm = state.farm ?? shared.emptyFarmState();
      if (!farm.owned) return { ...state, farmBreedDue: false };
      const newState = {
        ...state,
        // Issue #204: the placed kids count toward the Farm tab badge,
        // except while the player is on the Farm tab watching them.
        farm: shared.applyFarmBirths(farm, action.payload?.kids, {
          watching: isSectionOnScreen(state, "farm"),
        }),
        farmBreedDue: false,
      };
      const latched = {
        ...newState,
        unlockedEmployees: updateUnlockLatch(newState),
        unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
        unlockedFreelanceProjects:
          updateFreelanceProjectUnlockLatch(newState),
      };
      return withEmailTriggers(state, latched);
    }

    // Handle freelance project completion
    case "COMPLETE_PROJECT": {
      // deconstruct projectKey and get project data from config
      const { projectKey } = action.payload;
      const project = FREELANCE_PROJECTS_CONFIG[projectKey];

      // Validate project exists
      if (!project) {
        console.warn(`Unknown project key: ${projectKey}`);
        return state;
      }

      // Check if project is unlocked (issue #19)
      if (!isFreelanceProjectUnlocked(projectKey, state)) {
        console.warn(`Attempted to complete locked project: ${projectKey}`);
        return state;
      }

      // Check if player has enough LOC to complete the project if so, run completion
      if (state.linesOfCode >= project.loc) {
        // Permanent store (Slice 2): the Client Network rank
        // multiplies freelance cash payouts. Rounded to integer cents
        // (money is always whole cents). It never changes LOC costs
        // and does not affect Airdrops, investments, or other cash
        // sources — only the freelance ship reward, here and in the
        // Release Manager auto-ship below. One shared function
        // (issue #176), the same one the project cards display.
        // Hype Train / Derailment (issue #157) multiplies it too.
        const payout = shared.freelanceShipPayoutCents(
          projectKey,
          state.permanentStoreRanks ?? {},
          { activeStarEffects: state.activeStarEffects ?? [] }
        );
        const newState = {
          ...state,
          linesOfCode: state.linesOfCode - project.loc,
          money: state.money + payout,
          // Ship While It's Hot / Viral Load (issue #157).
          achievements: recordHypeShips(state, 1, payout),
          freelanceProjectsCompleted: {
            ...state.freelanceProjectsCompleted,
            // A save from before PR #78 shipped the four new projects
            // has no key for a never-shipped project; without the
            // fallback, `undefined + 1` is NaN, which poisons the count,
            // the unlock total, and the save (JSON turns NaN into null
            // and the server's isCountMap rejects it). Same pattern as
            // the auto-ship code below.
            [projectKey]: (state.freelanceProjectsCompleted[projectKey] ?? 0) + 1,
          },
        };

        // Shipping moves the counts the project unlocks are gated on,
        // so check for unlocks instantly (same as WRITE_CODE and
        // BUY_EMPLOYEE) — shipping the 50th To Do List App unlocks
        // the Hobby Website right here.
        const latched = {
          ...newState,
          unlockedEmployees: updateUnlockLatch(newState),
          unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
          unlockedFreelanceProjects:
            updateFreelanceProjectUnlockLatch(newState),
        };
        // Unlocks and new visibility send mail (issue #31).
        return withEmailTriggers(state, latched);
      } else {
        // Not enough LOC
        return state;
      }
    }

    // Game tick: called every second to generate LOC from employees
    case "GAME_TICK": {
      // SUBTRACTERALL (issue #150): the tick's healthy passive LOC
      // (the floored passive rate, star buffs included) is run
      // through the current phase over one credited second. Burst
      // credits 3x; withdrawal credits the use's withdrawal
      // multiplier (0.5 x 0.9^(n-1)); ready credits the healthy
      // rate. A phase ending mid-second splits it. The credited total is
      // floored to a whole LOC (a tick must never commit a fractional
      // amount) with the +1e-9 epsilon guard against float error —
      // the same function gameLogic.calculateTickCredit uses for the
      // floating-text amount, so the display and the balance can
      // never disagree. The phase timers advance in credited
      // seconds, never wall-clock: a player who closes the game
      // mid-phase comes back to the same phase with the same
      // remaining time.
      const healthyPassiveLOC = calculateLOCPerSecond(state);
      const subResult = shared.advanceSubtracterall(
        state.subtracterall ?? shared.zeroSubtracterallState(),
        healthyPassiveLOC,
        1
      );
      const totalPassiveLOC = Math.floor(subResult.credited + 1e-9);
      const cleanedHistory = state.clickHistory.filter(
        (ts) => ts > Date.now() - 10000
      );
      // Drop golden-star buffs that have expired (their expiry is also
      // checked by activeStarBuff, so a buff never applies past its end).
      const now = Date.now();
      const activeStarEffects = (state.activeStarEffects ?? []).filter(
        (buff) => buff.expiresAtMs > now
      );

      // Llama farm breeding (issue #79 feedback): every
      // FARM_CONFIG.breedingTickSeconds ticks, a breeding check is due.
      // The ROLL is client-side now (shared.rollFarmBreeding) — the
      // reducer only counts the ticks and raises the farmBreedDue flag,
      // and the provider's breed effect rolls the kids and dispatches
      // FARM_BREED_RESULT with them. The server just stores the kids
      // inside the ordinary save payload.
      const farm = state.farm ?? shared.emptyFarmState();
      const breedTicks = (state.farmBreedTicks ?? 0) + 1;
      let nextBreedTicks = breedTicks;
      let farmBreedDue = state.farmBreedDue ?? false;
      if (
        farm.owned &&
        !farmBreedDue &&
        breedTicks >= shared.FARM_CONFIG.breedingTickSeconds
      ) {
        nextBreedTicks = 0;
        farmBreedDue = true;
      }

      // Release Manager auto-ships: every
      // RELEASE_MANAGER_CONFIG.shipIntervalSeconds ticks, each manager
      // assigned to a project ships one of it — if the player has
      // enough LOC for that project's cost at that moment. Managers
      // are processed in project-key order, one at a time, so the LOC
      // check sees each prior ship's deduction: if LOC runs out
      // mid-way, the remaining managers wait for the next interval.
      // A ship follows the same rules as a manual ship
      // (COMPLETE_PROJECT): the project must be unlocked, the LOC
      // cost is deducted, the money reward is credited, and both the
      // shipped count and the cumulative auto-ship count increase
      // (the save engine derives actions.autoShips from the
      // auto-ship delta, so the server can rate-cap them). The clock
      // resets on load (releaseManagerShipTicks starts at 0), so the
      // first ship after a load is a full interval away, never
      // instant. Star buffs do not change the timer. Ship Happens
      // (issue #118) doubles the ships per manager each level, so a
      // manager ships 2^L projects per interval at level L.
      const shipTicks = (state.releaseManagerShipTicks ?? 0) + 1;
      let nextShipTicks = shipTicks;
      let shipLinesOfCode = state.linesOfCode + totalPassiveLOC;
      let shipMoney = state.money;
      let shipCompleted = { ...state.freelanceProjectsCompleted };
      let shipAuto = { ...(state.autoShipsCompleted ?? {}) };
      // Hype stats (issue #157): auto-ships during a Hype Train count.
      let autoShipCount = 0;
      let autoShipCash = 0;
      const shipsPerManager = shared.releaseManagerShipsPerInterval(
        flatOpenSourceLevels(state)
      );
      if (
        shipTicks >= shared.RELEASE_MANAGER_CONFIG.shipIntervalSeconds
      ) {
        nextShipTicks = 0;
        for (const projectKey of Object.keys(FREELANCE_PROJECTS_CONFIG)) {
          const assigned =
            state.releaseManagerAssignments?.[projectKey] ?? 0;
          if (assigned <= 0) continue;
          if (!isFreelanceProjectUnlocked(projectKey, state)) continue;
          const project = FREELANCE_PROJECTS_CONFIG[projectKey];
          // Permanent store (Slice 2): the Client Network rank
          // multiplies freelance cash payouts, including auto-ships.
          // Integer cents per ship, from the same shared function the
          // manual Ship button and the project cards use (issue #176).
          const shipPayout = shared.freelanceShipPayoutCents(
            projectKey,
            state.permanentStoreRanks ?? {},
            { activeStarEffects: state.activeStarEffects ?? [] }
          );
          for (let i = 0; i < assigned * shipsPerManager; i++) {
            if (shipLinesOfCode < project.loc) break;
            shipLinesOfCode -= project.loc;
            shipMoney += shipPayout;
            autoShipCount += 1;
            autoShipCash += shipPayout;
            shipCompleted[projectKey] =
              (shipCompleted[projectKey] ?? 0) + 1;
            shipAuto[projectKey] = (shipAuto[projectKey] ?? 0) + 1;
          }
        }
      }

      // Build newState with all changes from this action
      const newState = {
        ...state,
        linesOfCode: shipLinesOfCode,
        totalLinesOfCode: state.totalLinesOfCode + totalPassiveLOC,
        money: shipMoney,
        freelanceProjectsCompleted: shipCompleted,
        autoShipsCompleted: shipAuto,
        // Issue #219: a tick that auto-shipped pulses the shipping
        // strip's Cash readout (no chip). Transient, never saved.
        autoShipPulse: nextAutoShipPulse(state.autoShipPulse, autoShipCount, Date.now()),
        achievements: recordHypeShips(state, autoShipCount, autoShipCash),
        clickHistory: cleanedHistory,
        currentCPS: calculateCPS(cleanedHistory),
        activeStarEffects,
        farm,
        farmBreedTicks: nextBreedTicks,
        farmBreedDue,
        releaseManagerShipTicks: nextShipTicks,
        // SUBTRACTERALL (issue #150): the advanced phase state (the
        // remaining time and any phase flip).
        subtracterall: subResult.state,
      };

      // Check for unlocks (same centralized helper as WRITE_CODE and BUY_EMPLOYEE)
      // Employees generating LOC could trigger unlocks
      const latched = {
        ...newState,
        unlockedEmployees: updateUnlockLatch(newState),
        unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
        unlockedFreelanceProjects:
          updateFreelanceProjectUnlockLatch(newState),
      };
      // Unlocks and new visibility send mail (issue #31).
      return withEmailTriggers(state, latched);
    }

    // contribute to open source project
    case "CONTRIBUTE_TO_PROJECT": {
      // deconstruct projectId from action payload
      const { projectId } = action.payload;
      // get project state (its costs come from the shared helper below)
      const projectState = state.openSourceProjects[projectId];

      // check if there is a next level the owned Funding Round allows
      // (issue #170): a gated track stops at the round's cap, and the
      // server rejects a save above it, so the buy is refused here.
      // Bridge Rounds (issue #192): the same helper lifts the gated
      // caps one round while this company owns its Bridge Round, caps
      // the Bridge Round itself at 1 (once per company), and at 0 from
      // Series B on.
      if (
        projectState.level >=
        shared.openSourceLevelCap(
          projectId,
          state.permanentStoreRanks,
          state.openSourceProjects
        )
      ) {
        return state; // at the cap, return state unchanged
      }

      // check if project is unlocked
      if (!isOpenSourceProjectUnlocked(projectId, state)) {
        console.warn(`Attempted to contribute to locked project: ${projectId}`);
        return state;
      }

      // The next level's LOC cost: the one shared helper the card
      // displays and the Cheapest sort orders by (issue #180).
      // The Bridge Round is priced by the owned round (issue #192).
      const cost = shared.openSourceNextLevelCost(
        projectId,
        projectState.level,
        state.permanentStoreRanks
      );
      if (cost === null) return state; // no next level defined
      // check if player has enough LOC to contribute
      if (state.linesOfCode < cost) {
        console.warn(`Not enough LOC to contribute to project: ${projectId}`);
        return state; // not enough LOC, return state unchanged
      }

      // deduct LOC cost and increase project level
      const contributed = {
        ...state,
        linesOfCode: state.linesOfCode - cost,
        openSourceProjects: {
          ...state.openSourceProjects,
          [projectId]: {
            ...projectState,
            level: projectState.level + 1,
          },
        },
      };
      // A new open-source level sends mail (issue #31).
      return withEmailTriggers(state, contributed);
    }

    // Favorite an open-source project (permanent store, Slice 2).
    // Payload: { projectId }. Toggles the project in
    // favoriteOpenSourceProjects: favoriting adds it, unfavoriting
    // removes it. Favorites sort first in the Open Source tab, and
    // survive a sale only when the Company Template rank is owned
    // (the server resets them otherwise). An unknown project id is
    // ignored — the list only ever holds real project ids. A
    // favorite change is a big action, so it saves promptly.
    case "FAVORITE_OPEN_SOURCE_PROJECT": {
      const { projectId } = action.payload ?? {};
      if (
        typeof projectId !== "string" ||
        !OPEN_SOURCE_PROJECTS_CONFIG[projectId]
      ) {
        return state;
      }
      const favorites = [...(state.favoriteOpenSourceProjects ?? [])];
      const index = favorites.indexOf(projectId);
      if (index >= 0) {
        favorites.splice(index, 1);
      } else {
        favorites.push(projectId);
      }
      return { ...state, favoriteOpenSourceProjects: favorites };
    }

    // Buy a golden star (StarBroker). The payload is the cost the
    // star UI validated client-side (30x passive LOC/s, flat at every
    // level): the client deducts it from its local LOC here, and
    // records when the buy happened — the buy cooldown runs from
    // lastStarBuyAtMs. The bought star itself is shown by the star UI
    // (GoldenStar), which owns the pending star's lifetime; this
    // action only moves the LOC and arms the cooldown. No unlock or
    // email triggers: spending LOC cannot unlock anything (unlocks read
    // totalLinesOfCode and counts, which do not move). Star clock
    // (issue #148): the buy time is SERVER-time ms. The star UI passes
    // the serverNowMs() reading it compares the cooldown against as
    // `atMs`; without one, the reducer reads the server clock itself.
    case "BUY_STAR": {
      const { cost, atMs } = action.payload ?? {};
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
        return state;
      }
      return {
        ...state,
        linesOfCode: Math.max(0, state.linesOfCode - cost),
        lastStarBuyAtMs:
          typeof atMs === "number" && Number.isFinite(atMs) && atMs >= 0
            ? atMs
            : serverNowMs(),
      };
    }

    // Set the next natural star's due time (client-rolled now).
    // Payload: { nextStarAtMs }: the SERVER-time ms (serverNowMs(),
    // issue #148) the next star is due, or null for no star scheduled (level 0).
    // The star UI rolls it (shared.rollNextStarAtMs) whenever the
    // schedule needs one: on load with no schedule, after a claim, and
    // after a despawn. It is a big-action field, so setting it saves
    // promptly and the countdown survives a reload.
    case "SET_NEXT_STAR_AT": {
      const { nextStarAtMs } = action.payload ?? {};
      const nextAt =
        nextStarAtMs === null ||
        (typeof nextStarAtMs === "number" &&
          Number.isFinite(nextStarAtMs) &&
          nextStarAtMs >= 0)
          ? nextStarAtMs
          : state.nextStarAtMs;
      return {
        ...state,
        nextStarAtMs: nextAt ?? null,
      };
    }

    // Activate SUBTRACTERALL (issue #150; "Take Dose", or "Mandate
    // Overtime" in the reskin). No payload. Activation happens only
    // when it is permanently unlocked (100,000 lifetime LOC), the
    // phase is Ready, and there is at least one employee with
    // positive healthy production (the healthy passive rate,
    // permanent bonuses included, temporary star multipliers
    // excluded). There is no use cap. A failed activation returns the
    // state unchanged: the card disables the button when it cannot
    // be used, and this is the second line of defence. Activating is
    // a big action (the phase flips ready -> burst and the use count
    // rises), so it saves promptly.
    case "ACTIVATE_SUBTRACTERALL": {
      const sub = shared.normalizeSubtracterallState(state.subtracterall);
      if (!shared.subtracterallUnlocked(state.totalLinesOfCode ?? 0)) {
        return state;
      }
      if (!shared.subtracterallCanActivate(sub, getBaseLocPerSecond(state))) {
        return state;
      }
      const next = shared.subtracterallActivate(sub);
      if (!next) return state;
      return { ...state, subtracterall: next };
    }

    // Buy the next Night Shift level (issue #149). No payload. The price
    // is TIME at current LOC/s: the level's minutes of production value
    // (B) at the buffed healthy rate, the same P the barn and llamas
    // price from. Bought only when the previous level is owned, the
    // gate holds (live P and a live employee count), and the cash
    // covers the price; otherwise the state is unchanged (the card
    // disables the button and says why, this is the second line of
    // defence). A big action, so it saves promptly.
    case "BUY_NIGHT_SHIFT_LEVEL": {
      const next = shared.nightShiftNextPurchase({
        level: state.nightShiftLevel,
        money: state.money,
        buffedLocPerSec: getBaseLocPerSecond(state),
        employeeCounts: flatEmployeeCounts(state),
      });
      if (!next || !next.canBuy) return state;
      return {
        ...state,
        money: Math.max(0, (state.money ?? 0) - next.priceCents),
        nightShiftLevel: next.level,
      };
    }

    // The server settled Night Shift on load (issue #149). Payload: the
    // load response's `nightShift` report. The server already filed the
    // report mail in the settled state (stored with the credit, so no
    // restore can lose it); this action points the new-mail
    // notification at it. If the mail is somehow missing it is filed
    // here, deduped by its trigger key, so it is never filed twice.
    case "NIGHT_SHIFT_REPORT": {
      const report = action.payload ?? null;
      if (!report || !(Number(report.creditedLoc) > 0)) return state;
      const triggerKey = report.triggerKey ?? `night-shift:${report.settledAt}`;
      let emails = state.emails ?? [];
      let mail = emails.find((entry) => entry.triggerKey === triggerKey);
      if (!mail) {
        const result = addEmail(
          emails,
          shared.buildNightShiftEmail(report),
          triggerKey,
          Date.now()
        );
        emails = result.emails;
        mail = result.added;
      }
      if (!mail) return state;
      return {
        ...state,
        emails,
        emailNotification:
          isSectionOnScreen(state, "email")
            ? state.emailNotification
            : { emailId: mail.id },
      };
    }

    // Toggle the Overtime reskin setting (Slice 3). Payload:
    // { enabled } — a boolean. The reskin is a text/framing layer
    // only: the same mechanics are framed as Overtime instead of
    // SUBTRACTERALL, and recovery is framed as a "wellness clinic"
    // visit instead of rehab. Toggling it is a big action, so it
    // saves promptly, and it persists across sales.
    case "SET_OVERTIME_RESKIN": {
      const { enabled } = action.payload ?? {};
      if (typeof enabled !== "boolean") return state;
      return { ...state, overtimeReskin: enabled };
    }

    // Apply a golden-star claim (issue #33). The payload is the claim
    // `resolveStarClaim` returns in shared/game-balance.js: instant
    // LOC/money deltas for Lucky / Shooting Stars, or a timed buff for
    // Frenzy / Click / Employee. The caller rolls the claim locally
    // (GoldenStar) and asks the save engine for a prompt save
    // (requestClaimSave) in the same handler, so the claim and the
    // state change can never disagree.
    // A Lucky loss lowers linesOfCode but not totalLinesOfCode (the
    // cumulative total never decreases). A timed buff replaces any live
    // buff of the same (effect, employeeType) — buffs never stack.
    case "APPLY_STAR_REWARD": {
      const { claim } = action.payload;
      if (!claim) return state;
      const newLinesOfCode = Math.max(0, state.linesOfCode + claim.locDelta);
      const newTotalLinesOfCode =
        claim.locDelta > 0
          ? state.totalLinesOfCode + claim.locDelta
          : state.totalLinesOfCode;
      const newMoney = Math.max(0, state.money + claim.moneyDelta);
      let activeStarEffects = state.activeStarEffects ?? [];
      if (claim.multiplier !== null && claim.durationSeconds) {
        const buff = {
          effect: claim.effect,
          multiplier: claim.multiplier,
          expiresAtMs: Date.now() + claim.durationSeconds * 1000,
          employeeType: claim.employeeType,
        };
        activeStarEffects = [
          ...activeStarEffects.filter(
            (entry) =>
              !(
                entry.effect === buff.effect &&
                entry.employeeType === buff.employeeType
              )
          ),
          buff,
        ];
      }
      // Moonshot (issue #165): every gold star click counts toward the
      // 25 that unlock Moonshot. Natural and bought gold stars count
      // (including a Shooting Stars star, chain click 1); red stars and
      // the later Shooting Stars chain clicks do not.
      const isGoldStarClick = !claim.red && !((claim.chainStep ?? 1) > 1);
      const newState = {
        ...state,
        linesOfCode: newLinesOfCode,
        totalLinesOfCode: newTotalLinesOfCode,
        money: newMoney,
        activeStarEffects,
        // Hype Springs Eternal, Artificial General Discount and
        // Collective Bargaining Chip count claims (issue #157).
        achievements: shared.recordStarClaimStats(
          isGoldStarClick
            ? shared.recordGoldStarClicks(state.achievements, 1)
            : state.achievements,
          claim
        ),
      };
      // A star reward can push total LOC past an unlock threshold, and
      // the reward itself sends mail (issue #31).
      const latched = {
        ...newState,
        unlockedEmployees: updateUnlockLatch(newState),
        unlockedOpenSourceProjects: updateOpenSourceUnlockLatch(newState),
        unlockedFreelanceProjects:
          updateFreelanceProjectUnlockLatch(newState),
      };
      return withEmailTriggers(state, latched, claim);
    }

    // A Shooting Stars chain ended (issue #138). Payload: { stars,
    // totalLoc, reason } from the star UI, which owns the transient
    // chain (it is never saved; a reload mid-chain just ends it). Every
    // chain click already paid its LOC through APPLY_STAR_REWARD; this
    // only sends the ONE summary email for the whole chain, under a
    // key unique to this chain. A malformed payload (NaN, negative, no
    // stars) sends nothing.
    case "SHOOTING_STARS_CHAIN_END": {
      const { stars, totalLoc, reason } = action.payload ?? {};
      if (
        !Number.isInteger(stars) ||
        stars < 1 ||
        typeof totalLoc !== "number" ||
        !Number.isFinite(totalLoc) ||
        totalLoc < 0
      ) {
        return state;
      }
      const { emails, added } = addEmail(
        state.emails,
        shared.buildShootingStarsChainEmail({ stars, totalLoc, reason }),
        `shooting-stars-chain:${Date.now()}`,
        Date.now()
      );
      if (!added) return state;
      return {
        ...state,
        emails,
        emailNotification:
          isSectionOnScreen(state, "email")
            ? state.emailNotification
            : { emailId: added.id },
      };
    }

    case "TOGGLE_SECTION_DESC_VISIBILITY": {
      const { sectionId } = action.payload;
      return {
        ...state,
        uiState: {
          ...state.uiState,
          sections: {
            ...state.uiState.sections,
            [sectionId]: {
              ...state.uiState.sections[sectionId],
              isDescriptionVisible:
                !state.uiState.sections[sectionId].isDescriptionVisible,
            },
          },
        },
      };
    }

    // Open an email (issue #31): go to the Email tab, expand the email,
    // and mark it read. The notification bar, if it was showing this
    // email, is cleared (the player is now looking at the mail).
    case "OPEN_EMAIL": {
      const { emailId } = action.payload;
      const email = (state.emails ?? []).find(
        (entry) => entry.id === emailId
      );
      if (!email) return state;
      return {
        // Issue #174: shown through the nav's one rule, so an inbox
        // pinned in a side pane opens the mail there.
        ...showSection(state, "email"),
        selectedEmailId: emailId,
        emails: markEmailRead(state.emails, emailId),
        emailNotification:
          state.emailNotification?.emailId === emailId
            ? null
            : state.emailNotification,
      };
    }

    // Collapse the open email back to the list.
    case "CLOSE_EMAIL": {
      return { ...state, selectedEmailId: null };
    }

    // Delete an email from the inbox (issue #31 inbox redesign):
    // remove it from state and return to the list. The unread badge
    // is derived from the inbox, so it drops automatically when the
    // deleted mail was unread. A delete is a big action (see
    // bigActionIncreased — any inbox count change saves), so the
    // removal persists on the next save, same as a new email arriving.
    // A notification pointing at the deleted mail is cleared too.
    case "DELETE_EMAIL": {
      const { emailId } = action.payload;
      if (!(state.emails ?? []).some((entry) => entry.id === emailId)) {
        return state;
      }
      return {
        ...state,
        emails: deleteEmail(state.emails, emailId),
        selectedEmailId:
          state.selectedEmailId === emailId ? null : state.selectedEmailId,
        emailNotification:
          state.emailNotification?.emailId === emailId
            ? null
            : state.emailNotification,
      };
    }

    // Dismiss the notification bar (X or swipe). The email stays unread
    // in the inbox until the player opens it.
    case "DISMISS_EMAIL_NOTIFICATION": {
      return { ...state, emailNotification: null };
    }

    // Mark every email read: the unread badge (derived from the inbox)
    // clears, and the notification bar goes away with it — the mail it
    // pointed at is read now. A read-state change is a big action (see
    // bigActionIncreased — the unread count is a big-action field), so
    // it saves promptly instead of waiting for the heartbeat.
    case "MARK_ALL_EMAILS_READ": {
      const emails = markAllEmailsRead(state.emails);
      if (emails === state.emails) return state;
      return {
        ...state,
        emails,
        emailNotification: null,
      };
    }

    // Restore the game fields from a server snapshot (initial load, or a
    // 409 revert to the last good state). UI state (active tab, panes) is
    // preserved; only the saved game fields are replaced. Click history is
    // display-only, so it resets.
    case "RESTORE_SAVE": {
      const { state: saveState } = action.payload;
      return {
        ...state,
        ...saveStateToGameFields(saveState),
        clickHistory: [],
        currentCPS: 0,
        // Transient email UI state is reset on restore: the selected /
        // notified email may not exist in the restored inbox (a 409
        // revert), so it must not linger.
        emailNotification: null,
        selectedEmailId: null,
        // The numbers react (issue #214): a load or restore is never a
        // gain, and clears any pending one.
        statGain: null,
        // Shipped (issue #219): a restore never pulses the Cash readout.
        autoShipPulse: null,
      };
    }

    // if action type doesn't make sense, just return current state
    default: {
      return state;
    }
  }
}

/**
 * Checks if a single unlock condition is satisfied by the current game state.
 *
 * This is a pure function (no side effects). It evaluates a condition
 * and returns whether it's met, without modifying state.
 *
 * Used internally by areUnlockConditionsMet(). NOT exported.
 *
 * @param {Object} condition - The condition to check
 * @param {string} condition.type - Type of condition (e.g., "TOTAL_LOC", "TOTAL_EMPLOYEE_COUNT", "SPECIFIC_EMPLOYEE_COUNT")
 * @param {number} condition.target - The threshold value
 * @param {Object} state - The game state to check against
 * @returns {boolean} True if condition is satisfied, false otherwise
 *
 * @private
 */
function checkCondition(condition, state) {
  // Shared evaluation, same as the save server's. Unknown condition types
  // fail closed (locked) — a config typo surfaces as a stuck unlock in
  // testing, never as a silent unlock to the wrong conditions.
  // The project-count conditions (issue #19) read the flat completion
  // counts, which the client state already stores in that shape.
  return shared.conditionMet(condition, {
    totalLinesOfCode: state.totalLinesOfCode,
    employees: flatEmployeeCounts(state),
    freelanceProjectsCompleted: state.freelanceProjectsCompleted,
    // Moonshot (issue #165): Open Source levels and the lifetime gold
    // star clicks, in the save shape conditionMet reads.
    openSourceProjects: flatOpenSourceLevels(state),
    achievements: state.achievements,
  });
}

/**
 * Checks if all unlock conditions for an employee type are currently satisfied.
 *
 * This function is called by updateUnlockLatch() to determine if an unlock
 * should be latched. It checks the actual game state against the unlock rules.
 *
 * Used internally by updateUnlockLatch(). NOT exported (components can't call this).
 * Components should call isEmployeeUnlocked() instead.
 *
 * @param {string} employeeType - The employee type to check (e.g., "intern", "junior", "senior")
 * @param {Object} state - The game state
 * @returns {boolean} True if all conditions are met, false otherwise
 *
 * @private
 */
function areUnlockConditionsMet(employeeType, state) {
  const config = EMPLOYEE_CONFIGS[employeeType];

  if (!config) {
    console.warn(`Unknown employee type: ${employeeType}`);
    return false;
  }

  // If no unlock conditions defined, employee is always unlocked
  if (!config.unlockConditions || config.unlockConditions.length === 0) {
    return true;
  }

  // ALL conditions must be met (AND logic)
  return config.unlockConditions.every((condition) =>
    checkCondition(condition, state)
  );
}

/**
 * Updates the unlock latch, checking if any new employees should be unlocked.
 *
 * This is the CENTRALIZED unlock logic. It's called from EVERY reducer case
 * that could trigger an unlock (WRITE_CODE, BUY_EMPLOYEE, GAME_TICK).
 *
 * This function takes the *new* state (with all action-specific changes applied)
 * and checks conditions against it. If any new unlocks should happen, it latches them.
 *
 * Returns the updated unlockedEmployees object to be merged into the final state.
 * If no new unlocks occurred, returns the original unlockedEmployees (to prevent
 * unnecessary re-renders from new object references).
 *
 * @param {Object} state - The NEW game state (after action changes have been applied)
 * @returns {Object} The updated unlockedEmployees object (or original if no changes)
 *
 * @private
 */
function updateUnlockLatch(state) {
  const newUnlockedEmployees = { ...state.unlockedEmployees };
  let hasNewUnlock = false;

  // Only check LOCKED employees for new unlocks. Once an employee is unlocked,
  // the latch is permanent and we never need to check them again.
  // This avoids unnecessary condition evaluations on every GAME_TICK, WRITE_CODE, and BUY_EMPLOYEE.
  const lockedEmployees = Object.keys(EMPLOYEE_CONFIGS).filter(
    (employeeType) => !state.unlockedEmployees[employeeType]
  );

  for (const employeeType of lockedEmployees) {
    // Conditions are now met, latch it
    if (areUnlockConditionsMet(employeeType, state)) {
      newUnlockedEmployees[employeeType] = true;
      hasNewUnlock = true;
    }
  }

  // Return updated object if new unlocks occurred, otherwise return original
  // (to prevent unnecessary re-renders from object reference changes)
  return hasNewUnlock ? newUnlockedEmployees : state.unlockedEmployees;
}
/**
 * Checks if all unlock conditions for an open source project are currently satisfied.
 *
 * @param {string} projectId - The project ID
 * @param {Object} state - The game state
 * @returns {boolean} True if all conditions are met, false otherwise
 *
 * @private
 */
function areOpenSourceUnlockConditionsMet(projectId, state) {
  const config = OPEN_SOURCE_PROJECTS_CONFIG[projectId];

  if (!config) {
    console.warn(`Unknown project ID: ${projectId}`);
    return false;
  }

  // If no unlock conditions defined, project is always unlocked
  if (!config.unlockConditions || config.unlockConditions.length === 0) {
    return true;
  }

  // ALL conditions must be met (AND logic)
  return config.unlockConditions.every((condition) =>
    checkCondition(condition, state)
  );
}

/**
 * Updates the unlock latch for open source projects, checking if any should be unlocked.
 *
 * Called from WRITE_CODE, BUY_EMPLOYEE, and GAME_TICK (same as employees).
 * Checks only LOCKED projects for new unlocks. Once unlocked, permanent.
 *
 * @param {Object} state - The NEW game state (after action changes)
 * @returns {Object} Updated unlockedOpenSourceProjects object (or original if no changes)
 *
 * @private
 */
function updateOpenSourceUnlockLatch(state) {
  const newUnlockedProjects = { ...state.unlockedOpenSourceProjects };
  let hasNewUnlock = false;

  // Only check LOCKED projects for new unlocks
  const lockedProjects = Object.keys(OPEN_SOURCE_PROJECTS_CONFIG).filter(
    (projectId) => !state.unlockedOpenSourceProjects[projectId]
  );

  for (const projectId of lockedProjects) {
    // Conditions are now met, latch it
    if (areOpenSourceUnlockConditionsMet(projectId, state)) {
      newUnlockedProjects[projectId] = true;
      hasNewUnlock = true;
    }
  }

  // Return updated object if new unlocks occurred, otherwise return original
  return hasNewUnlock ? newUnlockedProjects : state.unlockedOpenSourceProjects;
}

/**
 * Checks if all unlock conditions for a freelance project are currently satisfied.
 *
 * @param {string} projectKey - The project key
 * @param {Object} state - The game state
 * @returns {boolean} True if all conditions are met, false otherwise
 *
 * @private
 */
function areFreelanceProjectUnlockConditionsMet(projectKey, state) {
  const config = FREELANCE_PROJECTS_CONFIG[projectKey];

  if (!config) {
    console.warn(`Unknown project key: ${projectKey}`);
    return false;
  }

  // If no unlock conditions defined, project is always unlocked
  if (!config.unlockConditions || config.unlockConditions.length === 0) {
    return true;
  }

  // ALL conditions must be met (AND logic)
  return config.unlockConditions.every((condition) =>
    checkCondition(condition, state)
  );
}

/**
 * Updates the unlock latch for freelance projects, checking if any should be unlocked.
 *
 * Called from WRITE_CODE, BUY_EMPLOYEE, GAME_TICK, APPLY_STAR_REWARD —
 * and COMPLETE_PROJECT, which is the one action that moves the
 * shipped counts the project unlocks are gated on. Checks only LOCKED
 * projects for new unlocks. Once unlocked, permanent.
 *
 * @param {Object} state - The NEW game state (after action changes)
 * @returns {Object} Updated unlockedFreelanceProjects object (or original if no changes)
 *
 * @private
 */
function updateFreelanceProjectUnlockLatch(state) {
  const newUnlockedProjects = { ...state.unlockedFreelanceProjects };
  let hasNewUnlock = false;

  // Only check LOCKED projects for new unlocks
  const lockedProjects = Object.keys(FREELANCE_PROJECTS_CONFIG).filter(
    (projectKey) => !state.unlockedFreelanceProjects[projectKey]
  );

  for (const projectKey of lockedProjects) {
    // Conditions are now met, latch it
    if (areFreelanceProjectUnlockConditionsMet(projectKey, state)) {
      newUnlockedProjects[projectKey] = true;
      hasNewUnlock = true;
    }
  }

  // Return updated object if new unlocks occurred, otherwise return original
  return hasNewUnlock ? newUnlockedProjects : state.unlockedFreelanceProjects;
}

/**
 * Apply the email triggers for a state transition (issue #31).
 *
 * Runs the email adapters over the before/after states (unlock flips,
 * new visibility, level-ups, a star claim) and merges any new mail into
 * the new state. When mail arrives, the notification bar shows the
 * newest email — unless the player is already looking at the inbox,
 * where the badge updates instead.
 *
 * @param {Object} prevState - The reducer state before the action
 * @param {Object} newState - The reducer state after the action
 * @param {Object|null} starClaim - The claim from an APPLY_STAR_REWARD action
 * @returns {Object} The new state, with emails (and the notification) applied
 *
 * @private
 */
function withEmailTriggers(prevState, newState, starClaim = null) {
  const { emails, newEmailId } = collectTriggerEmails(
    prevState,
    newState,
    starClaim
  );
  if (newEmailId === null) return newState;
  return {
    ...newState,
    emails,
    emailNotification:
      isSectionOnScreen(newState, "email")
        ? newState.emailNotification
        : { emailId: newEmailId },
  };
}

/**
 * Actions that only move UI state (tabs, open mail, collapsed
 * descriptions): they cannot earn an achievement, so the evaluation
 * pass skips them. RESTORE_SAVE is skipped too: a load must never mail
 * a burst of old unlocks; the next tick evaluates the restored state.
 */
const ACHIEVEMENT_SKIP_ACTIONS = new Set([
  "SET_ACTIVE_TAB",
  "NAVIGATE_TO_TARGET",
  "CONSUME_HIGHLIGHT",
  "TOGGLE_SECTION_DESC_VISIBILITY",
  "OPEN_EMAIL",
  "CLOSE_EMAIL",
  "DISMISS_EMAIL_NOTIFICATION",
  "RESTORE_SAVE",
  // The numbers react (issue #214): presentation only.
  "STAT_GAIN",
  // Choosable panes (issue #174): view state only.
  "SET_LAYOUT_MODE",
  "CHOOSE_PANE_SECTION",
]);

/**
 * Achievements (issue #132): after a game action, raise the peak LOC/s
 * to the buffed healthy rate, evaluate every achievement against the
 * new state, and latch any new tiers. Newly earned tiers send ONE
 * inbox mail per action (however many landed). The record is
 * sanitized first (NaN guard), so a bad counter can never unlock a
 * tier. Pure: returns the same state object when nothing changed.
 *
 * @private
 */
function withAchievements(state) {
  const withPeak = shared.recordPeakLocPerSecond(
    state.achievements,
    getBaseLocPerSecond(state)
  );
  const { achievements, unlocked } = shared.evaluateAchievements(
    withPeak,
    achievementContext({ ...state, achievements: withPeak })
  );
  if (unlocked.length === 0) {
    if (withPeak.peakLocPerSecond === state.achievements?.peakLocPerSecond) {
      return state;
    }
    return { ...state, achievements: withPeak };
  }
  const first = unlocked[0];
  const { emails, added } = addEmail(
    state.emails,
    shared.buildAchievementEmail({ unlocked }),
    `achievement:${first.id}:${first.tier}`,
    Date.now()
  );
  return {
    ...state,
    achievements,
    emails,
    emailNotification:
      added && !isSectionOnScreen(state, "email")
        ? { emailId: added.id }
        : state.emailNotification,
  };
}

/**
 * The reducer the provider runs: the game reducer, then the
 * achievements pass for any action that changed game state.
 *
 * @private
 */
function rootReducer(state, action) {
  const next = withStatGain(state, gameReducer(state, action), action);
  if (next === state || ACHIEVEMENT_SKIP_ACTIONS.has(action.type)) {
    return next;
  }
  return withAchievements(next);
}

/**
 * The numbers react (issue #214): after an action, decide which header
 * stats bump (utils/statGain.js) and record it as state.statGain, a
 * transient field (never saved). Ticks, clicks and restores are never
 * examined, so they never bump; a STAT_GAIN action (the Starting
 * Capital grant) carries its gain in the payload and changes nothing
 * else.
 *
 * @private
 */
function withStatGain(prev, next, action) {
  // Ticks, clicks and restores: never examined (and never measured).
  if (STAT_GAIN_NEVER_ACTIONS.includes(action.type)) return next;
  if (next === prev && action.type !== "STAT_GAIN") return next;
  const flags = statGainFlags(action, statGainReading(prev), statGainReading(next));
  const statGain = nextStatGain(next.statGain, flags, Date.now());
  return statGain === (next.statGain ?? null) ? next : { ...next, statGain };
}

/** The values the gain rules read: LOC, Money and their current production. */
function statGainReading(state) {
  return {
    loc: state.linesOfCode,
    money: state.money,
    rate: calculateLOCPerSecond(state),
    moneyRate: getReleaseManagerEconomics(state).cashPerSecond,
  };
}

/**
 * The reducer's starting state (issue #174): the side panes from the
 * device's localStorage (sanitized, so junk or a throwing storage is
 * the default Hire / Projects) and the layout mode from the same
 * media query App watches, with the desktop invariant applied, so the
 * first render already has three different sections.
 *
 * @private
 */
function initGameState(base) {
  let stored = null;
  let desktop = false;
  try {
    stored = localStorage.getItem(SIDE_PANES_STORAGE_KEY);
  } catch {
    stored = null;
  }
  try {
    desktop = window.matchMedia("(min-width: 1024px)").matches;
  } catch {
    desktop = false;
  }
  // A fresh desktop load opens the center on Open Source, as it always
  // has (normalizeCenter moves it on only if a side pane holds it).
  return normalizeCenter({
    ...base,
    activeTab: desktop ? DESKTOP_START_SECTION : base.activeTab,
    sidePanes: readSidePanes(stored),
    layoutMode: desktop ? "desktop" : "mobile",
  });
}

// GameProvider component to wrap the app and provide game state
export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(rootReducer, initialState, initGameState);
  const stateRef = useRef(state);
  const [saveStatus, setSaveStatus] = useState("loading");
  const [savePlayerId, setSavePlayerId] = useState(null);
  // When the last save was accepted (ms since epoch); null until a save
  // is accepted this session, or init loads an existing save (whose
  // savedAt is reported the same way). Drives the footer's "Saved Xs ago".
  const [lastSavedAt, setLastSavedAt] = useState(null);
  // Absolute deadline (ms since epoch) of the rate-limit retry wait;
  // null when no retry is pending. Drives the footer's "Retrying in Ns"
  // countdown. Stored as a deadline, not a seconds count, because a
  // retry can report the same delay twice (e.g. two 429s both saying
  // 10s): a seconds value would be identical, React would bail out of
  // the state update, and the footer's countdown would never re-arm,
  // sticking on "Retrying in 0s". A deadline is always new (it is
  // Date.now() + delay), so every 429 re-arms the countdown.
  const [retryEndsAtMs, setRetryEndsAtMs] = useState(null);

  // Keep a ref to the latest state for the save engine (avoids stale closures).
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Choosable panes (issue #174): the side panes are a device
  // preference. Written back whenever they change; storage that throws
  // (private mode, blocked site data) is ignored.
  const sideLeft = state.sidePanes?.left;
  const sideRight = state.sidePanes?.right;
  useEffect(() => {
    try {
      localStorage.setItem(
        SIDE_PANES_STORAGE_KEY,
        JSON.stringify({ left: sideLeft, right: sideRight })
      );
    } catch {
      // A device preference is best-effort.
    }
  }, [sideLeft, sideRight]);

  // The save engine (guest-only, Slice 2). Created once; the provider owns
  // it because it owns the reducer state the engine reads and restores.
  const saveSyncRef = useRef(null);
  if (saveSyncRef.current === null) {
    saveSyncRef.current = new SaveSync({
      getState: () => stateRef.current,
      restore: (saveState) =>
        dispatch({ type: "RESTORE_SAVE", payload: { state: saveState } }),
      onStatus: (status) => setSaveStatus(status),
      onPlayerId: (id) => setSavePlayerId(id),
      onSavedAt: (timestampMs) => setLastSavedAt(timestampMs),
      // Night Shift (issue #149): the load's settlement report, after
      // the settled state is restored. The mail files it; the floating
      // number shows the credited LOC once.
      onNightShift: (report) => {
        dispatch({ type: "NIGHT_SHIFT_REPORT", payload: report });
        if (typeof window !== "undefined" && report?.creditedLoc > 0) {
          window.dispatchEvent(
            new CustomEvent("gameTickAnimation", {
              detail: { amount: report.creditedLoc },
            })
          );
        }
      },
      onRetry: (seconds) =>
        setRetryEndsAtMs(
          seconds == null ? null : Date.now() + seconds * 1000
        ),
    });
  }

  // Tap-latency diagnostics (PR #101): one instrument, owned by the
  // provider like the save engine. Created once, next to saveSyncRef.
  const tapDiagnosticsRef = useRef(null);
  if (tapDiagnosticsRef.current === null) {
    tapDiagnosticsRef.current = new TapDiagnostics();
  }

  // Force an immediate save (the footer's "Save now" button), bypassing the
  // 60s heartbeat. The engine serializes, so calling while a save is in
  // flight just queues one after it.
  const saveNow = useCallback(() => {
    saveSyncRef.current.requestSave("manual");
  }, []);

  // Diagnostics snapshot for Settings (Copy diagnostics): a fresh
  // snapshot from the engine, taken when the player taps the button.
  // The engine owns the log; this is just a read-through, not a
  // second instance and not reactive state (the log changes on every
  // save, and Settings only needs it on demand). The tap-latency
  // snapshot rides along so one dump has both save attempts and slow
  // taps.
  const getSaveDiagnostics = useCallback(() => {
    return {
      ...saveSyncRef.current.getSaveDiagnostics(),
      tapDiagnostics: tapDiagnosticsRef.current.getSnapshot(),
    };
  }, []);

  // Tap-latency diagnostics (PR #101): the ClickButton handler calls
  // measureTapLatency with the click event's timeStamp; the instrument
  // counts the tap and checks the frame after the dispatch, when the
  // new LOC is painted. The context captured here is the pre-tap
  // state: whether a golden star was on screen when the tap happened,
  // and the save status at that moment.
  const measureTapLatency = useCallback((tapTimeMs) => {
    tapDiagnosticsRef.current.measureTap(tapTimeMs, {
      starOnScreen: goldenStarOnScreen(),
      saveStatus: saveSyncRef.current.getSaveDiagnostics().saveStatus,
      visible: typeof document === "undefined" ? true : !document.hidden,
    });
  }, []);

  // Wipe all progress back to 0 (Settings Danger Zone): the server
  // overwrites the player's own save row with the fresh initial state
  // and the engine restores that state locally. The player keeps the
  // same playerId and account link. Returns `{ ok }` — the caller
  // shows the result.
  const resetProgress = useCallback(async () => {
    return saveSyncRef.current.resetProgress();
  }, []);

  // Sell the Company (prestige, Slice 1): claim Equity from lifetime
  // LOC and atomically reset the company, on the server AND locally.
  // The engine restores the server's post-sale state, so the local
  // state and the saved state can never disagree about the sale.
  // Returns `{ ok: true, state, sale }` or `{ ok: false, error,
  // detail }` — the caller (SellCompany) shows the result.
  const sellCompany = useCallback(async () => {
    return saveSyncRef.current.sellCompany();
  }, []);

  // Permanent store (prestige, Slice 2): buy the next rank of one
  // store track during the post-sale intermission, on the server AND
  // locally. The engine restores the server's returned state, so the
  // local state and the saved state can never disagree about the
  // purchase. Returns `{ ok: true, state, purchase, alreadyOwned }`
  // or `{ ok: false, error, detail }` — the caller (PermanentStore)
  // shows the result. A retried purchase of an already-owned rank
  // reports success with alreadyOwned: true, never a second charge.
  const buyStoreRank = useCallback(async (storeId) => {
    return saveSyncRef.current.buyStoreRank(storeId);
  }, []);

  // Post-sale intermission (prestige, Slice 2): apply the Starting
  // Capital grant once, from the frozen sale quote, and clear the
  // intermission, on the server AND locally. The engine restores the
  // server's returned state. Returns `{ ok: true, state, grant,
  // alreadyCompleted }` or `{ ok: false, error, detail }` — the
  // caller (PermanentStore) shows the result. A retried completion
  // reports success with alreadyCompleted: true, never a second grant.
  const completeIntermission = useCallback(async () => {
    const result = await saveSyncRef.current.completeIntermission();
    // The numbers react (issue #214): the Starting Capital grant is the
    // one gain the new company starts with. Only a fresh completion
    // (never a retried one) with a grant bumps Money.
    // The server reports the grant as { applied, cashCents }.
    const grantCents = result?.grant?.applied ? Number(result.grant.cashCents) : 0;
    if (result?.ok && !result.alreadyCompleted && grantCents > 0) {
      dispatch({ type: "STAT_GAIN", payload: { money: grantCents } });
    }
    return result;
  }, []);

  // Ask the save engine for a prompt save after a golden-star claim
  // (natural or bought). The star UI calls this in the same handler
  // that dispatches APPLY_STAR_REWARD, so the claim's reward persists
  // promptly instead of waiting for the 60s heartbeat. The engine
  // requests the save once the state change propagates (noteState),
  // so the save carries the claimed state, never the pre-claim one.
  // There is no claim to record anymore — the server never validates
  // a claim; the reward is just part of the save state.
  const requestClaimSave = useCallback(() => {
    saveSyncRef.current.requestClaimSave();
  }, []);

  // Wrap dispatch so clicks are counted exactly. WRITE_CODE always applies
  // (it unconditionally adds LOC), so counting it here is exact; hires,
  // projects, and open-source levels are derived from state deltas by the
  // engine instead, so a reducer-rejected action is never counted.
  // A click the reducer refuses during the intermission (issue #188)
  // is not counted either: the gate reads the same latest state.
  const trackedDispatch = useCallback(
    (action) => {
      const blocked = isActionBlockedDuringIntermission(
        stateRef.current,
        action
      );
      dispatch(action);
      if (action.type === "WRITE_CODE" && !blocked) {
        saveSyncRef.current.recordClick();
      }
    },
    [dispatch]
  );

  // Start the save loop (mint/load, then the 60s heartbeat + page-hide saves).
  useEffect(() => {
    const engine = saveSyncRef.current;
    let cancelled = false;
    engine.start().catch((err) => {
      if (!cancelled) console.error("[save] failed to start:", err);
    });
    return () => {
      cancelled = true;
      engine.stop();
    };
  }, []);

  // Tell the engine about every state change so it can save on big actions
  // (a hire, a project completion, an open-source level).
  useEffect(() => {
    saveSyncRef.current.noteState(state);
  }, [state]);

  // Farm breeding (issue #79 feedback): when the reducer raises
  // farmBreedDue (one breeding interval has passed), roll the kid
  // locally (shared.rollFarmBreeding, the same odds the server used)
  // and dispatch FARM_BREED_RESULT. The roll is client-side now — the
  // server never sees a breed, only the kids in the next save. A
  // no-kid tick just clears the flag. The effect is synchronous (no
  // network call), so there is nothing in flight to guard; the roll
  // result is converted to the { stallIndex, type }[] the reducer
  // expects (shared.farmKidsFromRoll), and the reducer treats a
  // malformed payload as no kids instead of throwing. A breed due
  // before the farm is owned is a no-op in the reducer (it clears
  // the flag). The farm kids are a big-action field, so a birth
  // saves promptly via noteState.
  useEffect(() => {
    if (!state.farmBreedDue) {
      return;
    }
    const farm = state.farm ?? shared.emptyFarmState();
    const roll = shared.rollFarmBreeding(farm.stalls, farm.unlockedTypes);
    const kids = shared.farmKidsFromRoll(farm.stalls, roll);
    dispatch({ type: "FARM_BREED_RESULT", payload: { kids } });
  }, [state.farmBreedDue, state.farm]);

  return (
    <GameContext.Provider
      value={{
        state,
        dispatch: trackedDispatch,
        saveStatus,
        savePlayerId,
        lastSavedAt,
        retryEndsAtMs,
        saveNow,
        getSaveDiagnostics,
        resetProgress,
        sellCompany,
        buyStoreRank,
        completeIntermission,
        requestClaimSave,
        measureTapLatency,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}
