/**
 * Tests for issue #225: the Release Manager bulk buttons on the
 * freelance project cards. Brandon runs dozens of managers; stepping
 * 24 times per project was tedious.
 *
 * - All (N): sets the project's assignment to assigned + unassigned
 *   (every free manager onto it). Disabled at 0 free.
 * - Clear: sets it to 0. Disabled at 0 assigned.
 * Both are one absolute count through the existing rm.onChange path
 * (SET_RELEASE_MANAGER_ASSIGNMENT): one tap, one dispatch. No new
 * action, no shared helper, no server change, no per-project cap.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FREELANCE_PROJECT_KEYS,
  releaseManagerShippingEconomics,
} from "../../shared/game-balance.js";
import {
  CLEAR_COUNT,
  assignAllAriaLabel,
  assignAllCount,
  assignAllLabel,
  canAssignAll,
  canClear,
  clearAriaLabel,
} from "../../client/src/utils/releaseManagerBulk.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const card = src("components/ProjectCard.jsx");

/**
 * The reducer's SET_RELEASE_MANAGER_ASSIGNMENT rule (GameContext.jsx,
 * unchanged by this issue): an integer count of at least 0, and never
 * more assigned in total than owned. Returns the new assignments, or
 * null when the reducer refuses.
 */
function setAssignment(assignments, owned, projectKey, count) {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
  const total = Object.values(assignments).reduce((sum, n) => sum + (n ?? 0), 0);
  if (total - (assignments[projectKey] ?? 0) + count > owned) return null;
  return { ...assignments, [projectKey]: count };
}

test("All dispatches assigned + unassigned: every free manager onto this project", () => {
  assert.equal(assignAllCount(3, 21), 24, "Brandon's 24: 3 here, 21 free");
  assert.equal(assignAllCount(0, 24), 24);
  assert.equal(assignAllCount(5, 0), 5, "nothing free: the count stays");
  for (const [a, u] of [[Number.NaN, 4], [undefined, 4], [-2, 4], [2.7, 4]]) {
    assert.equal(assignAllCount(a, u), Math.max(0, Math.floor(Number(a)) || 0) + 4, `${a}`);
  }
  assert.equal(assignAllLabel(21), "All (21)");
  assert.equal(assignAllAriaLabel(21, "To Do List App"), "Assign all 21 free managers to To Do List App");
});

test("All is disabled at 0 free managers, enabled with any free", () => {
  assert.equal(canAssignAll(0), false);
  assert.equal(canAssignAll(undefined), false);
  assert.equal(canAssignAll(Number.NaN), false);
  assert.equal(canAssignAll(1), true);
  assert.equal(canAssignAll(24), true);
  assert.equal(assignAllLabel(0), "All (0)");
});

test("Clear dispatches 0 and is disabled at 0 assigned", () => {
  assert.equal(CLEAR_COUNT, 0);
  assert.equal(canClear(0), false);
  assert.equal(canClear(undefined), false);
  assert.equal(canClear(1), true);
  assert.equal(canClear(24), true);
  assert.equal(clearAriaLabel("Hobby Website"), "Unassign all managers from Hobby Website");
});

test("through the unchanged reducer rule: All lands exactly at the owned total, Clear frees them, nothing over-assigns", () => {
  const owned = 24;
  let assignments = { toDoListApp: 2, hobbyWebsite: 1 };
  const unassignedNow = () =>
    releaseManagerShippingEconomics({ assignments, managersOwned: owned }).unassigned;
  assert.equal(unassignedNow(), 21);
  // All on the To Do List App: 2 + 21 = 23, accepted; every manager is now assigned.
  const all = assignAllCount(assignments.toDoListApp, unassignedNow());
  assert.equal(all, 23);
  assignments = setAssignment(assignments, owned, "toDoListApp", all);
  assert.deepEqual(assignments, { toDoListApp: 23, hobbyWebsite: 1 });
  assert.equal(unassignedNow(), 0);
  assert.equal(canAssignAll(unassignedNow()), false, "now disabled everywhere");
  // One more than All would be refused: All is the most that fits.
  assert.equal(setAssignment(assignments, owned, "toDoListApp", all + 1), null);
  // Clear the Hobby Website: its 1 manager is free again.
  assignments = setAssignment(assignments, owned, "hobbyWebsite", CLEAR_COUNT);
  assert.deepEqual(assignments, { toDoListApp: 23, hobbyWebsite: 0 });
  assert.equal(unassignedNow(), 1);
  assert.equal(canClear(assignments.hobbyWebsite), false);
  // No per-project cap: all 24 on one project is allowed (extra managers idle).
  assignments = setAssignment(assignments, owned, "toDoListApp", assignAllCount(23, 1));
  assert.equal(assignments.toDoListApp, owned);
  assert.ok(FREELANCE_PROJECT_KEYS.includes("toDoListApp"));
});

test("wiring: both buttons call rm.onChange once with the absolute count, styled like the stepper", () => {
  // One onChange call per tap, the same absolute-count path as - and +.
  assert.match(card, /onClick=\{\(\) => rm\.onChange\(assignAllCount\(assigned, unassigned\)\)\}/);
  assert.match(card, /onClick=\{\(\) => rm\.onChange\(CLEAR_COUNT\)\}/);
  assert.match(card, /onClick=\{\(\) => rm\.onChange\(assigned - 1\)\}/);
  assert.match(card, /onClick=\{\(\) => rm\.onChange\(assigned \+ 1\)\}/);
  assert.equal((card.match(/rm\.onChange\(/g) ?? []).length, 4);
  // Disabled exactly as specced, with the stepper's inactive styling.
  assert.match(card, /const canAll = canAssignAll\(unassigned\);/);
  assert.match(card, /const canClearAll = canClear\(assigned\);/);
  assert.match(card, /disabled=\{!canAll\}\s*className=\{canAll \? "" : "game-button--inactive"\}\s*aria-label=\{assignAllAriaLabel\(unassigned, projectName\)\}/);
  assert.match(card, /disabled=\{!canClearAll\}\s*className=\{canClearAll \? "" : "game-button--inactive"\}\s*aria-label=\{clearAriaLabel\(projectName\)\}/);
  assert.match(card, /\{assignAllLabel\(unassigned\)\}/);
  assert.match(card, />\s*Clear\s*<\/Button>/);
  // The same Button component as the stepper.
  assert.equal((card.match(/<Button\s+onClick=\{\(\) => rm\.onChange/g) ?? []).length, 4);
  // No new action: the Projects tab still passes the one setter.
  assert.match(src("components/Projects.jsx"), /onChange: \(count\) => setAssignment\(projectKey, count\),/);
  assert.match(src("context/GameContext.jsx"), /case "SET_RELEASE_MANAGER_ASSIGNMENT": \{/);
});

test("the shared Button forwards aria-label, so the full labels reach the page", () => {
  // It used to drop it: the stepper's labels never rendered (found in
  // the browser check for this issue).
  const button = src("components/Button.jsx");
  assert.match(button, /"aria-label": ariaLabel,\s*\}\) \{/);
  assert.match(button, /aria-label=\{ariaLabel\}/);
});

test("no dashes in the new copy", () => {
  const util = src("utils/releaseManagerBulk.js");
  for (const text of [util, assignAllLabel(3), assignAllAriaLabel(3, "x"), clearAriaLabel("x"), "Clear"]) {
    assert.ok(!/[—–]/.test(text));
  }
});
