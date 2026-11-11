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
  deleteEmail,
  highlightAmounts,
  markAllEmailsRead,
  markEmailRead,
  unreadEmailCount,
  collectTriggerEmails,
} from "../../client/src/email/email.js";
import {
  getUnlockProgressForFreelanceProject,
  hasCrossedUnlockThreshold,
} from "../../client/src/utils/unlockProgress.js";
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

/** Minimal client-shaped reducer state for the trigger adapters.
 * The freelance maps carry all seven projects (the four big ones
 * included): the adapters iterate FREELANCE_PROJECT_KEYS and the
 * progress helper warns on a missing key, so a 3-key map would
 * flood the output and misread the new projects' counts as 0.
 * Overrides merge into the maps instead of replacing them. */
function gameState(overrides = {}) {
  const {
    freelanceProjectsCompleted,
    unlockedFreelanceProjects,
    ...rest
  } = overrides;
  return {
    linesOfCode: 0,
    totalLinesOfCode: 0,
    money: 0,
    activeTab: "shop",
    employees: {
      intern: { count: 0 },
      junior: { count: 0 },
      senior: { count: 0 },
      projectManager: { count: 0 },
      commitSpecialist: { count: 0 },
    },
    aiAssistants: { noPilot: { count: 0 } },
    freelanceProjectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
      aiPoweredDashboard: 0,
      nftMarketplace: 0,
      metaverseRealEstate: 0,
      quantumToDoList: 0,
      ...freelanceProjectsCompleted,
    },
    unlockedEmployees: { intern: true, junior: false, senior: false, projectManager: false, commitSpecialist: false },
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
    unlockedFreelanceProjects: {
      toDoListApp: true,
      hobbyWebsite: false,
      paradigmShiftingBlockchainProject: false,
      aiPoweredDashboard: false,
      nftMarketplace: false,
      metaverseRealEstate: false,
      quantumToDoList: false,
      ...unlockedFreelanceProjects,
    },
    activeStarEffects: [],
    emails: [],
    ...rest,
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

test("markAllEmailsRead: every unread mail becomes read, already-read is a no-op", () => {
  const a = validEmail({ id: "123e4567-e89b-42d3-a456-426614174002" });
  const b = validEmail({
    id: "123e4567-e89b-42d3-a456-426614174003",
    triggerKey: "test:two",
  });
  const c = validEmail({
    id: "123e4567-e89b-42d3-a456-426614174004",
    triggerKey: "test:three",
    read: true,
  });
  const inbox = [a, b, c];
  assert.equal(unreadEmailCount(inbox), 2);
  const allRead = markAllEmailsRead(inbox);
  assert.equal(unreadEmailCount(allRead), 0);
  assert.equal(allRead[0].read, true);
  assert.equal(allRead[1].read, true);
  assert.equal(allRead[2].read, true);
  // The original array is untouched (pure function).
  assert.equal(unreadEmailCount(inbox), 2);
  // Nothing unread: the same array back, so a no-op tap changes no
  // state and triggers no save.
  assert.equal(markAllEmailsRead(allRead), allRead);
  const empty = [];
  assert.equal(markAllEmailsRead(empty), empty);
});

test("marking mail read is a big action (saves promptly, like a new email)", () => {
  const unread = {
    ...initialSaveState(),
    emails: [validEmail()],
  };
  const read = {
    ...initialSaveState(),
    emails: [validEmail({ read: true })],
  };
  // Same inbox count, only the read state changed — still a save.
  assert.equal(
    bigActionIncreased(bigActionFields(unread), bigActionFields(read)),
    true
  );
  assert.equal(
    bigActionIncreased(bigActionFields(read), bigActionFields(read)),
    false
  );
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
    unlockedEmployees: { intern: true, junior: true, senior: false, projectManager: false, commitSpecialist: false },
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
    unlockedEmployees: { intern: true, junior: true, senior: false, projectManager: false, commitSpecialist: false },
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
    unlockedEmployees: { intern: true, junior: true, senior: false, projectManager: false, commitSpecialist: false },
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
      projectManager: { count: 0 },
      commitSpecialist: { count: 0 },
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
      projectManager: { count: 0 },
      commitSpecialist: { count: 0 },
    },
    emails: teaser,
    unlockedOpenSourceProjects: {
      overReactFramework: true,
      blocker: true,
      constellation: true,
    },
  });
  // Five juniors also make the two new employee types visible (5/25 =
  // 20% of the Project Manager's employee-count condition, 5/20 = 25%
  // of the Commit Specialist's — both past the 10% visibility
  // threshold), so their teasers fire alongside the Blocker unlock.
  const { emails } = collectTriggerEmails(visible, unlocked);
  assert.equal(emails.length, 5);
  assert.deepEqual(
    emails.map((entry) => entry.triggerKey),
    [
      "employee-visible:senior",
      "opensource-visible:blocker",
      "employee-visible:projectManager",
      "employee-visible:commitSpecialist",
      "opensource-unlocked:blocker",
    ]
  );
});

