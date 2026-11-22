/**
 * Unlock progress + visibility — pure helpers, no client-only imports.
 *
 * These were in client/src/context/gameLogic.js, but gameLogic imports
 * the display config (gameConfig.js), which imports react-icons for tab
 * and employee icons. The save server's test environment installs only
 * the server workspace, so anything it imports must stay free of npm
 * packages. The unlock math only needs the conditions, which live in
 * shared BALANCE, and the display names, which live in shared too — so
 * these helpers live here (shared-only) and gameLogic re-exports them,
 * keeping one implementation for the Shop, the email adapters, and the
 * server-side unlock checks.
 *
 * Behavior is identical to the gameLogic versions: same progress shape
 * ({ type, current, target, remaining, employeeType?, employeeName?,
 * projectKey?, projectName? }), same visibility rule (ANY condition at
 * UNLOCK_VISIBILITY_THRESHOLD), same defensive empty-progress-means-visible rule.
 */

import {
  agentFleetUnlocked,
  agentHireBulkPriceCents,
  BALANCE,
  buffedLocPerSecond,
  CODING_AGENT_CARD_ID,
  EMPLOYEE_DISPLAY_NAMES,
  employeeBulkCost,
  FARM_CONFIG,
  FREELANCE_PROJECT_DISPLAY_NAMES,
  nightShiftGateProgress,
  OPEN_SOURCE_DISPLAY_NAMES,
  openSourceNextLevelCost,
  openSourceNextLevelNeedsRound,
  UNLOCK_VISIBILITY_THRESHOLD,
} from "../../../shared/game-balance.js";
import { sortIdsByCost } from "./sortModes.js";

/**
 * Total number of employees across all employee types.
 */
export function getTotalEmployeeCount(state) {
  return Object.values(state.employees).reduce(
    (total, employee) => total + employee.count,
    0
  );
}

/**
 * Private helper to check if any progress meets the visibility threshold.
 * @private
 */
function checkProgressAgainstThreshold(progress, threshold) {
  if (progress.length === 0) {
    // Defensive: empty progress means no conditions, so consider it met
    return true;
  }
  // Check if any condition meets or exceeds the threshold
  return progress.some(
    (condition) =>
      condition.target > 0 && condition.current / condition.target >= threshold
  );
}

/**
 * Progress toward unlocking an employee: one entry per unlock condition,
 * each { type, current, target, remaining } (plus employeeType /
 * employeeName for SPECIFIC_EMPLOYEE_COUNT). Empty when the employee has
 * no unlock conditions.
 */
export function getUnlockProgress(employeeType, state) {
  const config = BALANCE.employees[employeeType];

  if (!config || !config.unlockConditions || config.unlockConditions.length === 0) {
    return []; // No unlock conditions, no progress to show
  }

  return progressForConditions(config.unlockConditions, state);
}

/**
 * Progress toward unlocking an open-source project. Same shape as
 * getUnlockProgress; conditions come from BALANCE.openSource.
 */
export function getUnlockProgressForOpenSource(projectId, state) {
  const config = BALANCE.openSource[projectId];

  if (!config || !config.unlockConditions || config.unlockConditions.length === 0) {
    return []; // No unlock conditions
  }

  return progressForConditions(config.unlockConditions, state);
}

/**
 * Progress toward unlocking a freelance project. Same shape as
 * getUnlockProgress; conditions come from BALANCE.freelanceProjects.
 */
export function getUnlockProgressForFreelanceProject(projectKey, state) {
  const config = BALANCE.freelanceProjects[projectKey];

  if (!config || !config.unlockConditions || config.unlockConditions.length === 0) {
    return []; // No unlock conditions
  }

  return progressForConditions(config.unlockConditions, state);
}

/**
 * Progress toward unlocking the Llama Farm (10 Senior Developers).
 * Same shape as getUnlockProgress; conditions come from FARM_CONFIG.
 */
export function getUnlockProgressForFarm(state) {
  return progressForConditions(FARM_CONFIG.unlockConditions, state);
}

