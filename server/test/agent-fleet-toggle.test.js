/**
 * Agent Fleet, slice 1 (issue #267): the Write code / Manage agents
 * toggle in the Commit button's spot, and the empty Review panel.
 *
 * Brandon: "people either write code and avoid AI as some purity test
 * or they manage agents nowadays, so it makes sense to swap the commit
 * button out for the panel."
 *
 * - Hidden below Series A (Funding Rounds rank 2, owned), shown from it.
 * - Two real buttons with aria-pressed, 44px tall.
 * - The mode is a device preference under `grq:workMode`, default
 *   "Write code", never in the save; blocked storage never breaks it.
 * - Write code mode is today's Commit button, unchanged (the click
 *   float lock still holds). Manage agents mode renders the Review
 *   panel and no Commit button.
 * - The unlock mail is sent once (per-device flag plus the inbox's
 *   trigger key dedup), only at Series A or later.
 *
 * The client components import React, so the component checks are
 * source checks, like the rest of the suite.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_FLEET_TOGGLE_EMAIL_TRIGGER_KEY,
  EMAIL_CONFIG,
  buildAgentFleetToggleEmail,
  zeroStoreRanks,
} from "../../shared/game-balance.js";
import {
  WORK_MODES,
  WORK_MODE_AGENTS,
  WORK_MODE_ANNOUNCED_KEY,
  WORK_MODE_KEY,
  WORK_MODE_UNLOCK_RANK,
  WORK_MODE_WRITE,
  claimWorkModeAnnouncement,
  effectiveWorkMode,
  readWorkMode,
  reviewQueueHeader,
  workModeUnlocked,
  writeWorkMode,
} from "../../client/src/utils/workMode.js";
import { addAgentFleetToggleEmail, addEmail } from "../../client/src/email/email.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const footer = () => src("components/Footer.jsx");
const toggle = () => src("components/WorkModeToggle.jsx");
const panel = () => src("components/ReviewPanel.jsx");

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const throwing = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("quota");
  },
};

const ranksAt = (fundingRounds) => ({ ...zeroStoreRanks(), fundingRounds });

// The Footer's JSX after the hook (the render, not the helpers).
function footerRender() {
  const s = footer();
  return s.slice(s.indexOf("export function Footer()"));
}

// --- Unlock ---

test("the toggle is hidden below Series A and shown from rank 2 on", () => {
  assert.equal(WORK_MODE_UNLOCK_RANK, 2, "Series A");
  assert.equal(workModeUnlocked(ranksAt(0)), false, "Bootstrapped");
  assert.equal(workModeUnlocked(ranksAt(1)), false, "Seed");
  assert.equal(workModeUnlocked(ranksAt(2)), true, "Series A");
  assert.equal(workModeUnlocked(ranksAt(5)), true, "IPO");
  assert.equal(workModeUnlocked(undefined), false, "no ranks yet");
  assert.equal(workModeUnlocked({ fundingRounds: "junk" }), false, "junk rank");
  // The shared owned-rank helper, not a rented Bridge Round.
  const util = src("utils/workMode.js");
  assert.match(util, /fundingRoundRank\(storeRanks \?\? \{\}\) >= WORK_MODE_UNLOCK_RANK/);
  assert.ok(!util.includes("effectiveFundingRoundRank"));
  // The Footer renders the toggle only when unlocked, in both layouts.
  const render = footerRender();
  const toggles = render.match(/\{unlocked \? \(\s*<WorkModeToggle/g) ?? [];
  assert.equal(toggles.length, 2, "mobile and desktop, both gated");
  assert.equal((render.match(/<WorkModeToggle/g) ?? []).length, 2);
});

test("below Series A the mode is always Write code, whatever the device remembers", () => {
  assert.equal(effectiveWorkMode(WORK_MODE_AGENTS, false), WORK_MODE_WRITE);
  assert.equal(effectiveWorkMode(WORK_MODE_AGENTS, true), WORK_MODE_AGENTS);
  assert.equal(effectiveWorkMode(WORK_MODE_WRITE, true), WORK_MODE_WRITE);
  assert.equal(effectiveWorkMode("junk", true), WORK_MODE_WRITE);
  // Below Series A the desktop Commit column keeps its old classes.
  assert.match(footer(), /unlocked\s*\? "flex w-72 flex-col items-end gap-1"\s*: "flex flex-col items-end gap-1"/);
  // Below Series A the mobile Commit panel keeps its old classes.
  assert.match(footer(), /unlocked \? "text-center mt-2 pt-3 pb-5" : "text-center mt-2 pb-5"/);
});

// --- The control ---

test("the toggle is two real buttons with aria-pressed, 44px tall, in a labelled group", () => {
  assert.deepEqual(
    WORK_MODES.map((m) => m.label),
    ["Write code", "Manage agents"]
  );
  const s = toggle();
  assert.match(s, /role="group"/);
  assert.match(s, /aria-label="Work mode"/);
  assert.match(s, /<button[\s\S]*type="button"[\s\S]*aria-pressed=\{active\}/);
  assert.match(s, /const active = mode === option\.id;/);
  assert.match(s, /\bh-11\b/, "44px tall");
  // The chosen segment is the game's button blue; the other is recessed.
  assert.match(s, /active\s*\?\s*"bg-blue-700 text-white/);
  assert.match(s, /bg-\[#181818\]/);
});

test("player-facing copy has no em or en dashes", () => {
  const mail = buildAgentFleetToggleEmail();
  const copy = [
    ...WORK_MODES.map((m) => m.label),
    reviewQueueHeader(0),
    mail.sender,
    mail.subject,
    mail.body,
    panel(),
    toggle(),
  ].join("\n");
  assert.ok(!/[–—]/.test(copy));
});

// --- Persistence ---

test("the mode lives under grq:workMode, defaults to Write code, and round-trips", () => {
  assert.equal(WORK_MODE_KEY, "grq:workMode");
  const storage = memoryStorage();
  assert.equal(readWorkMode(storage), WORK_MODE_WRITE, "nothing stored");
  writeWorkMode(WORK_MODE_AGENTS, storage);
  assert.equal(storage.map.get("grq:workMode"), "agents");
  assert.equal(readWorkMode(storage), WORK_MODE_AGENTS);
  writeWorkMode(WORK_MODE_WRITE, storage);
  assert.equal(storage.map.get("grq:workMode"), "write");
  assert.equal(readWorkMode(storage), WORK_MODE_WRITE);
  storage.setItem(WORK_MODE_KEY, "junk");
  assert.equal(readWorkMode(storage), WORK_MODE_WRITE, "junk reads Write code");
});

test("blocked or throwing storage never breaks the toggle", () => {
  assert.equal(readWorkMode(throwing), WORK_MODE_WRITE);
  assert.doesNotThrow(() => writeWorkMode(WORK_MODE_AGENTS, throwing));
  assert.equal(readWorkMode(null), WORK_MODE_WRITE);
  assert.doesNotThrow(() => writeWorkMode(WORK_MODE_AGENTS, null));
  assert.doesNotThrow(() => claimWorkModeAnnouncement(throwing));
  const util = src("utils/workMode.js");
  assert.match(util, /try \{\s*const value = storage \? storage\.getItem\(WORK_MODE_KEY\)/);
  assert.match(util, /try \{\s*storage\?\.setItem\(\s*WORK_MODE_KEY/);
});

test("the mode is never in the save", () => {
  for (const file of [
    "save/serialize.js",
    "save/saveSync.js",
    "context/GameContext.jsx",
    "context/gameLogic.js",
  ]) {
    assert.ok(!src(file).includes("grq:workMode"), file);
    assert.ok(!src(file).includes("readWorkMode"), file);
  }
  // The Footer holds the mode in local state, read from the device.
  assert.match(footer(), /useState\(\(\) => readWorkMode\(\)\)/);
  assert.match(footer(), /writeWorkMode\(next\)/);
});

// --- The two modes ---

test("Write code mode renders the unchanged Commit button, and the float lock holds", () => {
  const render = footerRender();
  // Mobile: the Review panel or the old Clicks/sec line plus Commit.
  assert.match(
    render,
    /\{agents \? \(\s*<ReviewPanel className="mx-auto w-\[85%\]" \/>\s*\) : \(\s*<>\s*<CPSMeter \/>\s*<ClickButton \/>\s*<\/>\s*\)\}/
  );
  // Desktop (slices 2 and 3): the PR card takes Clicks/sec's place and
  // its buttons take the Commit button's, in the same column.
  assert.match(render, /\{agents \? <ReviewPanel part="actions" className="w-full" \/> : <ClickButton \/>\}/);
  assert.match(render, /\{agents \? \(\s*<ReviewPanel part="queue"[^>]*\/>\s*\) : \(\s*<CPSMeter \/>\s*\)\}/);
  // Once unlocked the group is pinned right, so the toggle never moves.
  assert.match(render, /unlocked\s*\? "inline-flex min-w-0 flex-1 items-center justify-end gap-6"\s*: "inline-flex flex-1 items-center justify-center gap-8"/);
  // Exactly one Commit button per layout, as before.
  assert.equal((render.match(/<ClickButton \/>/g) ?? []).length, 2);
  // ClickButton, KeyPressButton, BouncyButton and the float: no diff.
  assertCommitFloatLocked();
});

test("Manage agents mode renders the Review panel and no Commit button", () => {
  const render = footerRender();
  assert.match(render, /const agents = mode === WORK_MODE_AGENTS;/);
  // Every ClickButton sits in the non-agents branch of a ternary.
  for (const m of render.matchAll(/<ClickButton \/>/g)) {
    const before = render.slice(Math.max(0, m.index - 200), m.index);
    assert.match(before, /agents \?[\s\S]*:/, "Commit only in Write code mode");
  }
  // The panel: the queue header and the JSDoc empty state.
  assert.equal(reviewQueueHeader(0), "Review queue (0 open)");
  assert.equal(reviewQueueHeader(), "Review queue (0 open)");
  assert.equal(reviewQueueHeader(-3), "Review queue (0 open)");
  const s = panel();
  // Slices 2 and 3 (agent-fleet-review.test.js) fill the panel; its
  // empty state with no agents is still the slice 1 JSDoc block.
  assert.match(s, /\{model\.header\}/);
  assert.match(s, /No agents are on payroll yet\./);
  assert.match(s, /@returns/);
  assert.match(s, /\{PullRequest\[\]\}/);
  assert.match(s, /aria-label="Review queue"/);
  // There is no keyboard shortcut for commit to suppress.
  for (const file of ["components/Footer.jsx", "components/KeyPressButton.jsx", "components/ClickButton.jsx"]) {
    assert.ok(!/addEventListener\(\s*["']key/.test(src(file)), file);
  }
});

// --- The unlock mail ---

test("the unlock mail is sent once, only from Series A", () => {
  const T = 1_700_000_000_000;
  // Below Series A: nothing.
  const seed = addAgentFleetToggleEmail([], ranksAt(1), T);
  assert.equal(seed.added, null);
  assert.deepEqual(seed.emails, []);
  // At Series A: one mail with the fixed trigger key.
  const first = addAgentFleetToggleEmail([], ranksAt(2), T);
  assert.ok(first.added);
  assert.equal(first.emails.length, 1);
  assert.equal(first.added.triggerKey, AGENT_FLEET_TOGGLE_EMAIL_TRIGGER_KEY);
  assert.equal(AGENT_FLEET_TOGGLE_EMAIL_TRIGGER_KEY, "agent-fleet-unlocked:toggle");
  const mail = buildAgentFleetToggleEmail();
  assert.equal(first.added.subject, mail.subject);
  assert.equal(first.added.body, mail.body);
  assert.match(mail.body, /Write code or Manage agents/);
  assert.match(mail.body, /purity test/);
  assert.equal(first.added.read, false);
  // Within the server's inbox caps, so the save carrying it is accepted.
  assert.ok(AGENT_FLEET_TOGGLE_EMAIL_TRIGGER_KEY.length <= EMAIL_CONFIG.maxTriggerKeyLength);
  assert.ok(mail.sender.length <= EMAIL_CONFIG.maxSenderLength);
  assert.ok(mail.subject.length <= EMAIL_CONFIG.maxSubjectLength);
  assert.ok(mail.body.length <= EMAIL_CONFIG.maxBodyLength);
  assert.ok(!("target" in first.added), "no link: the toggle is not on a tab");
  // Again: deduped by the trigger key.
  const second = addAgentFleetToggleEmail(first.emails, ranksAt(3), T + 1);
  assert.equal(second.added, null);
  assert.equal(second.emails, first.emails);
  // Same key through addEmail directly: still one.
  assert.equal(addEmail(first.emails, mail, AGENT_FLEET_TOGGLE_EMAIL_TRIGGER_KEY, T).added, null);
});

test("the device asks for the announcement once, before dispatching", () => {
  assert.equal(WORK_MODE_ANNOUNCED_KEY, "grq:workModeAnnounced");
  const storage = memoryStorage();
  assert.equal(claimWorkModeAnnouncement(storage), true, "first time");
  assert.equal(storage.map.get(WORK_MODE_ANNOUNCED_KEY), "1");
  assert.equal(claimWorkModeAnnouncement(storage), false, "after");
  assert.equal(claimWorkModeAnnouncement(storage), false);
  // The Footer claims only when unlocked, and the reducer re-checks the rank.
  assert.match(
    footer(),
    /if \(!unlocked \|\| !claimWorkModeAnnouncement\(\)\) return;\s*dispatch\(\{ type: "ANNOUNCE_AGENT_FLEET_TOGGLE" \}\);/
  );
  const ctx = src("context/GameContext.jsx");
  assert.match(
    ctx,
    /case "ANNOUNCE_AGENT_FLEET_TOGGLE": \{\s*const \{ emails, added \} = addAgentFleetToggleEmail\(\s*state\.emails,\s*state\.permanentStoreRanks,/
  );
});
