/**
 * Utility functions for handling currency in cents
 * All internal calculations use cents (integers) to avoid floating-point errors
 * This is critical for idle games that run for extended periods
 *
 * Display formatting lives in shared/formatNumber.js (the SSOT formatter,
 * issue #42) — formatMoney there takes cents and returns the string with
 * the "$" attached, abbreviated at $1000+. Import it from there; do not
 * add a second money formatter here.
 */

/**
 * Convert dollars to cents
 * @param {number} dollars - Amount in dollars
 * @returns {number} Amount in cents (integer)
 */
export function dollarsToCents(dollars) {
  return Math.round(dollars * 100);
}

/**
 * Convert cents to dollars
 * @param {number} cents - Amount in cents
 * @returns {number} Amount in dollars (decimal)
 */
export function centsToDollars(cents) {
  return cents / 100;
}
