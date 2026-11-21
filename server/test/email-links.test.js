/**
 * Tests for email deep links (issue #173).
 *
 * - Every email that mentions a specific thing carries a target
 *   ({ tab, itemId }) to it: employees -> Hire ("shop"), open-source
 *   projects -> Open Source, freelance projects -> Projects, farm
 *   mail -> Farm, achievements -> Trophies. Teasers and unlocks both
 *   link; star rewards do not.
 * - A batched achievement mail lists every trophy with its name and
 *   its flavor line (from the definitions), each linked to its card.
 * - An email with no target (every email from before this shipped)
 *   renders with no link and no error; a malformed one is dropped.
 * - The server's save shape check accepts the optional fields and
 *   rejects malformed ones.
 * - One shared navigation mechanism: NAVIGATE_TO_TARGET records a
 *   highlight, the matching HighlightAnchor consumes it once, so a
 *   re-render never re-flashes.
 *
 * The React components cannot run in the server suite (no React
 * installed here); their wiring is pinned by source checks, the
 * logic by the pure modules they call.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSave } from "../src/validate.js";

function zeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

/** No actions since the last save (every count map present). */
function zeroActions() {
  return {
    clicks: 0,
    employeesBought: zeroCounts(EMPLOYEE_TYPES),
    projectsCompleted: zeroCounts(FREELANCE_PROJECT_KEYS),
    autoShips: zeroCounts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: zeroCounts(OPEN_SOURCE_IDS),
  };
}
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_EMAIL_OUTRO,
  EMAIL_CONFIG,
  EMAIL_LINK_TABS,
  EMPLOYEE_DISPLAY_NAMES,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_DISPLAY_NAMES,
  OPEN_SOURCE_IDS,
  achievementEmailEntries,
  achievementTierLabel,
  buildAchievementEmail,
  buildEmployeeUnlockedEmail,
  buildEmployeeVisibleEmail,
  buildFarmNewTypeEmail,
  buildFarmPurchasedEmail,
  buildFarmUnlockedEmail,
  buildFarmVisibleEmail,
  buildFreelanceProjectUnlockedEmail,
  buildFreelanceProjectVisibleEmail,
  buildOpenSourceLevelEmail,
  buildOpenSourceUnlockedEmail,
  buildOpenSourceVisibleEmail,
  buildStarRewardEmail,
  emailTarget,
  emailTargetError,
  emailTrophiesError,
  emptyFarmState,
  initialFarmState,
  initialSaveState,
  sanitizeEmailTarget,
} from "../../shared/game-balance.js";
import {
  addEmail,
  collectTriggerEmails,
  emailDetailModel,
  emailLinkLabel,
  isTeaserEmail,
} from "../../client/src/email/email.js";
import {
  clearHighlight,
  consumeHighlight,
  highlightMatches,
  navigateToTarget,
} from "../../client/src/navigation/highlight.js";
import {
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
const EMAIL_ID = "123e4567-e89b-42d3-a456-426614174002";

const read = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

/** A full client-shaped state: the fresh save, as the client holds it. */
function clientState(overrides = {}) {
  return {
    ...saveStateToGameFields(initialSaveState()),
    activeTab: "shop",
    highlightTarget: null,
    highlightSeq: 0,
    ...overrides,
  };
}

function withEmployees(state, counts) {
  const employees = { ...state.employees };
  for (const [type, count] of Object.entries(counts)) {
    employees[type] = { ...employees[type], count };
  }
  return { ...state, employees };
}

/** The target an email's trigger key says it should link to. */
function expectedTarget(triggerKey) {
  const [kind, id] = triggerKey.split(":");
  if (kind.startsWith("employee-")) return { tab: "shop", itemId: id };
  if (kind.startsWith("opensource-")) return { tab: "openSource", itemId: id };
  if (kind.startsWith("freelance-")) return { tab: "projects", itemId: id };
  if (kind.startsWith("farm-")) return { tab: "farm", itemId: null };
  // Night Shift discovery (issue #195): the card on the Hire tab.
  if (kind.startsWith("night-shift-")) return { tab: "shop", itemId: "nightShift" };
  return undefined; // star rewards and anything else: no link
}

// --- Targets per trigger ---

test("every trigger the adapters send carries the target its key names", () => {
  const seen = new Set();
  const check = (prev, next, starClaim = null) => {
    const { emails } = collectTriggerEmails(prev, next, starClaim);
    for (const mail of emails) {
      const expected = expectedTarget(mail.triggerKey);
      assert.deepEqual(mail.target, expected, mail.triggerKey);
      seen.add(`${mail.triggerKey.split(":")[0]}`);
    }
    return emails;
  };
  const base = clientState();

  // Unlocks, one kind per transition (the inbox caps at 25): every
  // employee latch, every open-source latch, a level on every
  // project, every freelance latch.
  const allTrue = (keys) => Object.fromEntries(keys.map((k) => [k, true]));
  const unlockMail = [
    ...check(base, { ...base, unlockedEmployees: allTrue(EMPLOYEE_TYPES) }),
    ...check(base, { ...base, unlockedOpenSourceProjects: allTrue(OPEN_SOURCE_IDS) }),
    ...check(base, {
      ...base,
      openSourceProjects: Object.fromEntries(OPEN_SOURCE_IDS.map((id) => [id, { level: 1 }])),
    }),
    ...check(base, { ...base, unlockedFreelanceProjects: allTrue(FREELANCE_PROJECT_KEYS) }),
  ];
  for (const type of EMPLOYEE_TYPES) {
    if (base.unlockedEmployees[type]) continue;
    const mail = unlockMail.find((m) => m.triggerKey === `employee-unlocked:${type}`);
    assert.deepEqual(mail.target, { tab: "shop", itemId: type });
  }
  for (const id of OPEN_SOURCE_IDS) {
    const level = unlockMail.find((m) => m.triggerKey === `opensource-level:${id}:1`);
    assert.deepEqual(level.target, { tab: "openSource", itemId: id });
    if (base.unlockedOpenSourceProjects[id]) continue;
    const mail = unlockMail.find((m) => m.triggerKey === `opensource-unlocked:${id}`);
    assert.deepEqual(mail.target, { tab: "openSource", itemId: id });
  }
  for (const key of FREELANCE_PROJECT_KEYS) {
    if (base.unlockedFreelanceProjects[key]) continue;
    const mail = unlockMail.find((m) => m.triggerKey === `freelance-unlocked:${key}`);
    assert.deepEqual(mail.target, { tab: "projects", itemId: key });
  }

  // Teasers: one Junior makes Senior, Blocker and Junior Achievement
  // visible; one Senior makes the Farm visible; 20 shipped To-Do
  // apps make the Hobby Website visible.
  const teasers = check(
    base,
    withEmployees(
      {
        ...base,
        freelanceProjectsCompleted: { ...base.freelanceProjectsCompleted, toDoListApp: 20 },
      },
      { junior: 1, senior: 1 }
    )
  );
  for (const key of [
    "employee-visible:senior",
    "opensource-visible:blocker",
    "freelance-visible:hobbyWebsite",
    "farm-visible:barn",
    "night-shift-visible:1",
  ]) {
    const mail = teasers.find((m) => m.triggerKey === key);
    assert.ok(mail, key);
    assert.equal(isTeaserEmail(mail), true, key);
  }

  // Farm: unlocked (10 Seniors), bought, a new bred type.
  check(withEmployees(base, { senior: 9 }), withEmployees(base, { senior: 10 }));
  check({ ...base, farm: emptyFarmState() }, { ...base, farm: initialFarmState() });
  check(
    { ...base, farm: initialFarmState() },
    { ...base, farm: { ...initialFarmState(), unlockedTypes: ["classic", "drama", "spaghetti"] } }
  );

  // A star reward has no target.
  const star = check(base, base, { effect: "lucky", good: true, claimId: "c1", loc: 10 });
  assert.equal(star.length, 1);
  assert.equal("target" in star[0], false);

  for (const kind of [
    "employee-unlocked",
    "employee-visible",
    "opensource-unlocked",
    "opensource-visible",
    "opensource-level",
    "freelance-unlocked",
    "freelance-visible",
    "farm-visible",
    "farm-unlocked",
    "farm-purchased",
    "farm-new-type",
    "night-shift-visible",
    "star-reward",
  ]) {
    assert.ok(seen.has(kind), `covered ${kind}`);
  }
});

test("each builder attaches its target from the item id it is given", () => {
  assert.deepEqual(
    buildEmployeeVisibleEmail({ employeeName: "Senior Developer", requirementText: "x", employeeType: "senior" }).target,
    { tab: "shop", itemId: "senior" }
  );
  assert.deepEqual(
    buildEmployeeUnlockedEmail({ employeeName: "Senior Developer", employeeType: "senior" }).target,
    { tab: "shop", itemId: "senior" }
  );
  assert.deepEqual(
    buildOpenSourceVisibleEmail({ projectName: "Blocker", requirementText: "x", projectId: "blocker" }).target,
    { tab: "openSource", itemId: "blocker" }
  );
  assert.deepEqual(
    buildOpenSourceUnlockedEmail({ projectName: "Blocker", projectId: "blocker" }).target,
    { tab: "openSource", itemId: "blocker" }
  );
  assert.deepEqual(
    buildOpenSourceLevelEmail({ projectName: "Blocker", level: 2, projectId: "blocker" }).target,
    { tab: "openSource", itemId: "blocker" }
  );
  assert.deepEqual(
    buildFreelanceProjectVisibleEmail({ projectName: "Hobby Website", requirementText: "x", projectKey: "hobbyWebsite" }).target,
    { tab: "projects", itemId: "hobbyWebsite" }
  );
  assert.deepEqual(
    buildFreelanceProjectUnlockedEmail({ projectName: "Hobby Website", projectKey: "hobbyWebsite" }).target,
    { tab: "projects", itemId: "hobbyWebsite" }
  );
  for (const mail of [
    buildFarmVisibleEmail({ requirementText: "x" }),
    buildFarmUnlockedEmail(),
    buildFarmPurchasedEmail(),
    buildFarmNewTypeEmail({ typeName: "Drama Llama", typeDescription: "x" }),
  ]) {
    assert.deepEqual(mail.target, { tab: "farm", itemId: null });
  }
  // Without an id (or with a bogus one) there is no link, never a broken one.
  assert.equal("target" in buildEmployeeUnlockedEmail({ employeeName: "X" }), false);
  assert.equal("target" in buildEmployeeUnlockedEmail({ employeeName: "X", employeeType: "ceo" }), false);
  assert.equal("target" in buildStarRewardEmail({ effectName: "Airdrop", rewardText: "+5 LOC", good: true }), false);
});

// --- Achievements: one entry per trophy ---

test("a batched achievement mail lists every trophy with its name and description, each linked", () => {
  const unlocked = [
    { id: "internalAffairs", tier: 1 },
    { id: "internalAffairs", tier: 2 },
    { id: "helloWorld", tier: 1 },
    { id: "headcountHoarder", tier: 1 },
  ];
  const mail = buildAchievementEmail({ unlocked });
  assert.equal(mail.subject, "4 achievements unlocked");
  assert.deepEqual(mail.trophies, unlocked);
  assert.deepEqual(mail.target, { tab: "achievements", itemId: "internalAffairs" });
  const ids = ["internalAffairs", "helloWorld", "headcountHoarder"];
  for (const id of ids) {
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    // Name and flavor come from the definitions, one line per trophy.
    const line = mail.body.split("\n").find((l) => l.startsWith(def.name));
    assert.ok(line, id);
    assert.ok(line.endsWith(def.flavor), id);
  }
  // The detail view's entries: every trophy, grouped tiers, linked.
  const filed = addEmail([], mail, "achievement:internalAffairs:1", T0).added;
  const detail = emailDetailModel(filed);
  assert.equal(detail.body, null);
  assert.equal(detail.link, null);
  assert.equal(detail.outro, ACHIEVEMENT_EMAIL_OUTRO);
  assert.deepEqual(detail.trophies.map((e) => e.id), ids);
  for (const entry of detail.trophies) {
    const def = ACHIEVEMENTS.find((a) => a.id === entry.id);
    assert.equal(entry.name, def.name);
    assert.equal(entry.flavor, def.flavor);
    assert.deepEqual(entry.target, { tab: "achievements", itemId: def.id });
  }
  const affairs = detail.trophies[0];
  assert.deepEqual(affairs.tiers, [1, 2]);
  assert.equal(affairs.tierText, ` ${achievementTierLabel(1)}, ${achievementTierLabel(2)}`);
  assert.equal(affairs.buffPercent, 3);
  assert.equal(affairs.goal, "Hire 5 Interns.");
});

test("every tier of every trophy in one mail: the list has them all and the body fits its cap", () => {
  const unlocked = ACHIEVEMENTS.flatMap((def) =>
    def.thresholds.map((_, i) => ({ id: def.id, tier: i + 1 }))
  );
  assert.equal(unlocked.length, EMAIL_CONFIG.maxTrophies);
  const mail = buildAchievementEmail({ unlocked });
  assert.ok(mail.body.length <= EMAIL_CONFIG.maxBodyLength);
  assert.ok(mail.body.endsWith(ACHIEVEMENT_EMAIL_OUTRO));
  assert.equal(emailTrophiesError(mail.trophies), null);
  const entries = achievementEmailEntries(mail.trophies);
  assert.equal(entries.length, ACHIEVEMENTS.length);
  // The stored record passes the server's shape check.
  const filed = addEmail([], mail, "achievement:helloWorld:1", T0).added;
  const after = { ...initialSaveState(), emails: [{ ...filed, id: EMAIL_ID }] };
  assert.deepEqual(
    validateSave(
      { state: initialSaveState(), savedAtMs: T0 },
      { playerId: PLAYER_ID, state: after, actionsSinceLastSave: zeroActions() },
      T0 + 60_000
    ),
    { ok: true }
  );
});

test("achievement entries drop unknown trophies and bad tiers instead of throwing", () => {
  assert.deepEqual(achievementEmailEntries(undefined), []);
  assert.deepEqual(achievementEmailEntries("nope"), []);
  const entries = achievementEmailEntries([
    { id: "ghost", tier: 1 },
    { id: "helloWorld", tier: 9 },
    { id: "helloWorld", tier: 1 },
    null,
  ]);
  assert.deepEqual(entries.map((e) => e.id), ["helloWorld"]);
});

// --- Targetless and malformed emails ---

test("an email with no target renders its body with no link and no error", () => {
  const old = {
    id: EMAIL_ID,
    triggerKey: "employee-unlocked:junior",
    sender: "HR Dept",
    subject: "Junior Developer is available to hire!",
    body: "Hire them.",
    createdAtMs: T0,
    read: false,
  };
  assert.deepEqual(emailDetailModel(old), {
    body: "Hire them.",
    trophies: null,
    outro: null,
    link: null,
  });
  // An old achievement mail (text list, no trophies) shows its text.
  const oldTrophy = { ...old, triggerKey: "achievement:helloWorld:1", body: "Hello, World: +1% LOC" };
  assert.equal(emailDetailModel(oldTrophy).body, "Hello, World: +1% LOC");
  assert.equal(emailDetailModel(oldTrophy).trophies, null);
  // Missing fields and junk never throw.
  for (const junk of [undefined, null, {}, { body: 7 }, { target: "shop" }]) {
    const model = emailDetailModel(junk);
    assert.equal(model.body, "");
    assert.equal(model.link, null);
  }
});

test("a malformed target reads as no link, and addEmail never stores one", () => {
  for (const bad of [
    "shop",
    [],
    { tab: "shop" },
    { tab: "email", itemId: null },
    { tab: "settings", itemId: null },
    { tab: "shop", itemId: "ceo" },
    { tab: "shop", itemId: 3 },
    { tab: "farm", itemId: "spaghetti" },
    { tab: "shop", itemId: null },
    { tab: "shop", itemId: "junior", extra: true },
  ]) {
    assert.equal(sanitizeEmailTarget(bad), null, JSON.stringify(bad));
    assert.notEqual(emailTargetError(bad), null, JSON.stringify(bad));
    assert.equal(emailDetailModel({ body: "b", target: bad }).link, null);
    const { added } = addEmail([], { sender: "s", subject: "x", body: "b", target: bad, trophies: [{ id: "ghost", tier: 1 }] }, "k", T0);
    assert.equal("target" in added, false);
    assert.equal("trophies" in added, false);
  }
});

// --- Link labels ---

test("unlock links are a call to action; teaser links land on the unlock progress", () => {
  const label = (triggerKey, target) => emailLinkLabel({ triggerKey }, target);
  assert.equal(
    label("employee-unlocked:senior", emailTarget("shop", "senior")),
    `Hire a ${EMPLOYEE_DISPLAY_NAMES.senior}`
  );
  assert.equal(
    label("employee-visible:senior", emailTarget("shop", "senior")),
    `See the ${EMPLOYEE_DISPLAY_NAMES.senior} unlock progress`
  );
  assert.equal(
    label("opensource-level:blocker:2", emailTarget("openSource", "blocker")),
    `Contribute to ${OPEN_SOURCE_DISPLAY_NAMES.blocker}`
  );
  assert.equal(label("farm-visible:barn", emailTarget("farm")), "See the Farm unlock progress");
  assert.equal(label("farm-purchased", emailTarget("farm")), "Go to the Farm");
  // Every label the game can build is free of em dashes.
  const targets = [
    ...EMPLOYEE_TYPES.map((t) => emailTarget("shop", t)),
    ...OPEN_SOURCE_IDS.map((id) => emailTarget("openSource", id)),
    ...FREELANCE_PROJECT_KEYS.map((k) => emailTarget("projects", k)),
    ...ACHIEVEMENTS.map((a) => emailTarget("achievements", a.id)),
    emailTarget("farm"),
  ];
  for (const target of targets) {
    for (const key of ["x-unlocked:a", "employee-visible:a"]) {
      assert.ok(!label(key, target).includes("—"));
    }
  }
});

// --- Server shape check ---

test("the save shape check accepts targets and trophies and rejects malformed ones", () => {
  const entry = (overrides) => ({
    id: EMAIL_ID,
    triggerKey: "employee-visible:junior",
    sender: "HR Dept",
    subject: "We found a Junior Developer!",
    body: "We found a Junior Developer!",
    createdAtMs: T0,
    read: false,
    ...overrides,
  });
  const attempt = (email) =>
    validateSave(
      { state: initialSaveState(), savedAtMs: T0 },
      {
        playerId: PLAYER_ID,
        state: { ...initialSaveState(), emails: [email] },
        actionsSinceLastSave: zeroActions(),
      },
      T0 + 60_000
    );
  assert.deepEqual(attempt(entry({})), { ok: true }, "no target (old email)");
  assert.deepEqual(attempt(entry({ target: null })), { ok: true });
  assert.deepEqual(attempt(entry({ target: { tab: "shop", itemId: "junior" } })), { ok: true });
  assert.deepEqual(attempt(entry({ target: { tab: "farm", itemId: null } })), { ok: true });
  assert.deepEqual(
    attempt(entry({ trophies: [{ id: "helloWorld", tier: 1 }], target: { tab: "achievements", itemId: "helloWorld" } })),
    { ok: true }
  );
  for (const bad of [
    { target: { tab: "shop" } },
    { target: { tab: "shop", itemId: null } },
    { target: { tab: "settings", itemId: null } },
    { target: { tab: "shop", itemId: "x".repeat(65) } },
    { trophies: [] },
    { trophies: [{ id: "helloWorld", tier: 2 }] },
    { trophies: [{ id: "helloWorld", tier: 1, name: "x" }] },
    { links: [] },
  ]) {
    const r = attempt(entry(bad));
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.rule, "SHAPE", JSON.stringify(bad));
  }
  assert.deepEqual([...EMAIL_LINK_TABS], ["shop", "projects", "openSource", "farm", "achievements"]);
});

