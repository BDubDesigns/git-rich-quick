/**
 * Agent Fleet, slices 2 and 3 (issue #267): hireable Coding Agents, the
 * token bill, PR generation and the review queue, approve/reject, slop,
 * tech debt, manual commits paying debt down, and the Refactor Sprint.
 *
 * Brandon, Nov 21: agents unlock at Series A; slop is NEVER decided by
 * the title (every PR shows its diff plus CI, tests and deps checks,
 * and slop always has at least one red flag there, a good PR none);
 * rejecting slop pays a small good catch bonus; debt clears through
 * manual commits and a cash Refactor Sprint ("Fixed twelve bugs,
 * introduced three."); agents reset on a sale like employees.
 *
 * The client components import React, so the component checks are
 * source checks, like the rest of the suite. The game math is the
 * shared AGENT_FLEET_CONFIG helpers, tested directly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { validateSave, validateSeedState } from "../src/validate.js";
import {
  AGENT_FLEET_CONFIG,
  AGENT_FLEET_DEBT_EMAIL_TRIGGER_KEY,
  AGENT_FLEET_FIRST_AGENT_EMAIL_TRIGGER_KEY,
  AGENT_FLEET_KEYS,
  AGENT_PR_FLAG_TYPES,
  AGENT_PR_KINDS,
  AGENT_PR_TITLES,
  AGENT_SPECIAL_PRS,
  CODING_AGENT_CARD_ID,
  EMAIL_CONFIG,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  INTERMISSION_FROZEN_FIELDS,
  OPEN_SOURCE_IDS,
  REFACTOR_SPRINT_MESSAGE,
  advanceAgentFleet,
  agentFleetMailsDue,
  agentFleetOf,
  agentFleetStateError,
  agentFleetStatus,
  agentFleetUnlocked,
  agentGoodCatchLoc,
  agentHireBulkPriceCents,
  agentHirePriceCents,
  agentPrCardLines,
  agentPrPayoutLoc,
  agentPrRedFlags,
  agentPullRequest,
  agentSpecialPrIndex,
  agentTokenBillCents,
  applyAgentHire,
  applyManualCommitDebt,
  applyPrestigeSale,
  applyRefactorSprint,
  buffedLocPerSecond,
  buildFirstAgentEmail,
  buildTechDebtEmail,
  cashBasisCentsPerSecond,
  initialSaveState,
  normalizeSaveState,
  refactorSprintBlocker,
  refactorSprintDebtAfter,
  refactorSprintPriceCents,
  reviewAgentPr,
  techDebtDragPercent,
  techDebtProductionMultiplier,
  zeroAgentFleetState,
  zeroStoreRanks,
} from "../../shared/game-balance.js";
import {
  bigActionFields,
  bigActionIncreased,
  isInitialSaveState,
  savePayloadError,
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";
import { addAgentFleetEmails } from "../../client/src/email/email.js";
import {
  codingAgentCardModel,
  reviewPanelModel,
  writeModeDebtLine,
} from "../../client/src/utils/agentFleetPanel.js";
import { sortEmployeeTypes } from "../../client/src/utils/unlockProgress.js";
import { WORK_MODE_UNLOCK_RANK } from "../../client/src/utils/workMode.js";
import { withClientBuild } from "./helpers/client-build.js";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const T0 = 1_700_000_000_000;
const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const DASHES = /[–—]/;
const P = 1_000_000; // a round P for the math tests
const S = cashBasisCentsPerSecond(P);
const ranksAt = (fundingRounds) => ({ ...zeroStoreRanks(), fundingRounds });
const fleetWith = (overrides = {}) => ({ ...zeroAgentFleetState(), seed: 4242, ...overrides });

/** The first PR numbers of a seed whose GENERATED (not special) PR matches `pred`. */
function findPrs(seed, pred, count = 1) {
  const found = [];
  for (let n = 1; found.length < count && n < 100_000; n += 1) {
    const pr = agentPullRequest(seed, n);
    if (pr.special === null && pred(pr)) found.push(n);
  }
  return found;
}

/** The first PR number of a seed that is special PR `index`. */
function findSpecial(seed, index) {
  for (let n = 1; n < 100_000; n += 1) {
    if (agentSpecialPrIndex(seed, n) === index) return n;
  }
  return null;
}

// --- The table ---

test("the tuning table holds Brandon's starting numbers, and the toggle shares the unlock rank", () => {
  assert.deepEqual(
    { ...AGENT_FLEET_CONFIG },
    {
      unlockRank: 2,
      hireSeconds: 120,
      hireCostMultiplier: 1.25,
      maxAgents: 1000,
      prIntervalSeconds: 60,
      queueCap: 20,
      prPayoutSeconds: 20,
      slopChance: 0.35,
      slopDebt: 5,
      goodPrDebt: 1,
      specialPrChance: 1 / 6,
      maxDebt: 100,
      dragPerDebt: 0.005,
      commitPaydown: 0.2,
      goodCatchSeconds: 3,
      sprintSeconds: 60,
      sprintKeep: 0.2,
      sprintResidue: 2,
      tokenBillShare: 0.04,
      debtMailThreshold: 50,
    }
  );
  assert.equal(WORK_MODE_UNLOCK_RANK, AGENT_FLEET_CONFIG.unlockRank);
  assert.equal(agentFleetUnlocked(ranksAt(1)), false, "Seed");
  assert.equal(agentFleetUnlocked(ranksAt(2)), true, "Series A");
  assert.equal(agentFleetUnlocked(undefined), false);
});

// --- Prices and the bill ---

test("hire price: 120 seconds of S for the first, x1.25 per agent owned; bulk is the sum", () => {
  assert.equal(agentHirePriceCents(0, P), Math.round(120 * S));
  assert.equal(agentHirePriceCents(1, P), Math.round(120 * 1.25 * S));
  assert.equal(agentHirePriceCents(6, P), Math.round(120 * 1.25 ** 6 * S));
  assert.equal(
    agentHireBulkPriceCents(3, 4, P),
    [3, 4, 5, 6].reduce((sum, n) => sum + agentHirePriceCents(n, P), 0)
  );
  assert.equal(agentHireBulkPriceCents(0, 1, P), agentHirePriceCents(0, P));
  // Prices float with P (seconds of S), never free.
  assert.ok(agentHirePriceCents(0, 2 * P) > agentHirePriceCents(0, P));
  assert.ok(agentHirePriceCents(0, 0) > 0);
});

