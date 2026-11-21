/**
 * Tests for Night Shift discovery (issue #195, the discoverability
 * half; the price half shipped in #245).
 *
 * - Mail: the farm's rules on the Night Shift level 1 gate. A teaser
 *   when the gate first becomes visible (10% of any condition: the
 *   first Junior, or 10 passive LOC/s), an unlock mail when it is met.
 *   Transition only, so a restored save never mails; never once a
 *   shift is hired (the Night Shift Contract included); fixed trigger
 *   keys, so the inbox dedupes them across sales like the farm's.
 * - Both mails link to the Night Shift card on the Hire tab.
 * - Placement: the card sits at the top of the Hire tab, under the
 *   quantity and sort controls and outside the sorted employee list.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NIGHT_SHIFT_CONFIG,
  NIGHT_SHIFT_EMAIL_ITEM_ID,
  applyPrestigeSale,
  buildNightShiftUnlockedEmail,
  buildNightShiftVisibleEmail,
  completePrestigeIntermission,
  emailTarget,
  emailTargetError,
  initialSaveState,
} from "../../shared/game-balance.js";
import {
  getUnlockProgressForNightShift,
  hasCrossedUnlockThreshold,
  isNightShiftUnlockMet,
} from "../../client/src/utils/unlockProgress.js";
import { formatCondition } from "../../client/src/utils/formatCondition.js";
import {
  collectTriggerEmails,
  emailDetailModel,
  isTeaserEmail,
} from "../../client/src/email/email.js";
import { saveStateToGameFields } from "../../client/src/save/serialize.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const SALE_ID = "123e4567-e89b-42d3-a456-426614174195";

/** A save-shaped state with these employee counts (others 0). */
function saveWith(counts = {}, overrides = {}) {
  const save = initialSaveState();
  return {
    ...save,
    employees: { ...save.employees, ...counts },
    ...overrides,
  };
}

/** The client-shaped reducer state the email adapters read. */
function clientState(counts = {}, overrides = {}) {
  return saveStateToGameFields(saveWith(counts, overrides));
}

function shiftMail(prev, next) {
  return collectTriggerEmails(prev, next).emails.filter((e) =>
    e.triggerKey.startsWith("night-shift-")
  );
}

// 20 Juniors (100 LOC/s, 10 or more of them): the level 1 gate met.
const GATE_MET = { junior: 20 };

test("the level 1 gate is the one the card shows: 100 passive LOC/s and 10 Juniors", () => {
  const gate = NIGHT_SHIFT_CONFIG.levels[0].gate;
  assert.deepEqual({ ...gate }, {
    minLocPerSecond: 100,
    employeeType: "junior",
    employeeCount: 10,
  });
  const progress = getUnlockProgressForNightShift(clientState({ junior: 3 }));
  assert.deepEqual(
    progress.map((entry) => [entry.type, entry.current, entry.target]),
    [
      ["PASSIVE_LOC_PER_SECOND", 15, 100],
      ["SPECIFIC_EMPLOYEE_COUNT", 3, 10],
    ]
  );
  assert.deepEqual(progress.map(formatCondition), [
    "Reach 100 passive LOC/s",
    "Hire 10 Junior Developers",
  ]);
  assert.equal(isNightShiftUnlockMet(clientState({ junior: 19 })), false, "95 LOC/s");
  assert.equal(isNightShiftUnlockMet(clientState({ junior: 9, intern: 60 })), false, "9 Juniors");
  assert.equal(isNightShiftUnlockMet(clientState(GATE_MET)), true);
  // A partial state reads 0, never throws.
  assert.equal(isNightShiftUnlockMet({}), false);
});

test("visible at 10% of either condition: the first Junior, or 10 passive LOC/s", () => {
  assert.equal(hasCrossedUnlockThreshold("nightShift", null, clientState()), false);
  assert.equal(hasCrossedUnlockThreshold("nightShift", null, clientState({ intern: 9 })), false);
  assert.equal(hasCrossedUnlockThreshold("nightShift", null, clientState({ intern: 10 })), true);
  assert.equal(hasCrossedUnlockThreshold("nightShift", null, clientState({ junior: 1 })), true);
});

