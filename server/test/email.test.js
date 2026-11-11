/**
 * Tests for the in-game email system (issue #31): the inbox module
 * (`client/src/email/email.js`) and the save-shape round trip
 * (`client/src/save/serialize.js` + server validation of the emails
 * field). Server-shape tests for the emails field live in
 * validate.test.js; this file tests the client-side behavior.
 *
 * The trigger tests build minimal client-shaped reducer states (the
 * email adapters read latches, levels, and total LOC from them).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  addEmail,
  markEmailRead,
  unreadEmailCount,
  collectTriggerEmails,
} from "../../client/src/email/email.js";
import {
  bigActionFields,
  bigActionIncreased,
  isInitialSaveState,
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";
import { initialSaveState } from "../../shared/game-balance.js";

const CLAIM_ID = "123e4567-e89b-42d3-a456-426614174001";

function validEmail(overrides = {}) {
  return {
    id: "123e4567-e89b-42d3-a456-426614174002",
    triggerKey: "test:one",
    sender: "HR Dept",
    subject: "Hello",
    body: "World.",
    createdAtMs: 1_700_000_000_000,
    read: false,
    ...overrides,
  };
}

/** Minimal client-shaped reducer state for the trigger adapters. */
function gameState(overrides = {}) {
  return {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    money: 0,
    activeTab: "shop",
    employees: {
      intern: { count: 0 },
      junior: { count: 0 },
      senior: { count: 0 },
    },
    aiAssistants: { noPilot: { count: 0 } },
    freelanceProjectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    unlockedEmployees: { intern: true, junior: false, senior: false },
    openSourceProjects: {
      overReactFramework: { level: 0 },
      blocker: { level: 0 },
      constellation: { level: 0 },
    },
    unlockedOpenSourceProjects: {
      overReactFramework: true,
      blocker: false,
      constellation: true,
    },
    activeStarEffects: [],
    emails: [],
    ...overrides,
  };
}

test("addEmail: one email per trigger key, no duplicates", () => {
  const first = addEmail([], { sender: "HR Dept", subject: "A", body: "B" }, "k:1", 1000);
  assert.equal(first.emails.length, 1);
  assert.ok(first.added);
  assert.equal(first.added.triggerKey, "k:1");
  assert.equal(first.added.read, false);
  const second = addEmail(
    first.emails,
    { sender: "HR Dept", subject: "A2", body: "B2" },
    "k:1",
    2000
  );
  assert.equal(second.emails.length, 1);
  assert.equal(second.added, null);
  assert.equal(second.emails[0].subject, "A");
});

test("addEmail: inbox caps at 25, oldest deleted first", () => {
  let emails = [];
  for (let i = 0; i < 26; i += 1) {
    const result = addEmail(
      emails,
      { sender: "S", subject: `Mail ${i}`, body: "B" },
      `k:${i}`,
      1000 + i
    );
    emails = result.emails;
  }
  assert.equal(emails.length, 25);
  assert.equal(emails[0].triggerKey, "k:1");
  assert.equal(emails[24].triggerKey, "k:25");
});

test("markEmailRead + unreadEmailCount", () => {
  const a = validEmail({ id: "123e4567-e89b-42d3-a456-426614174002" });
  const b = validEmail({
    id: "123e4567-e89b-42d3-a456-426614174003",
    triggerKey: "test:two",
  });
  const inbox = [a, b];
  assert.equal(unreadEmailCount(inbox), 2);
  const read = markEmailRead(inbox, a.id);
  assert.equal(unreadEmailCount(read), 1);
  assert.equal(read[0].read, true);
  assert.equal(read[1].read, false);
  // Marking an already-read (or unknown) id returns the same array.
  assert.equal(markEmailRead(read, a.id), read);
  assert.equal(markEmailRead(read, "123e4567-e89b-42d3-a456-426614174099"), read);
  assert.equal(unreadEmailCount([]), 0);
});

test("employee teaser fires once when the employee becomes visible", () => {
  // Junior unlocks at 100 total LOC; visibility is 10% progress (10 LOC).
  const prev = gameState({ totalLinesOfCode: 0 });
  const next = gameState({ totalLinesOfCode: 50 });
  const { emails, newEmailId } = collectTriggerEmails(prev, next);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].triggerKey, "employee-visible:junior");
  assert.equal(emails[0].sender, "HR Dept");
  assert.match(emails[0].subject, /Junior Developer/);
  assert.match(emails[0].body, /100 total lines of code/);
  assert.equal(newEmailId, emails[0].id);
  // Same transition again: no second teaser (dedup by trigger key).
  const again = collectTriggerEmails(prev, { ...next, emails });
  assert.equal(again.emails.length, 1);
  assert.equal(again.newEmailId, null);
});

test("employee unlock email fires on the latch flip, not the teaser", () => {
  // Teaser already sent at 50 LOC; now the latch flips at 150 LOC.
  const teaser = collectTriggerEmails(
    gameState({ totalLinesOfCode: 0 }),
    gameState({ totalLinesOfCode: 50 })
  ).emails;
  const prev = gameState({
    totalLinesOfCode: 50,
    emails: teaser,
  });
  const next = gameState({
    totalLinesOfCode: 150,
    emails: teaser,
    unlockedEmployees: { intern: true, junior: true, senior: false },
  });
  const { emails } = collectTriggerEmails(prev, next);
  assert.equal(emails.length, 2);
  assert.equal(emails[1].triggerKey, "employee-unlocked:junior");
  assert.match(emails[1].subject, /available to hire/);
});