/** Whether every farm unlock condition is met right now. */
export function isFarmUnlockMet(state) {
  return getUnlockProgressForFarm(state).every(
    (entry) => entry.current >= entry.target
  );
}

/**
 * Progress toward hiring Night Shift level 1 (issue #195): the level 1
 * gate from NIGHT_SHIFT_CONFIG (live passive LOC/s and one employee
 * count), in the same progress shape as every other unlock, so the
 * visibility rule and the requirement text work unchanged. LOC/s is
 * the buffed healthy rate the card and the reducer read (the shared
 * buffedLocPerSecond on flat counts), floored like the card shows it.
 */
function flatField(map, field) {
  return Object.fromEntries(
    Object.entries(map ?? {}).map(([key, value]) => [key, value?.[field] ?? 0])
  );
}

/**
 * P for pricing from a CLIENT (nested) state: the shared buffed healthy
 * rate (no star, SUBTRACTERALL or tech debt effects), the same number
 * gameLogic.getBaseLocPerSecond reads.
 */
export function clientBuffedLocPerSecond(state) {
  return buffedLocPerSecond({
    employees: flatField(state?.employees, "count"),
    openSourceProjects: flatField(state?.openSourceProjects, "level"),
    lifetimeEquityEarned: state?.lifetimeEquityEarned ?? 0,
    achievements: state?.achievements,
    permanentStoreRanks: state?.permanentStoreRanks ?? {},
  });
}

export function getUnlockProgressForNightShift(state) {
  const flat = flatField;
  const employees = flat(state?.employees, "count");
  const gate = nightShiftGateProgress(
    1,
    buffedLocPerSecond({
      employees,
      openSourceProjects: flat(state?.openSourceProjects, "level"),
      lifetimeEquityEarned: state?.lifetimeEquityEarned ?? 0,
      achievements: state?.achievements,
      permanentStoreRanks: state?.permanentStoreRanks ?? {},
    }),
    employees
  );
  const rate = gate.locPerSecond;
  const hires = gate.employees;
  return [
    {
      type: "PASSIVE_LOC_PER_SECOND",
      current: Math.floor(rate.current),
      target: rate.target,
      remaining: Math.max(0, rate.target - Math.floor(rate.current)),
    },
    {
      type: "SPECIFIC_EMPLOYEE_COUNT",
      current: hires.current,
      target: hires.target,
      remaining: Math.max(0, hires.target - hires.current),
      employeeType: hires.employeeType,
      employeeName: EMPLOYEE_DISPLAY_NAMES[hires.employeeType],
    },
  ];
}

/** Whether the Night Shift level 1 gate is met right now. */
export function isNightShiftUnlockMet(state) {
  return getUnlockProgressForNightShift(state).every(
    (entry) => entry.current >= entry.target
  );
}