test("targets and trophies survive the client save round trip; the highlight is never saved", () => {
  const mail = buildAchievementEmail({ unlocked: [{ id: "helloWorld", tier: 1 }] });
  const { emails } = addEmail([], mail, "achievement:helloWorld:1", T0);
  const state = clientState({
    emails,
    highlightTarget: { tab: "shop", itemId: "junior", key: 1 },
  });
  const saved = stateToSaveState(state);
  assert.equal("highlightTarget" in saved, false);
  assert.equal("highlightSeq" in saved, false);
  assert.deepEqual(saved.emails[0].target, { tab: "achievements", itemId: "helloWorld" });
  assert.deepEqual(saved.emails[0].trophies, [{ id: "helloWorld", tier: 1 }]);
  const restored = saveStateToGameFields(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.emails, emails);
});

// --- Navigation: one mechanism, consumed once ---

test("following a link switches tab and records the highlight; a bad target is a no-op", () => {
  const state = clientState({ activeTab: "email" });
  const next = navigateToTarget(state, { tab: "openSource", itemId: "blocker" });
  assert.equal(next.activeTab, "openSource");
  assert.deepEqual(next.highlightTarget, { tab: "openSource", itemId: "blocker", key: 1 });
  assert.equal(highlightMatches(next.highlightTarget, "openSource", "blocker"), true);
  assert.equal(highlightMatches(next.highlightTarget, "openSource", "constellation"), false);
  assert.equal(highlightMatches(next.highlightTarget, "shop", "blocker"), false);
  for (const bad of [undefined, null, { tab: "email", itemId: null }, { tab: "shop", itemId: "ceo" }]) {
    assert.equal(navigateToTarget(state, bad), state);
  }
  // A tab-only target matches the tab-level anchor.
  const farm = navigateToTarget(state, { tab: "farm", itemId: null });
  assert.equal(highlightMatches(farm.highlightTarget, "farm"), true);
});

