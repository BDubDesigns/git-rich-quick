/**
 * Progress telemetry (issue #152): server-side snapshots of a player's
 * click versus passive balance over time, so the curve can be tuned
 * from real data.
 *
 * A snapshot is DERIVED from a stored save state with the shared
 * balance helpers the server already uses for validation. It is never
 * written into the save: the save format and game logic do not change.
 *
 * Both rates EXCLUDE temporary buffs (golden-star effects and
 * SUBTRACTERALL phases), so they show the healthy rate, not a spike:
 * - passiveLocPerSec: buffedLocPerSecond (employees, open-source
 *   bonuses, the Engineering Handbook, the Founder multiplier and the
 *   achievement buff).
 * - clickLocPerSecAt10cps: 10 x the healthy locPerClick (base click,
 *   Keyboard, Commit Specialist bonus, OverReact, Founder, achievement
 *   buff, Handbook; no Sprint, no star effect).
 *
 * No PII: the snapshot holds game numbers only (the player id is the
 * random save UUID; no account id, email, or name).
 *
 * Sampling (issue #159, was at most hourly in #152): one snapshot on
 * EVERY accepted save (the 60s heartbeat and every big-action save,
 * reason "save"), plus one of the pre-sale state at every company sale
 * (reason "sale"). Brandon reads a scale in about ten minutes; hourly
 * caught nothing in that window. Expect about one row per minute of
 * active play per player. Rows written before #159 keep their old
 * reasons ("first", "hourly").
 */

import {
  BALANCE,
  DOUBLING_PROJECT_IDS,
  EMPLOYEE_TYPES,
  OPEN_SOURCE_IDS,
  achievementLocMultiplier,
  buffedLocMultiplier,
  buffedLocPerSecond,
  farmLlamaCountsByType,
  founderMultiplier,
  locPerClick,
  normalizeSaveState,
} from "../../shared/game-balance.js";

export const METRICS_SAMPLING = Object.freeze({
  /** When a snapshot is taken (issue #159): every accepted save. */
  rule: "every accepted save, plus the pre-sale state at every sale",
  /** Clicks per second the click rate is quoted at. */
  clicksPerSecond: 10,
  /** Default and maximum rows the admin endpoint returns. */
  defaultLimit: 1000,
  maxLimit: 5000,
});

/** Snapshot reasons written from issue #159 on. */
export const METRICS_REASONS = Object.freeze(["save", "sale"]);
/** Reasons on rows written under the hourly rule (#152). Kept as they are. */
export const LEGACY_METRICS_REASONS = Object.freeze(["first", "hourly"]);

/** A finite, non-negative number, or 0 (NaN and junk never reach a row). */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Each key in `keys` read from `source` as a safe count. */
function counts(source, keys) {
  const out = {};
  for (const key of keys) out[key] = num(source?.[key]);
  return out;
}

/**
 * Derive one snapshot from a save-shaped state. Pure: no clock, no
 * I/O. Returns `{ passiveLocPerSec, clickLocPerSecAt10cps, progress }`.
 */
export function deriveMetricsSnapshot(rawState) {
  const state = normalizeSaveState(rawState ?? {});
  const employees = counts(state.employees, EMPLOYEE_TYPES);
  const openSourceLevels = counts(state.openSourceProjects, OPEN_SOURCE_IDS);
  const storeRanks = state.permanentStoreRanks ?? {};
  const passiveLocPerSec = num(
    buffedLocPerSecond({ ...state, employees, openSourceProjects: openSourceLevels })
  );
  const healthyClick = num(
    locPerClick(openSourceLevels, employees, 1, buffedLocMultiplier(state), storeRanks)
  );
  const clickLocPerSecAt10cps = healthyClick * METRICS_SAMPLING.clicksPerSecond;

  const tiers = {};
  let tiersEarned = 0;
  for (const [id, tier] of Object.entries(state.achievements?.tiers ?? {})) {
    tiers[id] = num(tier);
    tiersEarned += tiers[id];
  }
  const llamas = farmLlamaCountsByType(state.farm?.owned ? state.farm?.stalls : []);
  const lifetime = num(state.totalLinesOfCode);

  return {
    passiveLocPerSec,
    clickLocPerSecAt10cps,
    progress: {
      linesOfCode: num(state.linesOfCode),
      lifetimeLinesOfCode: lifetime,
      companyLinesOfCode: Math.max(0, lifetime - num(state.lifetimeLocAtLastSale)),
      money: num(state.money),
      locPerClick: healthyClick,
      employees,
      doublingRanks: counts(openSourceLevels, DOUBLING_PROJECT_IDS),
      openSourceLevels,
      maxOpenSourceLevels: Object.fromEntries(
        OPEN_SOURCE_IDS.map((id) => [id, BALANCE.openSource[id].levels.length])
      ),
      saleCount: num(state.saleCount),
      nightShiftLevel: num(state.nightShiftLevel),
      lifetimeEquityEarned: num(state.lifetimeEquityEarned),
      founderMultiplier: num(founderMultiplier(state.lifetimeEquityEarned ?? 0)),
      achievementLocMultiplier: num(achievementLocMultiplier(state.achievements)),
      achievementTiersEarned: tiersEarned,
      achievementTiers: tiers,
      permanentStoreRanks: Object.fromEntries(
        Object.entries(storeRanks).map(([id, rank]) => [id, num(rank)])
      ),
      farm: {
        owned: state.farm?.owned === true,
        llamas,
        llamaTotal: Object.values(llamas).reduce((a, b) => a + b, 0),
      },
    },
  };
}

/**
 * Parse the admin endpoint's `from` / `to` query value: an ISO date or
 * ms since the epoch. Returns null for a missing value, NaN for a bad
 * one (the caller answers 400).
 */
export function parseTimeParam(value) {
  if (value === null || value === undefined || value === "") return null;
  if (/^\d+$/.test(value)) return Number(value);
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NaN;
}
