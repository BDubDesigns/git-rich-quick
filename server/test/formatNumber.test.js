/**
 * Number abbreviation (issue #42) — unit tests for the shared formatter.
 *
 * Covers the issue's examples, the suffix scale, the 2-decimal rule,
 * the round-value rule, the <1000 rule, currency handling, negatives,
 * and the tier-bump on rounding (999,999 → 1M, not 1000K).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { formatNumber, formatMoney } from "../../shared/formatNumber.js";

test("issue examples: 1,000,000 LOC -> 1M, 1,500 -> 1.5K", () => {
  assert.equal(formatNumber(1000000), "1M");
  assert.equal(formatNumber(1500), "1.5K");
});

test("suffix scale: K, M, B, T, Qa, Qi", () => {
  assert.equal(formatNumber(1000), "1K");
  assert.equal(formatNumber(1000000), "1M");
  assert.equal(formatNumber(1000000000), "1B");
  assert.equal(formatNumber(1000000000000), "1T");
  assert.equal(formatNumber(1000000000000000), "1Qa");
  assert.equal(formatNumber(1000000000000000000), "1Qi");
  assert.equal(formatNumber(2500000), "2.5M");
  assert.equal(formatNumber(7200000000), "7.2B");
});

test("up to 2 decimals: 1.01B, 1.23M; round values drop decimals", () => {
  assert.equal(formatNumber(1010000000), "1.01B");
  assert.equal(formatNumber(1234567), "1.23M");
  assert.equal(formatNumber(1000000), "1M");
  assert.equal(formatNumber(2000000000), "2B");
  assert.equal(formatNumber(1500), "1.5K");
  assert.equal(formatNumber(1050), "1.05K");
});

test("small numbers (< 1000) display as-is, no suffix", () => {
  assert.equal(formatNumber(999), "999");
  assert.equal(formatNumber(42), "42");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(100), "100");
});

test("fractional values below 1000 keep up to 2 decimals (rates)", () => {
  assert.equal(formatNumber(820.5), "820.5");
  assert.equal(formatNumber(1.5), "1.5");
  assert.equal(formatNumber(0.5), "0.5");
  assert.equal(formatNumber(820.25), "820.25");
});

test("negatives keep their sign", () => {
  assert.equal(formatNumber(-1500), "-1.5K");
  assert.equal(formatNumber(-1000000), "-1M");
  assert.equal(formatNumber(-42), "-42");
});

test("rounding up to 1000 bumps to the next tier (999,999 -> 1M)", () => {
  assert.equal(formatNumber(999999), "1M");
  assert.equal(formatNumber(999499), "999.5K");
  assert.equal(formatNumber(999999999), "1B");
});

test("non-finite input is safe", () => {
  assert.equal(formatNumber(NaN), "0");
  assert.equal(formatNumber(Infinity), "0");
});

test("formatMoney: below $1000 keeps cents precision with $ attached", () => {
  assert.equal(formatMoney(1054), "$10.54");
  assert.equal(formatMoney(31049), "$310.49");
  assert.equal(formatMoney(2500), "$25.00");
  assert.equal(formatMoney(0), "$0.00");
});

test("formatMoney: at $1000+ it abbreviates, $ stays attached", () => {
  assert.equal(formatMoney(150000), "$1.5K");
  assert.equal(formatMoney(100000), "$1K");
  assert.equal(formatMoney(101000000000), "$1.01B");
  assert.equal(formatMoney(100000000), "$1M");
});

test("formatMoney: $1,001,000,000 rounds to $1B (1.001B -> 1.00B)", () => {
  // The issue's example reads "$1,001,000,000 -> $1.01B"; 1,001,000,000
  // is 1.001B, which rounds to 1.00B and the trailing zeros drop, so $1B.
  // $1.01B is $1,010,000,000 (covered above).
  assert.equal(formatMoney(100100000000), "$1B");
});

test("formatMoney: negatives keep the sign before the $", () => {
  assert.equal(formatMoney(-150000), "-$1.5K");
  assert.equal(formatMoney(-1054), "-$10.54");
});