test("hiring: Series A only, cash only, seeds the PR generator once, never past the cap", () => {
  const base = { fleet: zeroAgentFleetState(), money: 1e15, buffedLocPerSec: P, nowMs: T0 };
  assert.equal(applyAgentHire({ ...base, storeRanks: ranksAt(1) }), null, "locked below Series A");
  const hired = applyAgentHire({ ...base, storeRanks: ranksAt(2), quantity: 2 });
  assert.equal(hired.fleet.agents, 2);
  assert.equal(hired.money, 1e15 - agentHireBulkPriceCents(0, 2, P));
  assert.ok(hired.fleet.seed > 0, "seeded");
  const again = applyAgentHire({ ...base, fleet: hired.fleet, storeRanks: ranksAt(2), nowMs: T0 + 999 });
  assert.equal(again.fleet.seed, hired.fleet.seed, "the seed is kept");
  assert.equal(
    applyAgentHire({ ...base, money: agentHirePriceCents(0, P) - 1, storeRanks: ranksAt(2) }),
    null,
    "unaffordable"
  );
  assert.equal(
    applyAgentHire({ ...base, fleet: fleetWith({ agents: AGENT_FLEET_CONFIG.maxAgents }), storeRanks: ranksAt(5) }),
    null
  );
});

test("token bill: 4% of S per agent per second, deducted every tick while agents work", () => {
  assert.equal(agentTokenBillCents(1, P), Math.round(0.04 * S));
  assert.equal(agentTokenBillCents(6, P), Math.round(6 * 0.04 * S));
  assert.equal(agentTokenBillCents(0, P), 0);
  const money = 1e12;
  const r = advanceAgentFleet(fleetWith({ agents: 6 }), { money, buffedLocPerSec: P });
  assert.equal(r.billCents, agentTokenBillCents(6, P));
  assert.equal(r.money, money - agentTokenBillCents(6, P));
  assert.equal(r.status, "working");
});

test("the bill is about 12% of what one agent's approved PRs are worth in cash", () => {
  const { prPayoutSeconds, prIntervalSeconds, tokenBillShare } = AGENT_FLEET_CONFIG;
  // One agent: one PR per 60s, 20 seconds of P each, so P/3 LOC per second.
  const locPerSecond = (prPayoutSeconds / prIntervalSeconds) * P;
  // S prices LOC at the cash basis rate: S / P cents per LOC (21).
  const centsPerLoc = S / P;
  assert.equal(Math.round(centsPerLoc), 21);
  const prCashPerSecond = locPerSecond * centsPerLoc; // S / 3
  assert.ok(Math.abs(prCashPerSecond - S / 3) < 1e-6 * S);
  const share = agentTokenBillCents(1, P) / prCashPerSecond;
  assert.ok(Math.abs(share - 0.12) < 0.001, `${share}`);
  assert.ok(Math.abs(tokenBillShare / (prPayoutSeconds / prIntervalSeconds) - 0.12) < 1e-9);
  // Paused agents still bill nothing (backlog full).
  const full = fleetWith({ agents: 6, queue: Array.from({ length: 20 }, (_, i) => i + 1), nextPr: 21 });
  assert.equal(advanceAgentFleet(full, { money: 1e15, buffedLocPerSec: P }).billCents, 0);
});

test("too little cash for the bill pauses the agents: no bill, no PRs, never negative money", () => {
  const bill = agentTokenBillCents(6, P);
  const fleet = fleetWith({ agents: 6, progress: 58 });
  assert.equal(agentFleetStatus(fleet, bill - 1, P), "cash");
  const r = advanceAgentFleet(fleet, { money: bill - 1, buffedLocPerSec: P });
  assert.equal(r.status, "cash");
  assert.equal(r.money, bill - 1);
  assert.equal(r.billCents, 0);
  assert.equal(r.fleet, fleet, "nothing moved");
  // Exactly the bill is enough, and leaves 0.
  const paid = advanceAgentFleet(fleet, { money: bill, buffedLocPerSec: P });
  assert.equal(paid.money, 0);
  assert.equal(paid.fleet.queue.length, 1);
  assert.ok(reviewPanelModel({ agentFleet: fleet, money: 0 }, P).statusText.includes("token bill"));
});

// --- The queue ---

test("PR rate: each agent opens one PR per 60s of play", () => {
  let fleet = fleetWith({ agents: 1 });
  let money = 1e15;
  for (let s = 0; s < 59; s += 1) {
    ({ fleet, money } = advanceAgentFleet(fleet, { money, buffedLocPerSec: P }));
  }
  assert.equal(fleet.queue.length, 0);
  assert.equal(fleet.progress, 59);
  ({ fleet, money } = advanceAgentFleet(fleet, { money, buffedLocPerSec: P }));
  assert.deepEqual(fleet.queue, [1]);
  assert.equal(fleet.nextPr, 2);
  assert.equal(fleet.progress, 0);
  // Six agents: six PRs a minute.
  let six = fleetWith({ agents: 6 });
  for (let s = 0; s < 60; s += 1) {
    ({ fleet: six, money } = advanceAgentFleet(six, { money, buffedLocPerSec: P }));
  }
  assert.equal(six.queue.length, 6);
});

test("queue cap: agents pause on Review backlog full, bill nothing, and resume after a review", () => {
  const full = fleetWith({
    agents: 6,
    queue: Array.from({ length: 20 }, (_, i) => i + 1),
    nextPr: 21,
    progress: 30,
  });
  assert.equal(agentFleetStatus(full, 1e15, P), "backlog");
  const r = advanceAgentFleet(full, { money: 1e15, buffedLocPerSec: P });
  assert.equal(r.status, "backlog");
  assert.equal(r.billCents, 0);
  assert.equal(r.fleet, full);
  assert.equal(reviewPanelModel({ agentFleet: full, money: 1e15 }, P).statusText, "Review backlog full. Agents paused.");
  // Filling up mid-tick drops the leftover progress; never past the cap.
  const many = fleetWith({ agents: 600, queue: [1], nextPr: 2 });
  const filled = advanceAgentFleet(many, { money: 1e15, buffedLocPerSec: P });
  assert.equal(filled.fleet.queue.length, 11);
  const capped = advanceAgentFleet(filled.fleet, { money: 1e15, buffedLocPerSec: P });
  assert.equal(capped.fleet.queue.length, 20);
  assert.equal(capped.fleet.progress, 0);
  assert.equal(agentFleetStateError(capped.fleet), null);
  // A review frees a slot and the agents work again.
  const top = capped.fleet.queue[0];
  const reviewed = reviewAgentPr(capped.fleet, top, "approve", P);
  assert.equal(agentFleetStatus(reviewed.fleet, 1e15, P), "working");
});

