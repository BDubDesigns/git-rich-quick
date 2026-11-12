/**
 * Tests for the golden star's shared helpers (issue #29). The star
 * schedule and outcome are rolled client-side now (the server just
 * saves), so the server endpoint tests that used to live here are
 * gone with the endpoints — what remains is the pure shared helper
 * the client UI derives the effect duration bars from:
 * starBuffDurationSeconds. The star roll helpers themselves
 * (rollNextStarAtMs, rollStarEffect, rollStarGood, resolveStarClaim)
 * are covered by the Node smoke check in the PR, not by a test file.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { starBuffDurationSeconds } from "../../shared/game-balance.js";

test("starBuffDurationSeconds: total duration from effect + good/bad", () => {
  // The stored buff only carries expiresAtMs, so the effect duration
  // bar derives the total from the config. Good is a multiplier above
  // 1x, bad below 1x.
  assert.equal(starBuffDurationSeconds("frenzy", true), 60);
  assert.equal(starBuffDurationSeconds("frenzy", false), 30);
  assert.equal(starBuffDurationSeconds("click", true), 20);
  assert.equal(starBuffDurationSeconds("click", false), 10);
  assert.equal(starBuffDurationSeconds("employee", true), 60);
  assert.equal(starBuffDurationSeconds("employee", false), 30);
  assert.equal(starBuffDurationSeconds("lucky", true), null);
  assert.equal(starBuffDurationSeconds("nope", true), null);
});
