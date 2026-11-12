/**
 * Number abbreviation (issue #42) — the ONE shared formatter (SSOT).
 *
 * Every number the player sees goes through here: LOC, money, rates
 * (LOC/s, $/s), costs, unlock targets, star-reward
 * text. No per-component formatting — callers import these two functions
 * and render the string they return. The underlying values stay exact;
 * only the rendered text is abbreviated (display-only).
 *
 * Why this lives in shared/ (not client/src/utils/): the formatter must
 * be used by BOTH the client components AND shared/game-balance.js
 * (starRewardDetail renders "+500 LOC" / "+$10.54" for the floating text
 * and the star-reward email). shared/ cannot import from client/, but
 * client/ already imports from shared/ (game-balance.js), so shared/ is
 * the only location that gives ONE formatter used everywhere. Plain ESM,
 * no React, no DOM, no Node-only APIs — both sides can import it, and
 * the server test suite (node --test) covers it.
 *
 * Rules (issue #42):
 * - Suffixes K, M, B, T, then Qa, Qi, Sx, Sp, Oc, No, Dc as needed.
 * - Abbreviated values show up to 2 decimals; exact round values drop
 *   the decimals (1M, not 1.00M; 1.5K, not 1.50K).
 * - Small numbers (< 1000) display as-is, no suffix. Fractional values
 *   below 1000 (e.g. a 820.5 LOC/s rate) keep up to 2 decimals.
 * - Money is stored in cents; formatMoney takes cents and returns the
 *   string WITH the "$" attached ($1.01B, not 1.01B). Below $1000 it
 *   keeps cents precision ("$310.49"); at $1000+ it abbreviates.
 * - Negative values keep their sign ("-1.5K", "-$1.5K").
 * - Rounding is standard 2-decimal rounding. Note on the issue's
 *   example: $1,001,000,000 is 1.001B, which rounds to $1B (1.00B, and
 *   the trailing zeros drop); $1.01B is $1,010,000,000. A value that
 *   rounds up to 1000 of a tier bumps to the next tier (999,999 → 1M,
 *   not 1000K).
 */

const SUFFIXES = Object.freeze([
  "",
  "K",
  "M",
  "B",
  "T",
  "Qa",
  "Qi",
  "Sx",
  "Sp",
  "Oc",
  "No",
  "Dc",
]);

/** Round to 2 decimals, then drop trailing zeros (1.00 → "1", 1.50 → "1.5"). */
function stripTrailingZeros(roundedToTwoDecimals) {
  return roundedToTwoDecimals.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Abbreviate a plain number.
 *
 * @param {number} value - The number to format.
 * @returns {string} e.g. "999", "1.5K", "1M", "1.01B", "820.5", "-1.5K".
 */
export function formatNumber(value) {
  if (typeof value !== "number" || !isFinite(value)) return "0";
  if (value === 0) return "0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs < 1000) {
    if (Number.isInteger(abs)) return `${sign}${abs}`;
    return `${sign}${stripTrailingZeros(Math.round(abs * 100) / 100)}`;
  }
  let tier = Math.floor(Math.log10(abs) / 3);
  if (tier >= SUFFIXES.length) tier = SUFFIXES.length - 1;
  let scaled = abs / Math.pow(10, tier * 3);
  let rounded = Math.round(scaled * 100) / 100;
  // Rounding pushed it to 1000 of this tier — move up one (999,999 → 1M).
  if (rounded >= 1000 && tier < SUFFIXES.length - 1) {
    tier += 1;
    scaled = abs / Math.pow(10, tier * 3);
    rounded = Math.round(scaled * 100) / 100;
  }
  return `${sign}${stripTrailingZeros(rounded)}${SUFFIXES[tier]}`;
}

/**
 * Format money stored in cents. Returns the string WITH the "$" attached.
 *
 * @param {number} cents - Amount in cents (e.g. 1054 = $10.54).
 * @returns {string} e.g. "$10.54", "$310.49", "$1.5K", "$1.01B", "-$1.5K".
 */
export function formatMoney(cents) {
  if (typeof cents !== "number" || !isFinite(cents)) return "$0.00";
  const dollars = cents / 100;
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  if (abs < 1000) {
    return `${sign}$${abs.toFixed(2)}`;
  }
  return `${sign}$${formatNumber(abs)}`;
}