test("the first Junior sends one teaser, linked to the card, and never again", () => {
  const mail = shiftMail(clientState(), clientState({ junior: 1 }));
  assert.equal(mail.length, 1);
  assert.equal(mail[0].triggerKey, "night-shift-visible:1");
  assert.equal(isTeaserEmail(mail[0]), true);
  assert.match(mail[0].body, /Reach 100 passive LOC\/s and Hire 10 Junior Developers/);
  assert.match(mail[0].body, /while the game is closed/);
  assert.match(mail[0].body, /top of the Hire tab/);
  assert.deepEqual(mail[0].target, { tab: "shop", itemId: NIGHT_SHIFT_EMAIL_ITEM_ID });
  assert.deepEqual(emailDetailModel(mail[0]).link, {
    target: { tab: "shop", itemId: "nightShift" },
    label: "See the Night Shift requirements",
  });
  // No transition, no mail.
  assert.equal(shiftMail(clientState({ junior: 1 }), clientState({ junior: 2 })).length, 0);
  // The same trigger again (dropping back under 10% cannot happen, but
  // even a repeat transition) is deduped by the inbox.
  const prev = { ...clientState(), emails: mail };
  const next = { ...clientState({ junior: 1 }), emails: mail };
  const again = shiftMail(prev, next);
  assert.equal(again.length, 1, "still the one teaser");
  assert.equal(again[0].id, mail[0].id);
});

test("meeting the gate sends the unlock mail once; a jump straight there skips the teaser", () => {
  const mail = shiftMail(clientState({ junior: 19 }), clientState(GATE_MET));
  assert.equal(mail.length, 1);
  assert.equal(mail[0].triggerKey, "night-shift-unlocked:1");
  assert.equal(isTeaserEmail(mail[0]), false);
  assert.match(mail[0].body, /while the game is closed/);
  assert.equal(emailDetailModel(mail[0]).link.label, "Hire the night shift");
  assert.equal(shiftMail(clientState(GATE_MET), clientState({ junior: 21 })).length, 0);
  const bulk = shiftMail(clientState(), clientState(GATE_MET));
  assert.deepEqual(bulk.map((e) => e.triggerKey), ["night-shift-unlocked:1"]);
});

test("no mail once a shift is hired, or when the Contract starts the company at level 1", () => {
  const hired = { nightShiftLevel: 1 };
  assert.equal(shiftMail(clientState({}, hired), clientState({ junior: 1 }, hired)).length, 0);
  assert.equal(
    shiftMail(clientState({ junior: 19 }, hired), clientState(GATE_MET, hired)).length,
    0
  );
  // Buying level 1 in the very action that meets the gate: no mail.
  assert.equal(shiftMail(clientState({ junior: 19 }), clientState(GATE_MET, hired)).length, 0);
});

test("no backfill: an existing save already past the gate gets no mail on load or later", () => {
  // RESTORE_SAVE runs no email triggers; the next action sees the same
  // gate on both sides, so nothing fires.
  const restored = clientState({ junior: 500, senior: 40 });
  assert.equal(shiftMail(restored, restored).length, 0);
  assert.equal(shiftMail(restored, clientState({ junior: 501, senior: 40 })).length, 0);
  // A save past the 10% mark but short of the gate: no teaser either.
  const midway = clientState({ junior: 5 });
  assert.equal(shiftMail(midway, clientState({ junior: 6 })).length, 0);
});