test("no PRs accrue while the game is closed: only GAME_TICK advances the fleet", () => {
  const context = src("context/GameContext.jsx");
  assert.equal((context.match(/shared\.advanceAgentFleet\(/g) ?? []).length, 1);
  const tick = context.slice(context.indexOf('case "GAME_TICK"'), context.indexOf('case "CONTRIBUTE_TO_PROJECT"'));
  assert.match(tick, /shared\.advanceAgentFleet\(state\.agentFleet, \{\s*money: shipMoney,\s*buffedLocPerSec: getBaseLocPerSecond\(state\),\s*\}\)/);
  // Night Shift's offline settlement never touches the fleet.
  const nightShift = readFileSync(new URL("../../shared/game-balance.js", import.meta.url), "utf8");
  const settle = nightShift.slice(nightShift.indexOf("export function settleNightShift"), nightShift.indexOf("export function nightShiftStartLevel"));
  assert.ok(!settle.includes("agentFleet"));
});

// --- PR generation ---

test("PR titles: about 40 in one list, half topical and half evergreen, no dashes, every kind known", () => {
  assert.ok(AGENT_PR_TITLES.length >= 36 && AGENT_PR_TITLES.length <= 44, `${AGENT_PR_TITLES.length}`);
  const topical = AGENT_PR_TITLES.filter((t) => t.topical).length;
  assert.ok(Math.abs(topical - (AGENT_PR_TITLES.length - topical)) <= 2, "even halves");
  assert.equal(new Set(AGENT_PR_TITLES.map((t) => t.title)).size, AGENT_PR_TITLES.length, "no duplicates");
  for (const t of AGENT_PR_TITLES) {
    assert.ok(AGENT_PR_KINDS[t.kind], t.title);
    assert.ok(!DASHES.test(t.title), t.title);
  }
});

test("PR generation is deterministic from (seed, number), and generated slop runs near 35%", () => {
  assert.deepEqual(agentPullRequest(99, 7), agentPullRequest(99, 7));
  assert.notDeepEqual(agentPullRequest(99, 7), agentPullRequest(100, 7));
  let slop = 0;
  let generated = 0;
  for (let n = 1; n <= 24_000; n += 1) {
    const pr = agentPullRequest(31337, n);
    if (pr.special !== null) continue;
    generated += 1;
    if (pr.slop) slop += 1;
  }
  assert.ok(Math.abs(slop / generated - AGENT_FLEET_CONFIG.slopChance) < 0.02, `${slop / generated}`);
});

test("titles are independent of slop: every title shows up both as slop and as good", () => {
  const seen = AGENT_PR_TITLES.map(() => ({ slop: 0, good: 0 }));
  for (const seed of [1, 2, 3]) {
    for (let n = 1; n <= 6_000; n += 1) {
      const pr = agentPullRequest(seed, n);
      if (pr.special !== null) continue;
      seen[pr.titleIndex][pr.slop ? "slop" : "good"] += 1;
    }
  }
  for (const [i, s] of seen.entries()) {
    assert.ok(s.slop > 0 && s.good > 0, AGENT_PR_TITLES[i].title);
    // Each title's slop share stays near the base rate.
    const share = s.slop / (s.slop + s.good);
    assert.ok(Math.abs(share - AGENT_FLEET_CONFIG.slopChance) < 0.12, `${AGENT_PR_TITLES[i].title}: ${share}`);
  }
});

test("every slop PR has 1 or 2 red flags in its diff or checks; every good PR has none", () => {
  const flagCounts = Object.fromEntries(AGENT_PR_FLAG_TYPES.map((f) => [f, 0]));
  for (const seed of [7, 8]) {
    for (let n = 1; n <= 10_000; n += 1) {
      const pr = agentPullRequest(seed, n);
      const red = agentPrRedFlags(pr);
      if (pr.special !== null) {
        // Specials have their own rules (see the special PR tests).
        assert.equal(red.length > 0, pr.slop, pr.title);
        continue;
      }
      if (pr.slop) {
        assert.ok(red.length >= 1 && red.length <= 2, `slop #${n}: ${red}`);
        assert.deepEqual(red, pr.flags, "the generated flags are what a reviewer sees");
        assert.ok(pr.why && !DASHES.test(pr.why));
        for (const f of red) flagCounts[f] += 1;
      } else {
        assert.deepEqual(red, [], `good #${n}`);
        assert.equal(pr.ci, "passing");
        assert.notEqual(pr.tests.status, "deleted");
        assert.notEqual(pr.deps.status, "missing");
        const kind = AGENT_PR_KINDS[pr.kind];
        assert.ok(pr.added >= kind.added[0] && pr.added <= kind.added[1], "a sensible diff");
        assert.equal(pr.why, null);
      }
    }
  }
  for (const f of AGENT_PR_FLAG_TYPES) assert.ok(flagCounts[f] > 0, `flag ${f} occurs`);
});

test("the card lines: diff, CI, tests and deps text with red and green tones; the diff has no tone", () => {
  const [missing] = findPrs(5, (pr) => pr.deps.status === "missing");
  const pr = agentPullRequest(5, missing);
  const lines = agentPrCardLines(pr);
  assert.equal(lines.deps.text, `+ ${pr.deps.name} (not found on npm)`);
  assert.equal(lines.deps.tone, "bad");
  assert.match(lines.diff, /^\+[\d,]+ -[\d,]+$/);
  assert.equal(typeof lines.diff, "string", "the diff is plain text with no tone");
  const [deleted] = findPrs(5, (p) => p.tests.status === "deleted");
  assert.match(agentPrCardLines(agentPullRequest(5, deleted)).tests.text, /^[\d,]+ deleted$/);
  const [failing] = findPrs(5, (p) => p.ci === "failing");
  assert.deepEqual(agentPrCardLines(agentPullRequest(5, failing)).ci, { text: "failing", tone: "bad" });
  const [skipped] = findPrs(5, (p) => p.ci === "skipped");
  assert.deepEqual(agentPrCardLines(agentPullRequest(5, skipped)).ci, { text: "skipped", tone: "bad" });
  const [verified] = findPrs(5, (p) => p.deps.status === "verified");
  assert.deepEqual(agentPrCardLines(agentPullRequest(5, verified)).deps, { text: "+1 verified", tone: "good" });
  const [added] = findPrs(5, (p) => !p.slop && p.tests.status === "added");
  assert.match(agentPrCardLines(agentPullRequest(5, added)).tests.text, /^added \d+$/);
  const [clean] = findPrs(5, (p) => !p.slop && p.tests.status === "unchanged" && p.deps.status === "none");
  const cleanLines = agentPrCardLines(agentPullRequest(5, clean));
  assert.deepEqual(cleanLines.ci, { text: "passing", tone: "good" });
  assert.deepEqual(cleanLines.tests, { text: "unchanged", tone: "neutral" });
  assert.deepEqual(cleanLines.deps, { text: "none added", tone: "neutral" });
  // A scale flag: the diff dwarfs the kind's sensible range.
  const [scale] = findPrs(5, (p) => p.flags.length === 1 && p.flags[0] === "diff");
  const big = agentPullRequest(5, scale);
  assert.ok(big.added >= 20_000);
  assert.match(big.why, /does not add [\d,]+ lines\.$/);
});

// --- Review ---

test("approve and reject: payouts, debt, the good catch bonus, the HR complaint", () => {
  const seed = 4242;
  const [good] = findPrs(seed, (pr) => !pr.slop);
  const [slop] = findPrs(seed, (pr) => pr.slop);
  const fleet = (n) => fleetWith({ agents: 3, queue: [n], nextPr: n + 1, debt: 10 });
  assert.equal(agentPrPayoutLoc(P), 20 * P);
  assert.equal(agentGoodCatchLoc(P), 3 * P);

  const merged = reviewAgentPr(fleet(good), good, "approve", P);
  assert.equal(merged.outcome, "merged");
  assert.equal(merged.loc, 20 * P, "the payout is unchanged");
  assert.equal(merged.fleet.debt, 11, "a good PR adds +1 debt: somebody has to maintain it");
  assert.equal(merged.message, `Merged #${good}. +20M LOC. Somebody has to maintain it now.`);
  assert.deepEqual(merged.fleet.queue, []);

  const mergedSlop = reviewAgentPr(fleet(slop), slop, "approve", P);
  assert.equal(mergedSlop.outcome, "mergedSlop");
  assert.equal(mergedSlop.loc, 20 * P, "slop pays just as much");
  assert.equal(mergedSlop.fleet.debt, 15, "slop still adds +5");
  assert.ok(mergedSlop.message.includes(agentPullRequest(seed, slop).why));

  const caught = reviewAgentPr(fleet(slop), slop, "reject", P);
  assert.equal(caught.outcome, "goodCatch");
  assert.equal(caught.loc, 3 * P);
  assert.equal(caught.fleet.debt, 10);
  assert.match(caught.message, /^Good catch\. /);

  const wrong = reviewAgentPr(fleet(good), good, "reject", P);
  assert.equal(wrong.outcome, "wrongReject");
  assert.equal(wrong.loc, 0);
  assert.equal(wrong.message, "You rejected a perfectly good PR. The agent filed a complaint with HR.");

  // Only the top PR can be decided (a double tap never decides the next one).
  assert.equal(reviewAgentPr(fleetWith({ queue: [3, 4], nextPr: 5 }), 4, "approve", P), null);
  assert.equal(reviewAgentPr(fleet(good), good, "maybe", P), null);
  assert.equal(reviewAgentPr(zeroAgentFleetState(), 1, "approve", P), null);
  // Debt never passes 100.
  assert.equal(reviewAgentPr(fleetWith({ queue: [slop], nextPr: slop + 1, debt: 98 }), slop, "approve", P).fleet.debt, 100);
  assert.equal(reviewAgentPr(fleetWith({ queue: [good], nextPr: good + 1, debt: 99.5 }), good, "approve", P).fleet.debt, 100);
  // Rejecting never adds debt; the zero-debt start goes to exactly 1 on a good merge.
  assert.equal(reviewAgentPr(fleetWith({ queue: [good], nextPr: good + 1 }), good, "approve", P).fleet.debt, 1);
  // "It made the tests pass by deleting them." is one of the reasons.
  const [deleted] = findPrs(seed, (pr) => pr.flags[0] === "tests");
  assert.equal(agentPullRequest(seed, deleted).why, "It made the tests pass by deleting them.");
  for (const r of [merged, mergedSlop, caught, wrong]) assert.ok(!DASHES.test(r.message), r.message);
});

// --- Special PRs ---

test("special PRs: about 15 hand-written ones, half topical, no dashes, every kind known, custom messages", () => {
  assert.ok(AGENT_SPECIAL_PRS.length >= 13 && AGENT_SPECIAL_PRS.length <= 17, `${AGENT_SPECIAL_PRS.length}`);
  const titles = new Set([...AGENT_SPECIAL_PRS.map((s) => s.title), ...AGENT_PR_TITLES.map((t) => t.title)]);
  assert.equal(titles.size, AGENT_SPECIAL_PRS.length + AGENT_PR_TITLES.length, "no title is shared");
  const topical = AGENT_SPECIAL_PRS.filter((s) => s.topical).length;
  assert.ok(Math.abs(topical - (AGENT_SPECIAL_PRS.length - topical)) <= 2, "about half topical");
  const good = AGENT_SPECIAL_PRS.filter((s) => !s.slop).length;
  assert.ok(good >= 3 && good < AGENT_SPECIAL_PRS.length / 2, "a few good specials");
  for (const s of AGENT_SPECIAL_PRS) {
    assert.ok(AGENT_PR_KINDS[s.kind], s.title);
    for (const text of [s.title, s.approve, s.reject]) {
      assert.ok(typeof text === "string" && text.length > 0 && !DASHES.test(text), text);
    }
    assert.ok(s.approve.length <= 90 && s.reject.length <= 100, `short enough for two lines: ${s.title}`);
    assert.ok(["passing", "failing", "skipped"].includes(s.ci), s.title);
    assert.ok(["added", "unchanged", "deleted"].includes(s.tests.status), s.title);
    assert.ok(["none", "verified", "missing"].includes(s.deps.status), s.title);
  }
});

test("special PRs: slop specials have a red flag, good specials have none by the game's own rule", () => {
  for (const [index, s] of AGENT_SPECIAL_PRS.entries()) {
    const n = findSpecial(42, index);
    assert.ok(n, `special ${index} occurs`);
    const pr = agentPullRequest(42, n);
    assert.equal(pr.special, index);
    assert.equal(pr.titleIndex, null);
    assert.equal(pr.title, s.title);
    assert.equal(pr.slop, s.slop);
    const red = agentPrRedFlags(pr);
    assert.deepEqual(pr.flags, red);
    if (s.slop) {
      assert.ok(red.length >= 1, `slop special flagged: ${s.title}`);
      assert.equal(pr.why, s.reject);
    } else {
      assert.deepEqual(red, [], `good special unflagged: ${s.title}`);
      assert.equal(pr.why, null);
    }
  }
  // The scary but fine ones: a 40,000-line lockfile is in scale for a
  // lockfile, and a huge REMOVED count is never a red flag.
  const lockfile = AGENT_SPECIAL_PRS.findIndex((s) => s.kind === "lockfile");
  const lock = agentPullRequest(42, findSpecial(42, lockfile));
  assert.ok(lock.added >= 20_000 && !lock.slop);
  assert.deepEqual(agentPrRedFlags(lock), []);
  assert.ok(AGENT_SPECIAL_PRS.some((s) => !s.slop && s.removed >= 100_000), "a huge good deletion");
  // Every flag type is somebody's punchline.
  const seen = new Set(AGENT_SPECIAL_PRS.flatMap((s, i) => agentPullRequest(42, findSpecial(42, i)).flags));
  for (const f of AGENT_PR_FLAG_TYPES) assert.ok(seen.has(f), `a special uses ${f}`);
});

test("special PRs appear about 1 in 6, deterministically from (seed, number), and every one shows up", () => {
  for (const seed of [1, 31337, 0x7fffffff]) {
    const per = AGENT_SPECIAL_PRS.map(() => 0);
    let specials = 0;
    const N = 30_000;
    for (let n = 1; n <= N; n += 1) {
      const pr = agentPullRequest(seed, n);
      assert.equal(pr.special, agentSpecialPrIndex(seed, n));
      if (pr.special !== null) {
        specials += 1;
        per[pr.special] += 1;
      }
    }
    assert.ok(Math.abs(specials / N - 1 / 6) < 0.01, `seed ${seed}: ${specials / N}`);
    for (const [i, count] of per.entries()) assert.ok(count > 0, `${seed}: ${AGENT_SPECIAL_PRS[i].title}`);
  }
  const n = findSpecial(9, 0);
  assert.deepEqual(agentPullRequest(9, n), agentPullRequest(9, n), "deterministic");
  // The save is unchanged: PR numbers only, no new fleet keys.
  assert.deepEqual(Object.keys(zeroAgentFleetState()), [...AGENT_FLEET_KEYS]);
});

test("special PRs: their own approve and reject lines, and the same payouts and debt", () => {
  const seed = 42;
  const fleet = (n) => fleetWith({ seed, agents: 3, queue: [n], nextPr: n + 1, debt: 10 });
  for (const [index, s] of AGENT_SPECIAL_PRS.entries()) {
    const n = findSpecial(seed, index);
    const approved = reviewAgentPr(fleet(n), n, "approve", P);
    const rejected = reviewAgentPr(fleet(n), n, "reject", P);
    assert.equal(approved.loc, 20 * P);
    if (s.slop) {
      assert.equal(approved.outcome, "mergedSlop");
      assert.equal(approved.message, `${s.approve} Tech debt +5%.`);
      assert.equal(approved.fleet.debt, 15);
      assert.equal(rejected.outcome, "goodCatch");
      assert.equal(rejected.message, `Good catch. ${s.reject} +3M LOC.`);
      assert.equal(rejected.loc, 3 * P);
    } else {
      assert.equal(approved.outcome, "merged");
      assert.equal(approved.message, `${s.approve} +20M LOC.`);
      assert.equal(approved.fleet.debt, 11);
      assert.equal(rejected.outcome, "wrongReject");
      assert.equal(rejected.message, s.reject);
      assert.equal(rejected.loc, 0);
    }
    assert.equal(rejected.fleet.debt, 10);
    for (const r of [approved, rejected]) assert.ok(!DASHES.test(r.message), r.message);
  }
});

// --- Tech debt ---

test("debt drag: 0.5% of production per point, -50% at 100, in the live LOC/s but never in pricing P", () => {
  assert.equal(techDebtProductionMultiplier(0), 1);
  assert.equal(techDebtProductionMultiplier(30), 0.85);
  assert.equal(techDebtProductionMultiplier(100), 0.5);
  assert.equal(techDebtProductionMultiplier(250), 0.5);
  assert.equal(techDebtProductionMultiplier(-5), 1);
  assert.equal(techDebtDragPercent(30), 15);
  assert.equal(techDebtDragPercent(23.4), 11.7);
  // Applied once, in the one place the live rate combines.
  const logic = src("context/gameLogic.js");
  const live = logic.slice(logic.indexOf("export function calculateLOCPerSecond"), logic.indexOf("export function employeeReturnsLine"));
  assert.match(live, /total \*= shared\.techDebtProductionMultiplier\(state\.agentFleet\?\.debt \?\? 0\);\s*\/\/[\s\S]*return Math\.floor\(total \+ 1e-9\);/);
  assert.equal((logic.match(/techDebtProductionMultiplier/g) ?? []).length, 1);
  // Pricing P (getBaseLocPerSecond, the shared buffedLocPerSecond) has no debt in it.
  const base = logic.slice(logic.indexOf("export function getBaseLocPerSecond"), logic.indexOf("export function achievementContext"));
  assert.ok(!base.includes("agentFleet") && !base.includes("techDebt"));
  const state = initialSaveState();
  state.employees = { ...state.employees, intern: 100 };
  const healthy = buffedLocPerSecond(state);
  assert.equal(buffedLocPerSecond({ ...state, agentFleet: fleetWith({ debt: 100 }) }), healthy);
});

test("manual commit pays 0.2 debt per click, in the reducer; the Commit button is untouched", () => {
  assert.equal(applyManualCommitDebt(fleetWith({ debt: 23 })).debt, 22.8);
  let fleet = fleetWith({ debt: 1 });
  for (let i = 0; i < 5; i += 1) fleet = applyManualCommitDebt(fleet);
  assert.equal(fleet.debt, 0, "no float drift: five clicks clear 1 point exactly");
  const none = fleetWith({ debt: 0 });
  assert.equal(applyManualCommitDebt(none), none, "no debt: the same object");
  assert.equal(applyManualCommitDebt(fleetWith({ debt: 0.1 })).debt, 0, "never below 0");
  const context = src("context/GameContext.jsx");
  const write = context.slice(context.indexOf('case "WRITE_CODE"'), context.indexOf('case "BUY_EMPLOYEE"'));
  assert.match(write, /agentFleet: shared\.applyManualCommitDebt\(state\.agentFleet\),/);
  for (const file of ["components/ClickButton.jsx", "components/BouncyButton.jsx", "components/KeyPressButton.jsx"]) {
    assert.ok(!/agentFleet|techDebt/i.test(src(file)), file);
  }
  assertCommitFloatLocked();
});

test("Refactor Sprint: 60 seconds of S, debt to round(debt x 0.2) + 2, disabled with a reason", () => {
  assert.equal(refactorSprintPriceCents(P), Math.round(60 * S));
  assert.equal(refactorSprintDebtAfter(30), 8);
  assert.equal(refactorSprintDebtAfter(100), 22);
  assert.equal(refactorSprintDebtAfter(52.4), 12);
  assert.equal(refactorSprintDebtAfter(0), 2, "the formula; the sprint is refused at 0");
  const price = refactorSprintPriceCents(P);
  const run = applyRefactorSprint(fleetWith({ debt: 30 }), price + 5, P);
  assert.deepEqual(
    { debt: run.fleet.debt, money: run.money, priceCents: run.priceCents, before: run.before, after: run.after },
    { debt: 8, money: 5, priceCents: price, before: 30, after: 8 }
  );
  assert.equal(refactorSprintBlocker(fleetWith({ debt: 0 }), 1e15, P), "No tech debt to clear");
  assert.equal(refactorSprintBlocker(fleetWith({ debt: 3 }), 1e15, P), "Too little debt to refactor");
  assert.equal(refactorSprintBlocker(fleetWith({ debt: 4 }), 1e15, P), null, "4 goes to 3");
  assert.equal(refactorSprintBlocker(fleetWith({ debt: 30 }), price - 1, P), "Not enough cash");
  assert.equal(applyRefactorSprint(fleetWith({ debt: 30 }), price - 1, P), null);
  assert.equal(REFACTOR_SPRINT_MESSAGE, "Refactor Sprint done. Fixed twelve bugs, introduced three.");
  const model = reviewPanelModel({ agentFleet: fleetWith({ agents: 2, debt: 30 }), money: price - 1 }, P);
  assert.equal(model.sprint.disabled, true);
  assert.equal(model.sprint.reason, "Not enough cash");
  assert.match(model.sprint.label, /^Refactor Sprint \(\$/);
});

// --- Reset, old saves, shape ---

test("a sale resets agents, the queue and the debt like employees; the mail flags carry over", () => {
  const state = initialSaveState();
  state.totalLinesOfCode = 1e15;
  state.permanentStoreRanks = ranksAt(2);
  state.agentFleet = fleetWith({ agents: 6, queue: [3, 4], nextPr: 5, progress: 12, debt: 40, mails: 3 });
  const post = applyPrestigeSale(state, randomUUID());
  assert.deepEqual(post.agentFleet, zeroAgentFleetState(3));
  assert.equal(post.agentFleet.mails, 3);
  assert.ok(INTERMISSION_FROZEN_FIELDS.includes("agentFleet"));
});

test("old saves load with 0 agents, an empty queue and 0 debt, and still save", () => {
  const old = initialSaveState();
  delete old.agentFleet;
  assert.deepEqual(normalizeSaveState(old).agentFleet, zeroAgentFleetState());
  assert.deepEqual(saveStateToGameFields(old).agentFleet, zeroAgentFleetState());
  assert.equal(validateSeedState(old).ok, true);
  const roundTrip = stateToSaveState(saveStateToGameFields(old));
  assert.deepEqual(roundTrip.agentFleet, zeroAgentFleetState());
  assert.equal(savePayloadError(roundTrip), null);
  assert.equal(isInitialSaveState(roundTrip), true);
  // Junk in a client state is clamped, never written.
  assert.deepEqual(agentFleetOf({ agents: -3, queue: [5, 5, 2, "x"], nextPr: 6, progress: 99, debt: 400, seed: -1, mails: 9 }), {
    agents: 0,
    queue: [5],
    nextPr: 6,
    progress: 59,
    debt: 100,
    seed: 0,
    mails: 3,
  });
  assert.deepEqual(Object.keys(zeroAgentFleetState()), [...AGENT_FLEET_KEYS]);
  // Hiring is a big action; reviews and commits are not.
  const before = bigActionFields(roundTrip);
  const after = bigActionFields({ ...roundTrip, agentFleet: fleetWith({ agents: 1 }) });
  assert.equal(bigActionIncreased(before, after), true);
  const debtOnly = bigActionFields({ ...roundTrip, agentFleet: { ...zeroAgentFleetState(), debt: 4 } });
  assert.equal(bigActionIncreased(before, debtOnly), false);
});

test("the shape check rejects impossible fleets", () => {
  const ok = fleetWith({ agents: 6, queue: [1, 2, 3], nextPr: 4, progress: 30, debt: 30.4, mails: 1 });
  assert.equal(agentFleetStateError(ok), null);
  const bad = {
    "negative agents": { ...ok, agents: -1 },
    "fractional agents": { ...ok, agents: 1.5 },
    "too many agents": { ...ok, agents: AGENT_FLEET_CONFIG.maxAgents + 1 },
    "debt over 100": { ...ok, debt: 100.1 },
    "negative debt": { ...ok, debt: -0.2 },
    "NaN debt": { ...ok, debt: Number.NaN },
    "queue over cap": { ...ok, queue: Array.from({ length: 21 }, (_, i) => i + 1), nextPr: 22 },
    "queue not ascending": { ...ok, queue: [2, 1], nextPr: 4 },
    "queue duplicate": { ...ok, queue: [2, 2], nextPr: 4 },
    "queue entry at nextPr": { ...ok, queue: [4], nextPr: 4 },
    "queue entry not a number": { ...ok, queue: ["1"] },
    "progress at the interval": { ...ok, progress: 60 },
    "nextPr zero": { ...ok, nextPr: 0, queue: [] },
    "unknown key": { ...ok, yolo: true },
    "missing key": (({ seed: _seed, ...rest }) => rest)(ok),
    "mails junk": { ...ok, mails: 4 },
    "not an object": [],
  };
  for (const [name, fleet] of Object.entries(bad)) {
    assert.notEqual(agentFleetStateError(fleet), null, name);
    const state = { ...initialSaveState(), agentFleet: fleet };
    assert.equal(validateSeedState(state).ok, false, name);
  }
});

test("validateSave: a fleet only grows within a company (agents, PR numbers, mail flags)", () => {
  const prevState = { ...initialSaveState(), agentFleet: fleetWith({ agents: 6, nextPr: 30, queue: [29], mails: 1 }) };
  const prev = { state: prevState, savedAtMs: T0 };
  const body = (agentFleet) => ({
    playerId: randomUUID(),
    state: { ...prevState, agentFleet },
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(validateSave(prev, body({ ...prevState.agentFleet, queue: [], debt: 12 }), T0 + 2000).ok, true);
  const fired = validateSave(prev, body({ ...prevState.agentFleet, agents: 5 }), T0 + 2000);
  assert.equal(fired.rule, "MONOTONIC");
  const rewound = validateSave(prev, body({ ...prevState.agentFleet, nextPr: 10, queue: [] }), T0 + 2000);
  assert.equal(rewound.rule, "MONOTONIC");
  const unmailed = validateSave(prev, body({ ...prevState.agentFleet, mails: 0 }), T0 + 2000);
  assert.equal(unmailed.rule, "MONOTONIC");
  const negative = validateSave(prev, body({ ...prevState.agentFleet, agents: -1 }), T0 + 2000);
  assert.equal(negative.rule, "SHAPE");
});

// --- Mail ---

test("two agent mails, each once: the first agent, and debt past 50% for the first time", () => {
  for (const mail of [buildFirstAgentEmail(), buildTechDebtEmail()]) {
    for (const field of ["sender", "subject", "body"]) assert.ok(!DASHES.test(mail[field]), mail[field]);
    assert.ok(mail.body.length <= EMAIL_CONFIG.maxBodyLength);
    assert.ok(mail.subject.length <= EMAIL_CONFIG.maxSubjectLength);
  }
  assert.deepEqual(agentFleetMailsDue(zeroAgentFleetState()), []);
  let emails = [];
  let fleet = fleetWith({ agents: 1 });
  let result = addAgentFleetEmails(emails, fleet, T0);
  assert.equal(result.emails.length, 1);
  assert.equal(result.emails[0].triggerKey, AGENT_FLEET_FIRST_AGENT_EMAIL_TRIGGER_KEY);
  ({ emails, fleet } = result);
  // Again: nothing (flag set), even after the mail is deleted.
  assert.equal(addAgentFleetEmails([], fleet, T0).fleet, fleet);
  assert.equal(addAgentFleetEmails([], fleet, T0).emails.length, 0);
  // Debt at 50 exactly: not yet. Past it: once.
  assert.equal(addAgentFleetEmails(emails, { ...fleet, debt: 50 }, T0).added, null);
  result = addAgentFleetEmails(emails, { ...fleet, debt: 55 }, T0);
  assert.equal(result.added.triggerKey, AGENT_FLEET_DEBT_EMAIL_TRIGGER_KEY);
  assert.equal(result.fleet.mails, 3);
  assert.equal(addAgentFleetEmails(result.emails, { ...result.fleet, debt: 80 }, T0).added, null);
  // The flags survive a sale, so a second company never re-mails.
  const sold = applyPrestigeSale(
    { ...initialSaveState(), totalLinesOfCode: 1e15, agentFleet: result.fleet },
    randomUUID()
  );
  assert.deepEqual(agentFleetMailsDue({ ...sold.agentFleet, agents: 1, debt: 90 }), []);
  // The reducer files them through one helper after hires and reviews.
  const context = src("context/GameContext.jsx");
  assert.match(context, /function withAgentFleetMail\(state\)/);
  assert.equal((context.match(/withAgentFleetMail\(/g) ?? []).length, 3, "definition, HIRE_AGENT, REVIEW_AGENT_PR");
});

// --- UI ---

test("the Hire tab: a collapsible Coding Agent card from Series A, sorted like the others", () => {
  const state = (rank, agents = 0) => ({
    employees: Object.fromEntries(EMPLOYEE_TYPES.map((t) => [t, { count: 0 }])),
    openSourceProjects: {},
    permanentStoreRanks: ranksAt(rank),
    agentFleet: fleetWith({ agents }),
    activeStarEffects: [],
  });
  const order = [...EMPLOYEE_TYPES];
  assert.ok(!sortEmployeeTypes(order, state(1), "default").includes(CODING_AGENT_CARD_ID), "hidden before Series A");
  assert.deepEqual(sortEmployeeTypes(order, state(2), "default"), [...order, CODING_AGENT_CARD_ID]);
  // Cheapest: by the agent's own price, which climbs with agents owned.
  const cheap = sortEmployeeTypes(order, state(2, 0), "cheapest");
  const pricey = sortEmployeeTypes(order, state(2, 60), "cheapest");
  assert.ok(cheap.indexOf(CODING_AGENT_CARD_ID) <= pricey.indexOf(CODING_AGENT_CARD_ID));
  assert.equal(pricey[pricey.length - 1], CODING_AGENT_CARD_ID);
  const card = src("components/CodingAgentCard.jsx");
  assert.match(card, /useHireCardOpen\(CODING_AGENT_CARD_ID\)/);
  assert.match(card, /<CollapsedHireRow/);
  assert.match(card, /<ExpandedHireHeader/);
  assert.match(card, /tag="@returns"\s+type="PR"/);
  assert.match(card, /tag="@returns"\s+type="Bill"/);
  assert.match(card, /dispatch\(\{ type: "HIRE_AGENT", payload: \{ quantity \} \}\)/);
  const shop = src("components/Shop.jsx");
  assert.match(shop, /<HighlightAnchor key=\{CODING_AGENT_CARD_ID\} tab="shop" itemId=\{CODING_AGENT_CARD_ID\}>\s*<CodingAgentCard quantity=\{quantity\} \/>/);
  const model = codingAgentCardModel({ agentFleet: fleetWith({ agents: 6 }), money: 0 }, P, 1);
  assert.equal(model.priceCents, agentHirePriceCents(6, P));
  assert.equal(model.canAfford, false);
  assert.equal(model.prLine, "1 PR per 60s per agent, no LOC/s");
  assert.match(model.billLine, /\/s per agent in tokens$/);
  assert.match(model.billSuffix, /for the fleet\)$/);
  for (const text of Object.values(model)) if (typeof text === "string") assert.ok(!DASHES.test(text), text);
});

test("the Review panel: header, debt bar, the PR as a JSDoc card, 44px Reject and Approve, sprint, bill, result line", () => {
  const [slop] = findPrs(4242, (pr) => pr.slop);
  const fleet = fleetWith({ agents: 6, queue: [slop, slop + 1], nextPr: slop + 2, debt: 30 });
  const model = reviewPanelModel({ agentFleet: fleet, money: 1e15 }, P);
  assert.equal(model.header, "Review queue (2 open)");
  assert.equal(model.debtLabel, "Tech debt 30%");
  assert.equal(model.dragLabel, "-15% production");
  assert.equal(model.pr.number, slop);
  assert.equal(model.pr.payoutLabel, "+20M");
  assert.match(model.billLabel, /^Token bill \$[\d.]+[KMBT]?\/s$/);
  assert.equal(model.sprint.disabled, false);
  assert.equal(model.sprint.debtAfter, 8);
  const panel = src("components/ReviewPanel.jsx");
  assert.match(panel, /\{model\.header\}/);
  assert.match(panel, /<TechDebtBar model=\{model\} \/>/);
  assert.match(panel, /opened #\$\{pr\.number\}/);
  for (const tag of ["@returns", "@ci", "@tests", "@deps"]) assert.ok(panel.includes(tag), tag);
  assert.equal((panel.match(/className="h-11 /g) ?? []).length, 3, "Reject, Approve and the sprint are 44px");
  assert.match(panel, /payload: \{ prNumber: pr\.number, decision \}/);
  assert.match(panel, /dispatch\(\{ type: "REFACTOR_SPRINT" \}\)/);
  assert.match(panel, /disabled=\{model\.sprint\.disabled\}/);
  assert.match(panel, /aria-live="polite"/);
  // Height stays close to slice 1: the panel scrolls inside itself.
  assert.match(panel, /max-h-52 flex-col gap-1 overflow-y-auto/);
  // Write code mode: the compact debt line, only with debt.
  assert.equal(writeModeDebtLine(fleetWith({ debt: 0 })), null);
  assert.equal(writeModeDebtLine(fleetWith({ debt: 23 })), "Tech debt 23%: every commit pays it down");
  const footer = src("components/Footer.jsx");
  assert.equal((footer.match(/\{agents \? null : <WriteModeDebtLine/g) ?? []).length, 2);
  // No dashes in the panel, the card or the reducer's new copy.
  for (const file of ["components/ReviewPanel.jsx", "components/CodingAgentCard.jsx", "utils/agentFleetPanel.js"]) {
    assert.ok(!DASHES.test(src(file)), file);
  }
  // An empty queue with agents says when the next PR comes.
  const idle = reviewPanelModel({ agentFleet: fleetWith({ agents: 6, progress: 30 }), money: 1e15 }, P);
  assert.equal(idle.pr, null);
  assert.equal(idle.nextPrSeconds, 5);
});

test("the reducer wires each action to the shared helpers at the buffed P", () => {
  const context = src("context/GameContext.jsx");
  const between = (a, b) => context.slice(context.indexOf(a), context.indexOf(b));
  const hire = between('case "HIRE_AGENT"', 'case "REVIEW_AGENT_PR"');
  assert.match(hire, /shared\.applyAgentHire\(\{/);
  assert.match(hire, /buffedLocPerSec: getBaseLocPerSecond\(state\)/);
  const review = between('case "REVIEW_AGENT_PR"', 'case "REFACTOR_SPRINT"');
  assert.match(review, /shared\.reviewAgentPr\(/);
  assert.match(review, /linesOfCode: state\.linesOfCode \+ review\.loc,\s*totalLinesOfCode: state\.totalLinesOfCode \+ review\.loc,/);
  const sprint = between('case "REFACTOR_SPRINT"', 'case "ANNOUNCE_AGENT_FLEET_TOGGLE"');
  assert.match(sprint, /shared\.applyRefactorSprint\(/);
  assert.match(sprint, /shared\.REFACTOR_SPRINT_MESSAGE/);
});

// --- End to end: the save server accepts agent play ---

function zeroActions() {
  const counts = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
  return {
    clicks: 0,
    employeesBought: counts(EMPLOYEE_TYPES),
    projectsCompleted: counts(FREELANCE_PROJECT_KEYS),
    autoShips: counts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: counts(OPEN_SOURCE_IDS),
  };
}

async function startTestServer() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = createStore(pool);
  await store.ensureSchema();
  let nowMs = T0;
  const server = createServer(store, { clock: () => nowMs });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    pool,
    advance(ms) {
      nowMs += ms;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

async function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(withClientBuild(path, body)),
  });
}

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

async function setRawState(srv, playerId, state) {
  await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [
    JSON.stringify(state),
    playerId,
  ]);
}

async function loadState(base, playerId) {
  const res = await fetch(`${base}/api/load?playerId=${playerId}`);
  assert.equal(res.status, 200);
  return (await res.json()).state;
}

/** A Series A company with 200 seniors and cash, on the save shape. */
function seriesAState() {
  const state = initialSaveState();
  state.employees = { ...state.employees, senior: 200 };
  state.totalLinesOfCode = 1e13;
  state.linesOfCode = 1e9;
  state.lifetimeLocAtLastSale = 0;
  state.money = 1e15;
  state.lifetimeEquityEarned = 40;
  state.equitySpent = 25;
  state.saleCount = 2;
  state.lastSaleId = randomUUID();
  state.permanentStoreRanks = ranksAt(2);
  return state;
}

/** One second of agent play on a save-shaped state (the reducer's math). */
function tick(state) {
  const p = buffedLocPerSecond(state);
  const r = advanceAgentFleet(state.agentFleet, { money: state.money, buffedLocPerSec: p });
  return { ...state, money: r.money, agentFleet: r.fleet };
}

test("end to end: hiring, approving, catching slop, commits and sprints save without a 409", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  let state = seriesAState();
  await setRawState(srv, playerId, state);
  // An old save (no agentFleet) loads and saves.
  state = normalizeSaveState(await loadState(srv.base, playerId));
  const save = async () => {
    srv.advance(1500);
    const res = await post(srv.base, "/api/save", {
      playerId,
      state: stateToSaveState(saveStateToGameFields(state)),
      actionsSinceLastSave: zeroActions(),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
  };
  await save();
  const p = buffedLocPerSecond(state);
  const hired = applyAgentHire({
    fleet: state.agentFleet,
    money: state.money,
    quantity: 6,
    buffedLocPerSec: p,
    storeRanks: state.permanentStoreRanks,
    nowMs: T0,
  });
  state = { ...state, money: hired.money, agentFleet: hired.fleet };
  ({ fleet: state.agentFleet } = addAgentFleetEmails(state.emails, state.agentFleet, T0));
  await save();
  const outcomes = new Set();
  let catches = 0;
  let specials = 0;
  for (let minute = 0; minute < 12; minute += 1) {
    for (let s = 0; s < 60; s += 1) state = tick(state);
    // Review everything: approve slop now and then, catch the rest.
    while (state.agentFleet.queue.length > 0) {
      const top = agentPullRequest(state.agentFleet.seed, state.agentFleet.queue[0]);
      if (top.special !== null) specials += 1;
      const decision = top.slop && catches % 3 !== 0 ? "reject" : "approve";
      if (top.slop && decision === "reject") catches += 1;
      if (top.slop && decision === "approve") catches += 1;
      const r = reviewAgentPr(state.agentFleet, top.number, decision, p);
      outcomes.add(r.outcome);
      state = {
        ...state,
        agentFleet: r.fleet,
        linesOfCode: state.linesOfCode + r.loc,
        totalLinesOfCode: state.totalLinesOfCode + r.loc,
      };
    }
    // Some manual commits pay debt down.
    for (let c = 0; c < 10; c += 1) state = { ...state, agentFleet: applyManualCommitDebt(state.agentFleet) };
    if (minute % 4 === 3) {
      const sprint = applyRefactorSprint(state.agentFleet, state.money, p);
      if (sprint) {
        outcomes.add("sprint");
        state = { ...state, money: sprint.money, agentFleet: sprint.fleet };
      }
    }
    await save();
  }
  assert.ok(outcomes.has("merged") && outcomes.has("mergedSlop") && outcomes.has("goodCatch"), [...outcomes].join());
  assert.ok(outcomes.has("sprint"));
  assert.ok(specials > 0, "special PRs were reviewed and saved like any other");
  const stored = await loadState(srv.base, playerId);
  assert.equal(stored.agentFleet.agents, 6);
  assert.ok(stored.agentFleet.nextPr > 60, "about 72 PRs opened");
  assert.equal(agentFleetStateError(stored.agentFleet), null);

  // Impossible fleets are 400s (the shape check), a fired agent a 409.
  for (const fleet of [
    { ...stored.agentFleet, agents: -1 },
    { ...stored.agentFleet, debt: 140 },
    { ...stored.agentFleet, queue: Array.from({ length: 21 }, (_, i) => i + 1) },
  ]) {
    srv.advance(1500);
    const res = await post(srv.base, "/api/save", { playerId, state: { ...stored, agentFleet: fleet }, actionsSinceLastSave: zeroActions() });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).rule, "SHAPE");
  }
  srv.advance(1500);
  const fired = await post(srv.base, "/api/save", {
    playerId,
    state: { ...stored, agentFleet: { ...stored.agentFleet, agents: 5 } },
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(fired.status, 409);

  // A sale resets the fleet on the server; the mail flag survives.
  const sale = await post(srv.base, "/api/save/sell", {
    playerId,
    saleId: randomUUID(),
    state: stored,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(sale.status, 200);
  const after = (await sale.json()).state;
  assert.deepEqual(after.agentFleet, zeroAgentFleetState(stored.agentFleet.mails));
});
