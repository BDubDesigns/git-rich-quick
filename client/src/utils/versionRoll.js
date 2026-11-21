/**
 * Version bump (issue #216, Slice 4 of the #210 game-feel pass): which
 * Open Source card rolls its version, as pure functions so the server
 * test suite pins them. Presentation only.
 *
 * The trigger is a successful CONTRIBUTE_TO_PROJECT: the reducer
 * records it as state.lastContribution ({ projectId, from, to, seq,
 * atMs }, transient, never saved, cleared by a restore). The card for
 * that project rolls once per seq. A card that mounts while the
 * contribution is still fresh plays it too: buying the last level moves
 * the card into Maxed Out (a remount), and its roll ends there, on the
 * MAXED OUT line.
 */

/** The roll and the top-border sweep, ms (VersionRoll.css). */
export const VERSION_ROLL_MS = 320;

/** A contribution this recent still rolls a card that just mounted. */
export const VERSION_ROLL_FRESH_MS = 1000;

/** The version text the card shows ("v.6.0"). */
export function versionText(level) {
  const n = Number.isInteger(level) && level > 0 ? level : 0;
  return `v.${n}.0`;
}

/** The next state.lastContribution after a successful contribution. */
export function nextContribution(prev, projectId, from, to, nowMs) {
  return { projectId, from, to, seq: (prev?.seq ?? 0) + 1, atMs: nowMs };
}

/** Whether a contribution rolls this card when it mounts: this project's, and fresh. */
export function versionRollFreshOnMount(contribution, projectId, nowMs) {
  return (
    Boolean(contribution) &&
    contribution.projectId === projectId &&
    nowMs - contribution.atMs <= VERSION_ROLL_FRESH_MS
  );
}

/** The roll a card shows after a new contribution: its own, else the current one. */
export function versionRollAfter(current, contribution, projectId) {
  return contribution?.projectId === projectId ? contribution : current;
}