/** Shared condition -> progress mapping for both unlock types. */
function progressForConditions(unlockConditions, state) {
  return unlockConditions.map((condition) => {
    let current = 0;

    switch (condition.type) {
      case "TOTAL_LOC":
        current = state.totalLinesOfCode;
        break;
      case "TOTAL_EMPLOYEE_COUNT":
        current = getTotalEmployeeCount(state);
        break;
      case "SPECIFIC_EMPLOYEE_COUNT":
        if (condition.employeeType && state.employees[condition.employeeType]) {
          current = state.employees[condition.employeeType].count;
        } else {
          console.warn(
            `Invalid employeeType in unlock condition: ${condition.employeeType}`
          );
          current = 0;
        }
        break;
      case "SPECIFIC_PROJECT_COUNT":
        if (
          condition.projectKey &&
          state.freelanceProjectsCompleted &&
          typeof state.freelanceProjectsCompleted[condition.projectKey] ===
            "number"
        ) {
          current = state.freelanceProjectsCompleted[condition.projectKey];
        } else {
          console.warn(
            `Invalid projectKey in unlock condition: ${condition.projectKey}`
          );
          current = 0;
        }
        break;
      case "TOTAL_PROJECTS_COUNT":
        current = Object.values(state.freelanceProjectsCompleted ?? {}).reduce(
          (sum, count) => sum + count,
          0
        );
        break;
      // Moonshot (issue #165): an Open Source level (client state
      // holds { level } per project) and lifetime gold stars clicked.
      // A missing or NaN value reads 0.
      case "OPEN_SOURCE_LEVEL": {
        const level = Number(
          state.openSourceProjects?.[condition.projectId]?.level ?? 0
        );
        current = Number.isFinite(level) ? level : 0;
        break;
      }
      case "GOLD_STARS_CLICKED": {
        const clicked = Number(state.achievements?.goldStarsClicked ?? 0);
        current = Number.isFinite(clicked) ? clicked : 0;
        break;
      }
      default:
        current = 0;
    }

    const target = condition.target;
    const remaining = Math.max(0, target - current);

    return {
      type: condition.type,
      current,
      target,
      remaining,
      ...(condition.type === "SPECIFIC_EMPLOYEE_COUNT" && {
        employeeType: condition.employeeType,
        employeeName: EMPLOYEE_DISPLAY_NAMES[condition.employeeType],
      }),
      ...(condition.type === "SPECIFIC_PROJECT_COUNT" && {
        projectKey: condition.projectKey,
        projectName: FREELANCE_PROJECT_DISPLAY_NAMES[condition.projectKey],
      }),
      ...(condition.type === "OPEN_SOURCE_LEVEL" && {
        projectId: condition.projectId,
        projectName: OPEN_SOURCE_DISPLAY_NAMES[condition.projectId],
      }),
    };
  });
}

/**
 * Whether an unlockable has crossed the visibility threshold: any one
 * condition at UNLOCK_VISIBILITY_THRESHOLD (10%) of its target.
 */
export function hasCrossedUnlockThreshold(unlockType, unlockUnit, state) {
  // Handle employee unlock type
  if (unlockType === "employee") {
    const progress = getUnlockProgress(unlockUnit, state);
    return checkProgressAgainstThreshold(progress, UNLOCK_VISIBILITY_THRESHOLD);
  }
  // Handle openSource unlock type
  if (unlockType === "openSource") {
    const progress = getUnlockProgressForOpenSource(unlockUnit, state);
    return checkProgressAgainstThreshold(progress, UNLOCK_VISIBILITY_THRESHOLD);
  }
  // Handle freelanceProject unlock type
  if (unlockType === "freelanceProject") {
    const progress = getUnlockProgressForFreelanceProject(unlockUnit, state);
    return checkProgressAgainstThreshold(progress, UNLOCK_VISIBILITY_THRESHOLD);
  }

  // Handle the farm (a single unlockable; unlockUnit is ignored)
  if (unlockType === "farm") {
    const progress = getUnlockProgressForFarm(state);
    return checkProgressAgainstThreshold(progress, UNLOCK_VISIBILITY_THRESHOLD);
  }

  // Night Shift level 1 (issue #195; unlockUnit is ignored)
  if (unlockType === "nightShift") {
    const progress = getUnlockProgressForNightShift(state);
    return checkProgressAgainstThreshold(progress, UNLOCK_VISIBILITY_THRESHOLD);
  }

  console.warn(`Unknown unlock type: ${unlockType}`);
  return false;
}