test("no teaser when visibility and unlock coincide in one jump", () => {
  // 0 -> 150 total LOC in one transition: junior unlocks outright.
  const prev = gameState({ totalLinesOfCode: 0 });
  const next = gameState({
    totalLinesOfCode: 150,
    unlockedEmployees: { intern: true, junior: true, senior: false },
  });
  const { emails } = collectTriggerEmails(prev, next);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].triggerKey, "employee-unlocked:junior");
});

test("no backfill: an already-unlocked employee does not mail on restore", () => {
  // A restored save with junior unlocked but no mail: the latch did
  // not flip in this transition, so nothing is sent. Total LOC 50 is
  // below senior's 10% visibility threshold (3000), so no senior
  // teaser fires either.
  const state = gameState({
    totalLinesOfCode: 50,
    unlockedEmployees: { intern: true, junior: true, senior: false },
  });
  const { emails, newEmailId } = collectTriggerEmails(state, state);
  assert.equal(emails.length, 0);
  assert.equal(newEmailId, null);
});

test("open-source level email fires per level crossed", () => {
  const prev = gameState();
  const next = gameState({
    openSourceProjects: {
      overReactFramework: { level: 1 },
      blocker: { level: 0 },
      constellation: { level: 0 },
    },
  });
  const { emails } = collectTriggerEmails(prev, next);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].triggerKey, "opensource-level:overReactFramework:1");
  assert.equal(emails[0].sender, "GitNub");
  assert.match(emails[0].subject, /v1\.0/);
});

test("open-source unlock + teaser follow the same latch/visibility rules", () => {
  // Blocker unlocks at 5 juniors; visible at 10% progress (1 junior).
  // Hiring the first junior also makes Senior visible: its employee
  // count condition is 1/10 = 10%, and visibility is ANY condition at
  // 10% (the same rule the Shop uses to show the locked card). So two
  // teasers fire here — one per newly visible unlock.
  const prev = gameState();
  const visible = gameState({
    employees: {
      intern: { count: 0 },
      junior: { count: 1 },
      senior: { count: 0 },
    },
  });
  const teaser = collectTriggerEmails(prev, visible).emails;
  assert.equal(teaser.length, 2);
  assert.deepEqual(
    teaser.map((entry) => entry.triggerKey),
    ["employee-visible:senior", "opensource-visible:blocker"]
  );
  const unlocked = gameState({
    employees: {
      intern: { count: 0 },
      junior: { count: 5 },
      senior: { count: 0 },
    },
    emails: teaser,
    unlockedOpenSourceProjects: {
      overReactFramework: true,
      blocker: true,
      constellation: true,
    },
  });
  const { emails } = collectTriggerEmails(visible, unlocked);
  assert.equal(emails.length, 3);
  assert.equal(emails[2].triggerKey, "opensource-unlocked:blocker");
});

test("star reward email fires once per claim, keyed by claimId", () => {
  const claim = {
    effect: "lucky",
    good: true,
    locDelta: 500,
    moneyDelta: 0,
    multiplier: null,
    durationSeconds: null,
    employeeType: null,
    claimId: CLAIM_ID,
  };
  const state = gameState();
  const { emails, newEmailId } = collectTriggerEmails(state, state, claim);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].triggerKey, `star-reward:${CLAIM_ID}`);
  assert.equal(emails[0].sender, "GitNub");
  assert.equal(emails[0].subject, "A star fell on your repo!");
  assert.match(emails[0].body, /Airdrop/);
  assert.match(emails[0].body, /\+500 LOC/);
  // Same claim again: dedup by claimId.
  const again = collectTriggerEmails(state, { ...state, emails }, claim);
  assert.equal(again.emails.length, 1);
  assert.equal(again.newEmailId, null);
});

test("star reward email reports a bad outcome with its locked name", () => {
  const claim = {
    effect: "frenzy",
    good: false,
    locDelta: 0,
    moneyDelta: 0,
    multiplier: 0.5,
    durationSeconds: 30,
    employeeType: null,
    claimId: CLAIM_ID,
  };
  const { emails } = collectTriggerEmails(gameState(), gameState(), claim);
  assert.equal(emails.length, 1);
  assert.match(emails[0].body, /Throttling/);
  assert.match(emails[0].body, /Production x0\.5/);
});

test("save shape round-trips emails, and a new email is a big action", () => {
  const clientState = {
    ...gameState(),
    linesOfCode: 10,
    totalLinesOfCode: 10,
    emails: [validEmail()],
  };
  const saveState = stateToSaveState(clientState);
  assert.equal(saveState.emails.length, 1);
  assert.equal(saveState.emails[0].triggerKey, "test:one");
  const restored = saveStateToGameFields(saveState);
  assert.equal(restored.emails.length, 1);
  assert.equal(restored.emails[0].subject, "Hello");
  // A fresh save has no emails; one arriving is a big action (saves promptly).
  const fresh = initialSaveState();
  assert.equal(isInitialSaveState(fresh), true);
  assert.equal(isInitialSaveState(saveState), false);
  assert.equal(
    bigActionIncreased(bigActionFields(fresh), bigActionFields(saveState)),
    true
  );
  assert.equal(
    bigActionIncreased(bigActionFields(saveState), bigActionFields(saveState)),
    false
  );
});
