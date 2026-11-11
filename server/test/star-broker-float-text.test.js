/**
 * StarBroker level-up label — unit tests for the shared helpers.
 *
 * StarBroker has no numeric bonus (its levels are { type: "STAR",
 * value: 0 }) — the benefit of a level is the shorter cooldown between
 * bought stars. The generic "+N TYPE" label therefore read "+0 STAR"
 * when buying a StarBroker level, which is what Brandon saw on the
 * live site. The level-up floating text names the new cooldown
 * instead ("Cooldown 4m!"), and the card lines name it too. These
 * tests pin the exact strings so the label can never regress to a
 * meaningless "+0 STAR".
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  formatCooldownSeconds,
  starBrokerLevelUpFloatText,
} from "../../shared/game-balance.js";

test("formatCooldownSeconds: exact minutes drop the 0s", () => {
  assert.equal(formatCooldownSeconds(480), "8m");
  assert.equal(formatCooldownSeconds(240), "4m");
  assert.equal(formatCooldownSeconds(120), "2m");
  assert.equal(formatCooldownSeconds(60), "1m");
});

test("formatCooldownSeconds: under a minute is just seconds", () => {
  assert.equal(formatCooldownSeconds(30), "30s");
  assert.equal(formatCooldownSeconds(45), "45s");
});

test("formatCooldownSeconds: non-exact minutes keep the seconds", () => {
  assert.equal(formatCooldownSeconds(90), "1m 30s");
});

test("starBrokerLevelUpFloatText names the new cooldown per level", () => {
  assert.equal(starBrokerLevelUpFloatText(1), "Cooldown 8m!");
  assert.equal(starBrokerLevelUpFloatText(2), "Cooldown 4m!");
  assert.equal(starBrokerLevelUpFloatText(3), "Cooldown 2m!");
  assert.equal(starBrokerLevelUpFloatText(4), "Cooldown 1m!");
  assert.equal(starBrokerLevelUpFloatText(5), "Cooldown 30s!");
});

test("starBrokerLevelUpFloatText never reads like a numeric bonus", () => {
  for (let level = 1; level <= 5; level += 1) {
    const text = starBrokerLevelUpFloatText(level);
    assert.ok(!text.includes("+0"), text);
    assert.ok(!text.includes("STAR"), text);
  }
});