test("Constellation teaser + unlock emails fire at 50 / 500 lifetime LOC", () => {
  // Constellation unlocks at TOTAL_LOC >= 500 (star fix slice);
  // visible at 10% progress (50 LOC). The adapters are generic over
  // OPEN_SOURCE_IDS, so the new condition flows through them. Junior
  // and Senior are already unlocked here, so their own visibility
  // emails (which also trigger on lifetime LOC) do not fire — only
  // the Constellation mail does.
  const alreadyUnlocked = { intern: true, junior: true, senior: true };
  const locked = gameState({
    unlockedEmployees: alreadyUnlocked,
    unlockedOpenSourceProjects: {
      overReactFramework: true,
      blocker: false,
      constellation: false,
    },
  });
  const visible = gameState({
    totalLinesOfCode: 50,
    unlockedEmployees: alreadyUnlocked,
    unlockedOpenSourceProjects: {
      overReactFramework: true,
      blocker: false,
      constellation: false,
    },
  });
  const teaser = collectTriggerEmails(locked, visible).emails;
  assert.equal(teaser.length, 1);
  assert.equal(teaser[0].triggerKey, "opensource-visible:constellation");
  assert.equal(teaser[0].sender, "GitNub");

  const unlocked = gameState({
    totalLinesOfCode: 500,
    unlockedEmployees: alreadyUnlocked,
    unlockedOpenSourceProjects: {
      overReactFramework: true,
      blocker: false,
      constellation: true,
    },
  });
  const { emails } = collectTriggerEmails(visible, unlocked);
  // Two emails: the Constellation unlock, and the StarBroker teaser —
  // StarBroker becomes visible at 500 LOC (10% of its 5000 unlock),
  // so the same transition that unlocks Constellation reveals
  // StarBroker. The adapters are generic over OPEN_SOURCE_IDS, so the
  // new project flows through them.
  assert.equal(emails.length, 2);
  assert.equal(emails[0].triggerKey, "opensource-unlocked:constellation");
  assert.equal(emails[1].triggerKey, "opensource-visible:starBroker");
});

test("freelance teaser fires once when the project becomes visible", () => {
  // Hobby Website unlocks at 50 To Do List Apps; visibility is 10%
  // progress (5 shipped).
  const prev = gameState();
  const next = gameState({
    freelanceProjectsCompleted: {
      toDoListApp: 5,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
  });
  const { emails, newEmailId } = collectTriggerEmails(prev, next);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].triggerKey, "freelance-visible:hobbyWebsite");
  assert.equal(emails[0].sender, "Freelance Board");
  assert.match(emails[0].subject, /Hobby Website/);
  assert.match(emails[0].body, /50 To Do List Apps/);
  assert.equal(newEmailId, emails[0].id);
  // Same transition again: no second teaser (dedup by trigger key).
  const again = collectTriggerEmails(prev, { ...next, emails });
  assert.equal(again.emails.length, 1);
  assert.equal(again.newEmailId, null);
});

