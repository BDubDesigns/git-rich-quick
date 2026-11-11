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
import { SaveSync } from "../save/saveSync.js";
import { saveStateToGameFields } from "../save/serialize.js";

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
  isEmployeeUnlocked,
  isOpenSourceProjectUnlocked,
  isFreelanceProjectUnlocked,
  flatEmployeeCounts,
} from "./gameLogic.js";
import {
  collectTriggerEmails,
  markEmailRead,
} from "../email/email.js";
import { GameContext } from "./gameContext.js";

// Initial state of the game
// All monetary values are in CENTS to avoid floating-point errors
// Initial values are derived from GAME_BALANCE_CONFIG
const initialState = {
  // Core currencies
  linesOfCode: GAME_BALANCE_CONFIG.STARTING_LOC,
  totalLinesOfCode: 0, // cumulative LOC written over time, never decreases
  money: GAME_BALANCE_CONFIG.STARTING_MONEY,
  activeTab: "shop", // can be "shop", "projects", or "openSource"
  // Desktop pane configuration (hardcoded now, will be dynamic later)
  selectedPanes: {
    left: "shop",
    right: "projects",
  },
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

  // In-game inbox (issue #31). Plain records, owned by the email
  // module (client/src/email/email.js). Saved with the game state.
  emails: [],
  // The email currently open in the Email tab (transient UI state, not saved).
  selectedEmailId: null,
  // The email the notification bar is showing (transient UI state, not saved).
  emailNotification: null,

  uiState: {
    sections: {
      shop: { isDescriptionVisible: true },
      projects: { isDescriptionVisible: true },
      openSource: { isDescriptionVisible: true },
      settings: { isDescriptionVisible: true },
      leaderboard: { isDescriptionVisible: true },
      email: { isDescriptionVisible: true },
    },
  },
};

function gameReducer(state, action) {
  switch (action.type) {
    // Player changes active tab (shop, projects, or openSource)
    case "SET_ACTIVE_TAB": {
      const { tab } = action.payload;
      const validTabs = NAV_TABS.map((t) => t.id);
      const activeTab = validTabs.includes(tab) ? tab : "shop";
      if (!validTabs.includes(tab)) {
        console.warn(`Invalid tab: ${tab}. Defaulting to shop.`);
      }
      return { ...state, activeTab };
    }
    // Player clicks the "Write Code" button
    case "WRITE_CODE": {
      const locPerClick = calculateLOCPerClick(state);
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

      // Total cost for `quantity` hires, starting from the owned count.
      const totalCost = shared
        .employeePurchaseCosts(employeeType, employee.count, quantity)
        .reduce((sum, cost) => sum + cost, 0);

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
        const newState = {
          ...state,
          linesOfCode: state.linesOfCode - project.loc,
          money: state.money + project.reward,
          freelanceProjectsCompleted: {
            ...state.freelanceProjectsCompleted,
            [projectKey]: state.freelanceProjectsCompleted[projectKey] + 1,
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
      const totalPassiveLOC = calculateLOCPerSecond(state);
      const cleanedHistory = state.clickHistory.filter(
        (ts) => ts > Date.now() - 10000
      );
      // Drop golden-star buffs that have expired (their expiry is also
      // checked by activeStarBuff, so a buff never applies past its end).
      const now = Date.now();
      const activeStarEffects = (state.activeStarEffects ?? []).filter(
        (buff) => buff.expiresAtMs > now
      );

      // Build newState with all changes from this action
      const newState = {
        ...state,
        linesOfCode: state.linesOfCode + totalPassiveLOC,
        totalLinesOfCode: state.totalLinesOfCode + totalPassiveLOC,
        clickHistory: cleanedHistory,
        currentCPS: calculateCPS(cleanedHistory),
        activeStarEffects,
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
      // get project state and config
      const projectState = state.openSourceProjects[projectId];
      const projectConfig = OPEN_SOURCE_PROJECTS_CONFIG[projectId];

      // check if there is a next level
      if (projectState.level >= projectConfig.levels.length) {
        return state; // already max level, return state unchanged
      }

      // check if project is unlocked
      if (!isOpenSourceProjectUnlocked(projectId, state)) {
        console.warn(`Attempted to contribute to locked project: ${projectId}`);
        return state;
      }

      // get next level config
      const nextLevelConfig = projectConfig.levels[projectState.level];
      const cost = nextLevelConfig.locCost;
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

    // Apply a golden-star claim (issue #33). The payload is the claim
    // `resolveStarClaim` returns in shared/game-balance.js: instant
    // LOC/money deltas for Lucky / Shooting Stars, or a timed buff for
    // Frenzy / Click / Employee. The caller also records the claim with
    // the save engine (recordStarClaim) in the same handler, so the
    // claim and the state change can never disagree.
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
      const newState = {
        ...state,
        linesOfCode: newLinesOfCode,
        totalLinesOfCode: newTotalLinesOfCode,
        money: newMoney,
        activeStarEffects,
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
        ...state,
        activeTab: "email",
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

    // Dismiss the notification bar (X or swipe). The email stays unread
    // in the inbox until the player opens it.
    case "DISMISS_EMAIL_NOTIFICATION": {
      return { ...state, emailNotification: null };
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
      newState.activeTab === "email"
        ? newState.emailNotification
        : { emailId: newEmailId },
  };
}

// GameProvider component to wrap the app and provide game state
export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const stateRef = useRef(state);
  const [saveStatus, setSaveStatus] = useState("loading");
  const [savePlayerId, setSavePlayerId] = useState(null);
  // When the last save was accepted (ms since epoch); null until a save
  // is accepted this session, or init loads an existing save (whose
  // savedAt is reported the same way). Drives the footer's "Saved Xs ago".
  const [lastSavedAt, setLastSavedAt] = useState(null);
  // Seconds until a rate-limited save retries; null when no retry is
  // pending. Drives the footer's "Retrying in Ns" countdown.
  const [retryInSeconds, setRetryInSeconds] = useState(null);

  // Keep a ref to the latest state for the save engine (avoids stale closures).
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
      onRetry: (seconds) => setRetryInSeconds(seconds),
    });
  }

  // Force an immediate save (the footer's "Save now" button), bypassing the
  // 60s heartbeat. The engine serializes, so calling while a save is in
  // flight just queues one after it.
  const saveNow = useCallback(() => {
    saveSyncRef.current.requestSave("manual");
  }, []);

  // Record one golden-star claim with the save engine (issue #33). The
  // star UI calls this in the same handler that dispatches
  // APPLY_STAR_REWARD, with the exact claim applied, so the claim and
  // the state change can never disagree.
  const recordStarClaim = useCallback((claim) => {
    saveSyncRef.current.recordStarClaim(claim);
  }, []);

  // Wrap dispatch so clicks are counted exactly. WRITE_CODE always applies
  // (it unconditionally adds LOC), so counting it here is exact; hires,
  // projects, and open-source levels are derived from state deltas by the
  // engine instead, so a reducer-rejected action is never counted.
  const trackedDispatch = useCallback(
    (action) => {
      dispatch(action);
      if (action.type === "WRITE_CODE") {
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

  return (
    <GameContext.Provider
      value={{
        state,
        dispatch: trackedDispatch,
        saveStatus,
        savePlayerId,
        lastSavedAt,
        retryInSeconds,
        saveNow,
        recordStarClaim,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}
