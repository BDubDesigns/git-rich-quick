/**
 * Leaderboard (issue #29): accounts only, ranked by lifetime LOC by
 * default, with sort options for current LOC and cash.
 *
 * The board is public to read and returns only rank, display name, and
 * the three score fields — never a player's save data, and never a full
 * email. The display name is the account's name, falling back to the
 * email prefix (the part before @) when the account has no name.
 */

import { STAR_CONFIG } from "../../shared/game-balance.js";

/** The sort keys the leaderboard accepts, and the score each one ranks by. */
export const LEADERBOARD_SORTS = Object.freeze({
  lifetime: "lifetimeLoc",
  current: "currentLoc",
  cash: "money",
});

/** The default sort (lifetime LOC), used when the parameter is missing or unknown. */
export const DEFAULT_LEADERBOARD_SORT = "lifetime";

/** Validate a sort parameter; unknown values fall back to the default. */
export function normalizeLeaderboardSort(sort) {
  if (typeof sort === "string" && sort in LEADERBOARD_SORTS) return sort;
  return DEFAULT_LEADERBOARD_SORT;
}

/**
 * Display name for a leaderboard entry. The account's name wins; an
 * empty/blank name falls back to the email prefix. The full email is
 * never exposed.
 */
export function displayNameForUser(name, email) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed) return trimmed;
  if (typeof email === "string" && email.includes("@")) {
    return email.split("@")[0];
  }
  return "Player";
}

/** Re-exported for the star endpoints: the level that unlocks the countdown. */
export const STAR_COUNTDOWN_UNLOCK_LEVEL = STAR_CONFIG.countdownUnlockLevel;