test("a sale resets the level and the gate; the next company re-mails only if the old mail is gone", () => {
  const pre = saveWith(
    { junior: 30, senior: 10 },
    { totalLinesOfCode: 80_000_000, nightShiftLevel: 3 }
  );
  const sold = applyPrestigeSale(pre, SALE_ID);
  assert.equal(sold.nightShiftLevel, 0);
  const done = completePrestigeIntermission(sold);
  assert.equal(done.nightShiftLevel, 0, "no Contract: level 0");
  const fresh = saveStateToGameFields(done);
  assert.equal(isNightShiftUnlockMet(fresh), false);
  assert.equal(hasCrossedUnlockThreshold("nightShift", null, fresh), false);
  // The sale itself (gate met -> not met) mails nothing.
  assert.equal(shiftMail(clientState({ junior: 30 }), fresh).length, 0);

  const firstJunior = (state) => ({
    ...state,
    employees: { ...state.employees, junior: { ...state.employees.junior, count: 1 } },
  });
  // The old company's teaser is still in the inbox: deduped, no repeat.
  const oldTeaser = shiftMail(clientState(), clientState({ junior: 1 }));
  const withOld = { ...fresh, emails: oldTeaser };
  const repeat = shiftMail(withOld, firstJunior(withOld));
  assert.deepEqual(repeat.map((e) => e.id), [oldTeaser[0].id]);
  // Aged out of the inbox (the 25-mail cap): it arrives once more.
  const empty = { ...fresh, emails: [] };
  assert.deepEqual(
    shiftMail(empty, firstJunior(empty)).map((e) => e.triggerKey),
    ["night-shift-visible:1"]
  );

  // With the Night Shift Contract the new company starts at level 1:
  // no discovery mail for a shift that is already working.
  const contract = completePrestigeIntermission(
    applyPrestigeSale(
      { ...pre, permanentStoreRanks: { ...pre.permanentStoreRanks, nightShiftContract: 1 } },
      SALE_ID
    )
  );
  assert.equal(contract.nightShiftLevel, 1);
  const contractState = saveStateToGameFields(contract);
  assert.equal(shiftMail(contractState, firstJunior(contractState)).length, 0);
});

test("the card's id is a valid Hire tab link target; anything else on the tab still is not", () => {
  assert.equal(emailTargetError({ tab: "shop", itemId: "nightShift" }), null);
  assert.deepEqual(emailTarget("shop", NIGHT_SHIFT_EMAIL_ITEM_ID), {
    tab: "shop",
    itemId: "nightShift",
  });
  assert.notEqual(emailTargetError({ tab: "shop", itemId: "nightShiftContract" }), null);
  assert.notEqual(emailTargetError({ tab: "projects", itemId: "nightShift" }), null);
});

test("the discovery copy is in the game voice: no em or en dashes", () => {
  const texts = [
    buildNightShiftVisibleEmail({ requirementText: "Hire 10 Junior Developers" }),
    buildNightShiftUnlockedEmail(),
  ].flatMap((mail) => [mail.sender, mail.subject, mail.body]);
  for (const text of texts) {
    assert.ok(!text.includes("—") && !text.includes("–"), text);
  }
  const labels = ["night-shift-visible:1", "night-shift-unlocked:1"].map(
    (triggerKey) =>
      emailDetailModel({
        triggerKey,
        body: "x",
        target: { tab: "shop", itemId: "nightShift" },
      }).link.label
  );
  for (const label of labels) assert.ok(!/[–—]/.test(label), label);
});

test("the Night Shift card sits at the top of the Hire tab, outside the sorted list", () => {
  const shop = readFileSync(
    new URL("../../client/src/components/Shop.jsx", import.meta.url),
    "utf8"
  );
  assert.equal((shop.match(/<NightShiftCard \/>/g) ?? []).length, 1, "rendered once");
  const card = shop.indexOf("<NightShiftCard />");
  const controls = shop.indexOf('<SortControl tab="shop" />');
  const list = shop.indexOf("{employeeTypes.map(");
  assert.ok(controls > 0 && list > 0);
  assert.ok(card > controls, "below the quantity and sort controls");
  assert.ok(card < list, "above the employee list, so no sort mode moves it");
  // The email links land on it.
  assert.match(
    shop,
    /<HighlightAnchor tab="shop" itemId=\{NIGHT_SHIFT_EMAIL_ITEM_ID\}>\s*<NightShiftCard \/>\s*<\/HighlightAnchor>/
  );
});

test("the Commit click float stays locked", () => {
  assertCommitFloatLocked();
});
