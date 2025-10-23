/**
 * Utility functions for handling currency in cents
 * All internal calculations use cents (integers) to avoid floating-point errors
 * This is critical for idle games that run for extended periods
 */

/**
 * Format cents as a currency string
 * @param {number} cents - Amount in cents (e.g., 1054 = $10.54)
 * @returns {string} Formatted currency (e.g., "10.54")
 */
export function formatMoney(cents) {
  const dollars = cents / 100;
  return dollars.toFixed(2);
}

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
