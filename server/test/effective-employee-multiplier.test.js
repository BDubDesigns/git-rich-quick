/**
 * Effective per-type production multiplier (global Frenzy x type-specific
 * Employee) — unit tests for the shared helper.
 *
 * The production math multiplies the two: an Employee buff scales one
 * type's contribution, then Frenzy scales the whole passive rate
 * including that extra (see calculateLOCPerSecond), so the combined
 * multiplier for a type is the product, never the sum. The employee
 * card's tint and boosted amount both read this one number, so these
 * tests pin the combination the UI shows — including the cancellation
 * case where a Frenzy bad (0.5x) and an Employee good (2x) multiply to
 * exactly 1, meaning production is genuinely unchanged and the card
 * shows no tint and no boosted amount.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { effectiveEmployeeMultiplier } from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const LIVE = T0 + 60_000;

const frenzy = (multiplier, expiresAtMs = LIVE) => ({
  effect: "frenzy",
  multiplier,
  expiresAtMs,
  employeeType: null,
});
const employee = (type, multiplier, expiresAtMs = LIVE) => ({
  effect: "employee",
  multiplier,
  expiresAtMs,
  employeeType: type,
});

test("no live buffs -> 1 for every type", () => {
  assert.equal(effectiveEmployeeMultiplier([], "senior", T0), 1);
  assert.equal(effectiveEmployeeMultiplier(null, "intern", T0), 1);
  assert.equal(effectiveEmployeeMultiplier(undefined, "junior", T0), 1);
});

test("Frenzy alone scales every type (Overclock 7x, Throttling 0.5x)", () => {
  assert.equal(
    effectiveEmployeeMultiplier([frenzy(7)], "intern", T0),
    7
  );
  assert.equal(
    effectiveEmployeeMultiplier([frenzy(7)], "senior", T0),
    7
  );
  assert.equal(
    effectiveEmployeeMultiplier([frenzy(0.5)], "junior", T0),
    0.5
  );
});

test("Employee buff alone scales only its own type", () => {
  const buffs = [employee("senior", 2)];
  assert.equal(effectiveEmployeeMultiplier(buffs, "senior", T0), 2);
  assert.equal(effectiveEmployeeMultiplier(buffs, "intern", T0), 1);
  assert.equal(
    effectiveEmployeeMultiplier([employee("junior", 0.5)], "junior", T0),
    0.5
  );
  assert.equal(
    effectiveEmployeeMultiplier([employee("junior", 0.5)], "senior", T0),
    1
  );
});

test("Frenzy and Employee multiply, they do not add", () => {
  assert.equal(
    effectiveEmployeeMultiplier([frenzy(7), employee("senior", 2)], "senior", T0),
    14
  );
  assert.equal(
    effectiveEmployeeMultiplier([frenzy(7), employee("junior", 0.5)], "junior", T0),
    3.5
  );
  assert.equal(
    effectiveEmployeeMultiplier(
      [frenzy(0.5), employee("intern", 0.5)],
      "intern",
      T0
    ),
    0.25
  );
});

test("Frenzy bad cancelled by Employee good multiplies to exactly 1", () => {
  assert.equal(
    effectiveEmployeeMultiplier(
      [frenzy(0.5), employee("senior", 2)],
      "senior",
      T0
    ),
    1
  );
});

test("expired buffs are ignored", () => {
  const buffs = [
    frenzy(7, T0 - 1000),
    employee("senior", 2, T0 - 1000),
  ];
  assert.equal(effectiveEmployeeMultiplier(buffs, "senior", T0), 1);
  // A live Frenzy still applies even when the Employee buff expired.
  assert.equal(
    effectiveEmployeeMultiplier(
      [frenzy(7), employee("senior", 2, T0 - 1000)],
      "senior",
      T0
    ),
    7
  );
});

test("click buffs do not touch production", () => {
  const buffs = [
    {
      effect: "click",
      multiplier: 4,
      expiresAtMs: LIVE,
      employeeType: null,
    },
  ];
  assert.equal(effectiveEmployeeMultiplier(buffs, "senior", T0), 1);
});
