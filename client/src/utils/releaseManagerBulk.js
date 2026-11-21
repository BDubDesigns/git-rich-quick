/**
 * Release Manager bulk buttons (issue #225), as pure functions so the
 * server test suite pins what each tap dispatches. Each button is one
 * absolute count through the existing rm.onChange path
 * (SET_RELEASE_MANAGER_ASSIGNMENT), so one tap is one dispatch and one
 * save trigger. The reducer still enforces the rules (never below 0,
 * never more assigned in total than owned). There is deliberately no
 * per-project cap: extra managers on one project simply idle.
 *
 * Copy rules: no em dashes or en dashes in player-facing text.
 */

/** A count read safely: a whole number, never below 0. */
function count(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** All (N): this project's new assignment, every free manager moved onto it. */
export function assignAllCount(assigned, unassigned) {
  return count(assigned) + count(unassigned);
}

/** All (N) is usable only while a manager is free. */
export function canAssignAll(unassigned) {
  return count(unassigned) > 0;
}

/** Clear: this project's new assignment. */
export const CLEAR_COUNT = 0;

/** Clear is usable only while a manager is assigned here. */
export function canClear(assigned) {
  return count(assigned) > 0;
}

/** The All button's label: "All (N)", N the free managers. */
export function assignAllLabel(unassigned) {
  return `All (${count(unassigned)})`;
}

/** The buttons' full accessible names. */
export function assignAllAriaLabel(unassigned, projectName) {
  return `Assign all ${count(unassigned)} free managers to ${projectName}`;
}

export function clearAriaLabel(projectName) {
  return `Unassign all managers from ${projectName}`;
}