test("the highlight is consumed once: no re-flash on re-render, a new click flashes again", () => {
  const linked = navigateToTarget(clientState(), { tab: "shop", itemId: "junior" });
  const { key } = linked.highlightTarget;
  const consumed = consumeHighlight(linked, key);
  assert.equal(consumed.highlightTarget, null);
  // The anchor re-renders: nothing matches any more, so no flash.
  assert.equal(highlightMatches(consumed.highlightTarget, "shop", "junior"), false);
  // Consuming again (a double effect run) changes nothing.
  assert.equal(consumeHighlight(consumed, key), consumed);
  // A stale key never clears a newer link.
  const relinked = navigateToTarget(consumed, { tab: "shop", itemId: "junior" });
  assert.notEqual(relinked.highlightTarget.key, key);
  assert.equal(consumeHighlight(relinked, key), relinked);
  assert.equal(consumeHighlight(relinked, relinked.highlightTarget.key).highlightTarget, null);
  // A manual tab switch drops a target no card picked up.
  assert.equal(clearHighlight(relinked).highlightTarget, null);
  const idle = clientState();
  assert.equal(clearHighlight(idle), idle);
});

test("the components use the one shared mechanism", () => {
  const anchor = read("components/HighlightAnchor.jsx");
  assert.match(anchor, /highlightMatches\(/);
  assert.match(anchor, /type: "CONSUME_HIGHLIGHT"/);
  assert.match(anchor, /scrollIntoView/);
  assert.match(anchor, /highlight-flash/);
  const context = read("context/GameContext.jsx");
  // Wrapped in the Farm tab visit (issue #204: opening the farm clears
  // its birth badge); the navigation itself is still the shared helper.
  assert.match(context, /case "NAVIGATE_TO_TARGET": \{[^}]*?return withFarmVisit\(navigateToTarget\(/);
  assert.match(context, /case "CONSUME_HIGHLIGHT": \{\s*return consumeHighlight\(/);
  // Issue #174: the tab switch goes through showSection (the panes' one rule).
  assert.match(context, /return withFarmVisit\(showSection\(clearHighlight\(state\), activeTab\)\);/);
  const email = read("components/Email.jsx");
  assert.match(email, /emailDetailModel\(selectedEmail\)/);
  assert.match(email, /type: "NAVIGATE_TO_TARGET"/);
  // Every destination wraps its cards in the anchor, with its own tab.
  for (const [file, tab] of [
    ["components/Shop.jsx", "shop"],
    ["components/Projects.jsx", "projects"],
    ["components/OpenSource.jsx", "openSource"],
    ["components/Farm.jsx", "farm"],
    ["components/Achievements.jsx", "achievements"],
  ]) {
    const src = read(file);
    assert.match(src, new RegExp(`<HighlightAnchor[^>]*tab="${tab}"`), file);
  }
  // No hand-rolled scrolling anywhere else.
  for (const file of [
    "components/Shop.jsx",
    "components/Projects.jsx",
    "components/OpenSource.jsx",
    "components/Farm.jsx",
    "components/Achievements.jsx",
    "components/Email.jsx",
  ]) {
    assert.ok(!read(file).includes("scrollIntoView"), file);
  }
  // The flash honors reduced motion.
  const css = read("index.css");
  assert.match(css, /\.highlight-flash \{[^}]*animation: grq-highlight-flash/);
});

test("no em dashes in the new email copy", () => {
  const texts = [
    ACHIEVEMENT_EMAIL_OUTRO,
    buildAchievementEmail({ unlocked: [{ id: "helloWorld", tier: 1 }] }).body,
    ...ACHIEVEMENTS.map((def) => buildAchievementEmail({ unlocked: [{ id: def.id, tier: 1 }] }).subject),
  ];
  for (const text of texts) assert.ok(!text.includes("—"));
});