/**
 * Sort open-source project ids so maxed-out projects sink to the
 * bottom of the GitNub list and projects that still have levels to
 * buy stay higher. Stable: the relative order within each group is
 * unchanged. A project is maxed when its level reaches the number of
 * levels in the shared balance config. Locked projects (level 0) are
 * not maxed, so they stay in the higher group. `state` is the client
 * reducer state (openSourceProjects maps id -> { level }).
 *
 * Favorites (permanent store, Slice 2) sort first among the
 * non-maxed projects: a favorited project the player is working on
 * stays at the top of the list. Maxed projects still sink, even when
 * favorited — there is nothing left to buy there.
 *
 * Funding Rounds (issue #170): a gated track at its round's cap (but
 * not at the end of the track) has nothing to buy this company
 * either, so it sits between the buyable projects and the maxed ones.
 *
 * Sort modes (issue #180): `mode` "default" is all of the above,
 * unchanged. "cheapest" orders the buyable group by next-level LOC
 * cost (openSourceNextLevelCost, the number the card shows and the
 * contribute action charges), ascending, ties in config order, with
 * NO favorite pinning: it is a pure price scan. Locked teasers sit in
 * the buyable group at level 1's cost. Round-capped tracks stay
 * grouped after the buyable list, sorted by cost among themselves,
 * and maxed projects stay last in config order, untouched. The
 * ordering is the shared sortIdsByCost (utils/sortModes.js).
 */
export function sortOpenSourceProjectIds(projectIds, state, mode = "default") {
  const maxed = new Set();
  const roundCapped = new Set();
  for (const id of projectIds) {
    const level = state.openSourceProjects?.[id]?.level ?? 0;
    const levelCount = BALANCE.openSource[id]?.levels?.length ?? 0;
    if (levelCount > 0 && level >= levelCount) maxed.add(id);
    else if (
      level > 0 &&
      openSourceNextLevelNeedsRound(
        id,
        level,
        state.permanentStoreRanks,
        state.openSourceProjects
      )
    ) {
      roundCapped.add(id);
    }
  }
  const favorites = new Set(state.favoriteOpenSourceProjects ?? []);
  const active = projectIds.filter(
    (id) => !maxed.has(id) && !roundCapped.has(id)
  );
  if (mode === "cheapest") {
    const nextCost = (id) =>
      openSourceNextLevelCost(
        id,
        state.openSourceProjects?.[id]?.level ?? 0,
        state.permanentStoreRanks
      );
    return [
      ...sortIdsByCost(active, nextCost),
      ...sortIdsByCost(
        projectIds.filter((id) => roundCapped.has(id)),
        nextCost
      ),
      ...projectIds.filter((id) => maxed.has(id)),
    ];
  }
  return [
    ...active.filter((id) => favorites.has(id)),
    ...active.filter((id) => !favorites.has(id)),
    ...projectIds.filter((id) => roundCapped.has(id)),
    ...projectIds.filter((id) => maxed.has(id)),
  ];
}

/**
 * Order the Hire tab's employee types (issue #181), through the same
 * shared ordering helper as the Open Source tab (sortIdsByCost).
 *
 * - "default": the ids exactly as given (config order), today's order.
 * - "cheapest": by employeeBulkCost for the selected bulk `quantity`
 *   from the owned count, ascending, ties in config order. That is the
 *   number each card shows and the hire action charges, so at x1 it is
 *   the next hire's cost. Locked types own 0, so they sort at their
 *   base hire cost, unlock conditions still on the card. Buying raises
 *   the cost, so the order recomputes live.
 */
export function sortEmployeeTypes(employeeTypes, state, mode = "default", quantity = 1) {
  // Agent Fleet (issue #267): from Series A the Coding Agent card
  // follows the employees (Default) or sorts by its price (Cheapest).
  const ids =
    agentFleetUnlocked(state?.permanentStoreRanks) &&
    !employeeTypes.includes(CODING_AGENT_CARD_ID)
      ? [...employeeTypes, CODING_AGENT_CARD_ID]
      : [...employeeTypes];
  if (mode !== "cheapest") return ids;
  return sortIdsByCost(ids, (type) =>
    // Agent Fleet (issue #267): the Coding Agent card sorts by the
    // price its Hire button charges (seconds of S at the buffed P).
    type === CODING_AGENT_CARD_ID
      ? agentHireBulkPriceCents(
          state.agentFleet?.agents ?? 0,
          quantity,
          clientBuffedLocPerSecond(state)
        )
      : BALANCE.employees[type]
      ? employeeBulkCost(type, state.employees?.[type]?.count ?? 0, quantity, {
          activeStarEffects: state.activeStarEffects ?? [],
        })
      : null
  );
}