test("freelance unlock email fires on the latch flip, not the teaser", () => {
  // Teaser already sent at 5 shipped; now the latch flips at 50.
  // The jump 5 -> 50 also crosses the Blockchain's 10% visibility
  // threshold (20 total projects), so its teaser fires in the same
  // transition — the never-both rule is per project. 50 total is also
  // 10% of the NFT Marketplace's 500-total condition, so its teaser
  // fires too.
  const teaser = collectTriggerEmails(
    gameState(),
    gameState({
      freelanceProjectsCompleted: {
        toDoListApp: 5,
        hobbyWebsite: 0,
        paradigmShiftingBlockchainProject: 0,
      },
    })
  ).emails;
  const prev = gameState({
    freelanceProjectsCompleted: {
      toDoListApp: 5,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    emails: teaser,
  });
  const next = gameState({
    freelanceProjectsCompleted: {
      toDoListApp: 50,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    emails: teaser,
    unlockedFreelanceProjects: {
      toDoListApp: true,
      hobbyWebsite: true,
      paradigmShiftingBlockchainProject: false,
    },
  });
  const { emails } = collectTriggerEmails(prev, next);
  assert.deepEqual(
    emails.map((entry) => entry.triggerKey),
    [
      "freelance-visible:hobbyWebsite",
      "freelance-unlocked:hobbyWebsite",
      "freelance-visible:paradigmShiftingBlockchainProject",
      "freelance-visible:nftMarketplace",
    ]
  );
  assert.match(emails[1].subject, /available to ship/);
});

test("blockchain teaser fires on ANY condition at 10% (total projects)", () => {
  // Blockchain unlocks at 200 total projects AND 50 Hobby Websites.
  // Visibility is ANY condition at 10%: 20 total projects shipped is
  // 10% of the total condition, so the Blockchain teaser fires even
  // with 0 Hobby Websites — and the Hobby Website teaser fires too,
  // since 20/50 is past its 10% threshold as well.
  const prev = gameState();
  const next = gameState({
    freelanceProjectsCompleted: {
      toDoListApp: 20,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
  });
  const { emails } = collectTriggerEmails(prev, next);
  assert.deepEqual(
    emails.map((entry) => entry.triggerKey),
    [
      "freelance-visible:hobbyWebsite",
      "freelance-visible:paradigmShiftingBlockchainProject",
    ]
  );
  assert.match(emails[1].body, /200 projects in total/);
});

test("no freelance teaser when visibility and unlock coincide in one jump", () => {
  // 0 -> 50 To Do List Apps in one transition: the Hobby Website
  // unlocks outright, so it sends only the unlocked email — no teaser
  // for that project. The Blockchain still sends its teaser, though:
  // 50/200 total projects is past its 10% visibility threshold, and
  // the never-both rule is per project, not global. The NFT
  // Marketplace teasers too: 50/500 total is exactly its 10%.
  const prev = gameState();
  const next = gameState({
    freelanceProjectsCompleted: {
      toDoListApp: 50,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    unlockedFreelanceProjects: {
      toDoListApp: true,
      hobbyWebsite: true,
      paradigmShiftingBlockchainProject: false,
    },
  });
  const { emails } = collectTriggerEmails(prev, next);
  assert.deepEqual(
    emails.map((entry) => entry.triggerKey),
    [
      "freelance-unlocked:hobbyWebsite",
      "freelance-visible:paradigmShiftingBlockchainProject",
      "freelance-visible:nftMarketplace",
    ]
  );
});

test("freelance unlock progress and the 10% visibility threshold", () => {
  const state = gameState({
    freelanceProjectsCompleted: {
      toDoListApp: 4,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
  });
  const progress = getUnlockProgressForFreelanceProject("hobbyWebsite", state);
  assert.deepEqual(progress, [
    {
      type: "SPECIFIC_PROJECT_COUNT",
      current: 4,
      target: 50,
      remaining: 46,
      projectKey: "toDoListApp",
      projectName: "To Do List App",
    },
  ]);
  // 4/50 is below 10%: not visible yet.
  assert.equal(
    hasCrossedUnlockThreshold("freelanceProject", "hobbyWebsite", state),
    false
  );
  // 5/50 is exactly 10%: visible.
  const visible = gameState({
    freelanceProjectsCompleted: {
      toDoListApp: 5,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
  });
  assert.equal(
    hasCrossedUnlockThreshold("freelanceProject", "hobbyWebsite", visible),
    true
  );
  // Blockchain progress has both conditions, in config order.
  const blockchain = getUnlockProgressForFreelanceProject(
    "paradigmShiftingBlockchainProject",
    gameState({
      freelanceProjectsCompleted: {
        toDoListApp: 150,
        hobbyWebsite: 49,
        paradigmShiftingBlockchainProject: 0,
      },
    })
  );
  assert.deepEqual(
    blockchain.map((entry) => [entry.type, entry.current, entry.target]),
    [
      ["TOTAL_PROJECTS_COUNT", 199, 200],
      ["SPECIFIC_PROJECT_COUNT", 49, 50],
    ]
  );
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
  assert.match(emails[0].body, /Production 0\.5x/);
});

test("star reward email reports an employee effect as a production change", () => {
  // Brandon's playtest note: "Meeting: Senior Developers x0.5" read
  // like a bare multiplier, not a production change. The detail now
  // says "0.5x productivity" (and "2x productivity" for a buff).
  const meeting = {
    effect: "employee",
    good: false,
    locDelta: 0,
    moneyDelta: 0,
    multiplier: 0.5,
    durationSeconds: 30,
    employeeType: "senior",
    claimId: CLAIM_ID,
  };
  const { emails: meetingEmails } = collectTriggerEmails(
    gameState(),
    gameState(),
    meeting
  );
  assert.equal(meetingEmails.length, 1);
  assert.match(meetingEmails[0].body, /Meeting/);
  assert.match(
    meetingEmails[0].body,
    /Senior Developers 0\.5x productivity/
  );
  const sprint = {
    effect: "employee",
    good: true,
    locDelta: 0,
    moneyDelta: 0,
    multiplier: 12,
    durationSeconds: 60,
    employeeType: "intern",
    claimId: "123e4567-e89b-42d3-a456-426614174009",
  };
  const { emails: sprintEmails } = collectTriggerEmails(
    gameState(),
    gameState(),
    sprint
  );
  assert.equal(sprintEmails.length, 1);
  assert.match(sprintEmails[0].body, /Sprint/);
  assert.match(sprintEmails[0].body, /Interns 12x productivity/);
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

test("deleteEmail: removes the entry, unknown id returns the same array", () => {
  const a = validEmail({ id: "123e4567-e89b-42d3-a456-426614174002" });
  const b = validEmail({
    id: "123e4567-e89b-42d3-a456-426614174003",
    triggerKey: "test:two",
  });
  const inbox = [a, b];
  const after = deleteEmail(inbox, a.id);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, b.id);
  // The original array is untouched (pure function).
  assert.equal(inbox.length, 2);
  // Deleting an unknown id returns the same array.
  assert.equal(
    deleteEmail(after, "123e4567-e89b-42d3-a456-426614174099"),
    after
  );
  // Deleting the last email leaves an empty inbox.
  assert.deepEqual(deleteEmail(after, b.id), []);
});

test("deleteEmail: the unread badge drops when the deleted mail was unread", () => {
  const unread = validEmail({
    id: "123e4567-e89b-42d3-a456-426614174002",
  });
  const read = validEmail({
    id: "123e4567-e89b-42d3-a456-426614174003",
    triggerKey: "test:two",
    read: true,
  });
  const inbox = [unread, read];
  assert.equal(unreadEmailCount(inbox), 1);
  // Deleting the unread mail drops the badge to zero.
  assert.equal(unreadEmailCount(deleteEmail(inbox, unread.id)), 0);
  // Deleting a read mail leaves the badge unchanged.
  assert.equal(unreadEmailCount(deleteEmail(inbox, read.id)), 1);
});

test("a deleted email is a big action (saves promptly, like a new email)", () => {
  const one = {
    ...initialSaveState(),
    emails: [validEmail()],
  };
  const empty = initialSaveState();
  assert.equal(
    bigActionIncreased(bigActionFields(one), bigActionFields(empty)),
    true
  );
  assert.equal(
    bigActionIncreased(bigActionFields(empty), bigActionFields(empty)),
    false
  );
});

test("highlightAmounts: gains green, losses red, for LOC and money", () => {
  // Star email bodies: "Rug Pull: -11.21K LOC." / "Airdrop: +11.21K LOC."
  const loss = highlightAmounts("Rug Pull: -11.21K LOC.");
  assert.deepEqual(loss, [
    { text: "Rug Pull: ", tone: null },
    { text: "-11.21K LOC", tone: "loss" },
    { text: ".", tone: null },
  ]);
  const gain = highlightAmounts("Airdrop: +500 LOC.");
  assert.deepEqual(gain, [
    { text: "Airdrop: ", tone: null },
    { text: "+500 LOC", tone: "gain" },
    { text: ".", tone: null },
  ]);
  // Money, with and without a suffix.
  assert.deepEqual(highlightAmounts("You got +$10.54."), [
    { text: "You got ", tone: null },
    { text: "+$10.54", tone: "gain" },
    { text: ".", tone: null },
  ]);
  assert.deepEqual(highlightAmounts("You lost -$1.5K."), [
    { text: "You lost ", tone: null },
    { text: "-$1.5K", tone: "loss" },
    { text: ".", tone: null },
  ]);
  // A shooting-stars burst reports both in one line.
  const burst = highlightAmounts("+11.21K LOC +$10.54");
  assert.deepEqual(burst, [
    { text: "+11.21K LOC", tone: "gain" },
    { text: " ", tone: null },
    { text: "+$10.54", tone: "gain" },
  ]);
});

test("highlightAmounts: multipliers color by value (buff green, debuff red)", () => {
  // Timed star effects report "{multiplier}x": above 1x is a buff
  // (green), below 1x a debuff (red). The multiplier token needs
  // digits before the "x".
  assert.deepEqual(highlightAmounts("Production 7x"), [
    { text: "Production ", tone: null },
    { text: "7x", tone: "gain" },
  ]);
  assert.deepEqual(highlightAmounts("Production 0.5x"), [
    { text: "Production ", tone: null },
    { text: "0.5x", tone: "loss" },
  ]);
  assert.deepEqual(
    highlightAmounts("Meeting: Senior Developers 0.5x productivity."),
    [
      { text: "Meeting: Senior Developers ", tone: null },
      { text: "0.5x", tone: "loss" },
      { text: " productivity.", tone: null },
    ]
  );
  assert.deepEqual(highlightAmounts("Sprint: Interns 2x productivity."), [
    { text: "Sprint: Interns ", tone: null },
    { text: "2x", tone: "gain" },
    { text: " productivity.", tone: null },
  ]);
  assert.deepEqual(highlightAmounts("AI Accelerator: Clicks 4x."), [
    { text: "AI Accelerator: Clicks ", tone: null },
    { text: "4x", tone: "gain" },
    { text: ".", tone: null },
  ]);
  // Exactly 1x is neither a buff nor a debuff: plain.
  assert.deepEqual(highlightAmounts("Production 1x"), [
    { text: "Production 1x", tone: null },
  ]);
});

test("highlightAmounts: no sign or no unit means no coloring", () => {
  // "x7" has the x BEFORE the digits, so it is not a multiplier
  // token (multipliers read "7x"). Plain numbers are not amounts.
  assert.deepEqual(highlightAmounts("Production x7"), [
    { text: "Production x7", tone: null },
  ]);
  assert.deepEqual(highlightAmounts("Earn 100 total lines of code"), [
    { text: "Earn 100 total lines of code", tone: null },
  ]);
  // A bare signed number with no unit ("level +5") stays plain.
  assert.deepEqual(highlightAmounts("Bonus level +5 applied"), [
    { text: "Bonus level +5 applied", tone: null },
  ]);
  assert.deepEqual(highlightAmounts(""), []);
});
