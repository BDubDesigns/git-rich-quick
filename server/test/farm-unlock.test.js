/**
 * Tests for the Llama Farm unlock gate: the barn can only be bought
 * with 10 Senior Developers on payroll (the ones who always want to
 * quit and start a farm). Same condition shape and evaluation as every
 * employee/project unlock. No saved latch: Seniors cannot be fired, so
 * the condition cannot un-meet mid-company, and a sale zeroes the
 * Seniors, so the gate is earned again each company. Mail: a teaser
 * at the first Senior (10% of the goal) and an unlock mail at 10, each
 * only on the transition and never once the barn is owned.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  FARM_CONFIG,
  applyPrestigeSale,
  buildFarmUnlockedEmail,
  buildFarmVisibleEmail,
  farmUnlockConditionsMet,
  initialFarmState,
  initialSaveState,
} from "../../shared/game-balance.js";
import {
  getUnlockProgressForFarm,
  hasCrossedUnlockThreshold,
  isFarmUnlockMet,
} from "../../client/src/utils/unlockProgress.js";
import { formatCondition } from "../../client/src/utils/formatCondition.js";
import {
  collectTriggerEmails,
  isTeaserEmail,
} from "../../client/src/email/email.js";
import { saveStateToGameFields } from "../../client/src/save/serialize.js";

/** A client-shaped reducer state with `seniors` Senior Developers. */
function clientState(seniors, farm = undefined) {
  const save = initialSaveState();
  save.employees = { ...save.employees, senior: seniors };
  if (farm) save.farm = farm;
  return saveStateToGameFields(save);
}

function farmMail(prev, next) {
  return collectTriggerEmails(prev, next).emails.filter((e) =>
    e.triggerKey.startsWith("farm-")
  );
}

test("the gate is 10 Senior Developers", () => {
  assert.deepEqual(
    FARM_CONFIG.unlockConditions.map((c) => ({ ...c })),
    [{ type: "SPECIFIC_EMPLOYEE_COUNT", employeeType: "senior", target: 10 }]
  );
});

test("farmUnlockConditionsMet: 9 Seniors is locked, 10 is open, missing reads 0", () => {
  const save = initialSaveState();
  assert.equal(farmUnlockConditionsMet(save), false);
  assert.equal(
    farmUnlockConditionsMet({ ...save, employees: { ...save.employees, senior: 9 } }),
    false
  );
  assert.equal(
    farmUnlockConditionsMet({ ...save, employees: { ...save.employees, senior: 10 } }),
    true
  );
  // Other roles do not count toward it.
  assert.equal(
    farmUnlockConditionsMet({ ...save, employees: { ...save.employees, intern: 500 } }),
    false
  );
  assert.equal(farmUnlockConditionsMet({}), false);
  assert.equal(farmUnlockConditionsMet(null), false);
});

test("client progress reads the live Senior count and formats like other unlocks", () => {
  const progress = getUnlockProgressForFarm(clientState(3));
  assert.equal(progress.length, 1);
  assert.equal(progress[0].current, 3);
  assert.equal(progress[0].target, 10);
  assert.equal(formatCondition(progress[0]), "Hire 10 Senior Developers");
  assert.equal(isFarmUnlockMet(clientState(9)), false);
  assert.equal(isFarmUnlockMet(clientState(10)), true);
  assert.equal(isFarmUnlockMet(clientState(15)), true);
});

test("the goal becomes visible at the first Senior (10% of 10)", () => {
  assert.equal(hasCrossedUnlockThreshold("farm", null, clientState(0)), false);
  assert.equal(hasCrossedUnlockThreshold("farm", null, clientState(1)), true);
});

test("the first Senior sends one teaser, marked as a teaser", () => {
  const mail = farmMail(clientState(0), clientState(1));
  assert.equal(mail.length, 1);
  assert.equal(mail[0].triggerKey, "farm-visible:barn");
  assert.equal(isTeaserEmail(mail[0]), true);
  assert.match(mail[0].body, /Hire 10 Senior Developers/);
  // No re-mail on the next action (no transition).
  assert.equal(farmMail(clientState(1), clientState(2)).length, 0);
});

test("the 10th Senior sends the unlock mail, once", () => {
  const mail = farmMail(clientState(9), clientState(10));
  assert.equal(mail.length, 1);
  assert.equal(mail[0].triggerKey, "farm-unlocked:barn");
  assert.equal(isTeaserEmail(mail[0]), false);
  assert.equal(farmMail(clientState(10), clientState(11)).length, 0);
  // A bulk hire from 0 to 10 sends the unlock mail, not the teaser.
  const bulk = farmMail(clientState(0), clientState(10));
  assert.deepEqual(bulk.map((e) => e.triggerKey), ["farm-unlocked:barn"]);
});

test("no unlock mail when the barn is already owned", () => {
  const owned = initialFarmState();
  assert.equal(farmMail(clientState(9, owned), clientState(10, owned)).length, 0);
  assert.equal(farmMail(clientState(0, owned), clientState(1, owned)).length, 0);
});

test("a sale re-locks the farm: the next company earns it again", () => {
  const save = initialSaveState();
  const pre = {
    ...save,
    totalLinesOfCode: 80_000_000,
    employees: { ...save.employees, senior: 25 },
    farm: initialFarmState(),
  };
  assert.equal(farmUnlockConditionsMet(pre), true);
  const post = applyPrestigeSale(pre, "123e4567-e89b-42d3-a456-426614174999");
  assert.equal(post.farm.owned, false);
  assert.equal(farmUnlockConditionsMet(post), false);
});

test("farm unlock copy has no em dashes", () => {
  const texts = [
    buildFarmUnlockedEmail(),
    buildFarmVisibleEmail({ requirementText: "Hire 10 Senior Developers" }),
  ].flatMap((mail) => [mail.sender, mail.subject, mail.body]);
  for (const text of texts) assert.ok(!text.includes("—"), text);
});
