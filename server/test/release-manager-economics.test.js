/**
 * Tests for the Release Manager shipping economics readout (issue
 * #163): shared.releaseManagerShippingEconomics, which drives the
 * per-project assignment rows on the Projects tab and the shipping
 * summary strip under the Release Manager card. Pins the outflow
 * (assigned x LOC per ship), cash/s (assigned x reward per ship), the
 * net (passive in minus outflow, including a deficit), and the
 * unassigned count. Pure function tests, no database.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  BALANCE,
  FREELANCE_PROJECT_KEYS,
  releaseManagerShippingEconomics,
} from "../../shared/game-balance.js";

const TODO = BALANCE.freelanceProjects.toDoListApp; // 50 LOC, 3000c
const HOBBY = BALANCE.freelanceProjects.hobbyWebsite; // 750 LOC, 36000c

function assignments(overrides = {}) {
  const out = {};
  for (const key of FREELANCE_PROJECT_KEYS) out[key] = 0;
  return { ...out, ...overrides };
}

const BOTH_UNLOCKED = { toDoListApp: true, hobbyWebsite: true };

test("outflow is assigned count x LOC per ship, summed over projects", () => {
  const econ = releaseManagerShippingEconomics({
    assignments: assignments({ toDoListApp: 3, hobbyWebsite: 2 }),
    managersOwned: 5,
    passiveLocPerSecond: 10_000,
    unlockedProjects: BOTH_UNLOCKED,
  });
  assert.equal(econ.perProject.toDoListApp.locPerSecond, 3 * TODO.loc);
  assert.equal(econ.perProject.hobbyWebsite.locPerSecond, 2 * HOBBY.loc);
  assert.equal(econ.rmOut, 3 * TODO.loc + 2 * HOBBY.loc); // 1650
  assert.equal(econ.rmOut, 1650);
});

test("cash/s is assigned count x reward per ship, in cents", () => {
  const econ = releaseManagerShippingEconomics({
    assignments: assignments({ toDoListApp: 3, hobbyWebsite: 2 }),
    managersOwned: 5,
    passiveLocPerSecond: 10_000,
    unlockedProjects: BOTH_UNLOCKED,
  });
  assert.equal(econ.perProject.toDoListApp.cashPerSecond, 3 * TODO.reward);
  assert.equal(econ.perProject.hobbyWebsite.cashPerSecond, 2 * HOBBY.reward);
  assert.equal(econ.cashPerSecond, 3 * 3000 + 2 * 36000); // 81000c
});

test("net is passive in minus outflow: surplus case", () => {
  const econ = releaseManagerShippingEconomics({
    assignments: assignments({ toDoListApp: 4 }),
    managersOwned: 4,
    passiveLocPerSecond: 500,
    unlockedProjects: BOTH_UNLOCKED,
  });
  assert.equal(econ.passiveIn, 500);
  assert.equal(econ.rmOut, 200);
  assert.equal(econ.net, 300);
});

test("net is zero when outflow exactly matches passive in", () => {
  const econ = releaseManagerShippingEconomics({
    assignments: assignments({ toDoListApp: 10 }),
    managersOwned: 10,
    passiveLocPerSecond: 500,
    unlockedProjects: BOTH_UNLOCKED,
  });
  assert.equal(econ.net, 0);
});

test("net goes negative in the deficit case", () => {
  const econ = releaseManagerShippingEconomics({
    assignments: assignments({ hobbyWebsite: 2 }),
    managersOwned: 2,
    passiveLocPerSecond: 1000,
    unlockedProjects: BOTH_UNLOCKED,
  });
  assert.equal(econ.rmOut, 1500);
  assert.equal(econ.net, -500);
});

test("unassigned is owned minus assigned, never below 0", () => {
  const some = releaseManagerShippingEconomics({
    assignments: assignments({ toDoListApp: 2, hobbyWebsite: 1 }),
    managersOwned: 7,
    passiveLocPerSecond: 0,
    unlockedProjects: BOTH_UNLOCKED,
  });
  assert.equal(some.assignedCount, 3);
  assert.equal(some.unassigned, 4);

  const all = releaseManagerShippingEconomics({
    assignments: assignments({ toDoListApp: 3 }),
    managersOwned: 3,
    unlockedProjects: BOTH_UNLOCKED,
  });
  assert.equal(all.unassigned, 0);

  // A bad state with more assigned than owned clamps to 0.
  const over = releaseManagerShippingEconomics({
    assignments: assignments({ toDoListApp: 5 }),
    managersOwned: 2,
    unlockedProjects: BOTH_UNLOCKED,
  });
  assert.equal(over.unassigned, 0);
});

test("no managers: everything is zero and net equals passive in", () => {
  const econ = releaseManagerShippingEconomics({
    assignments: assignments(),
    managersOwned: 0,
    passiveLocPerSecond: 123,
    unlockedProjects: BOTH_UNLOCKED,
  });
  assert.equal(econ.rmOut, 0);
  assert.equal(econ.cashPerSecond, 0);
  assert.equal(econ.net, 123);
  assert.equal(econ.unassigned, 0);
});

test("a locked project contributes no outflow or cash (the tick skips it)", () => {
  const econ = releaseManagerShippingEconomics({
    assignments: assignments({ toDoListApp: 1, hobbyWebsite: 1 }),
    managersOwned: 2,
    passiveLocPerSecond: 100,
    unlockedProjects: { toDoListApp: true, hobbyWebsite: false },
  });
  assert.equal(econ.rmOut, TODO.loc);
  assert.equal(econ.cashPerSecond, TODO.reward);
  assert.equal(econ.perProject.hobbyWebsite.locPerSecond, 0);
  // Still counted as assigned, matching releaseManagerAssignedCount.
  assert.equal(econ.unassigned, 0);
});

test("Ship Happens and Client Network scale the rates like the tick does", () => {
  const econ = releaseManagerShippingEconomics({
    assignments: assignments({ toDoListApp: 1 }),
    managersOwned: 1,
    passiveLocPerSecond: 0,
    unlockedProjects: BOTH_UNLOCKED,
    openSourceLevels: { shipHappens: 2 }, // 4 ships per manager per second
  });
  assert.equal(econ.rmOut, 4 * TODO.loc);
  assert.equal(econ.cashPerSecond, 4 * TODO.reward);
  assert.equal(econ.net, -4 * TODO.loc);
});

test("missing counts default to 0 and bad numbers never produce NaN", () => {
  const econ = releaseManagerShippingEconomics({
    assignments: { toDoListApp: NaN, hobbyWebsite: undefined },
    managersOwned: NaN,
    passiveLocPerSecond: NaN,
    unlockedProjects: BOTH_UNLOCKED,
  });
  for (const v of [econ.passiveIn, econ.rmOut, econ.cashPerSecond, econ.net, econ.unassigned]) {
    assert.equal(Number.isNaN(v), false);
    assert.equal(v, 0);
  }
  const empty = releaseManagerShippingEconomics();
  assert.equal(empty.net, 0);
  assert.equal(empty.perProject.toDoListApp.assigned, 0);
});
