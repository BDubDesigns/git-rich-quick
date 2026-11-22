/**
 * Agent Fleet, slice 1 (issue #267): the Write code / Manage agents
 * toggle in the Commit button's spot.
 *
 * Brandon: "people either write code and avoid AI as some purity test
 * or they manage agents nowadays, so it makes sense to swap the commit
 * button out for the panel."
 *
 * - The toggle exists once Funding Rounds is at Series A (rank 2,
 *   owned; a rented Bridge Round does not count). Before that the
 *   Commit area is exactly as it was.
 * - The chosen mode is a device preference, like the sort modes and
 *   the Night Shift card's collapse: localStorage under `grq:workMode`,
 *   never the save. "Write code" is the default, and junk, missing or
 *   blocked storage reads "Write code".
 * - The unlock mail is announced once per device (`grq:workModeAnnounced`)
 *   and deduped against the inbox by its trigger key, so a deleted or
 *   aged-out mail is not sent again on every tick. Store ranks only
 *   change through a server restore (which never mails), so the mail
 *   cannot ride on a reducer transition like the farm's.
 *
 * Framework-free (no React) so the server tests can exercise it with a
 * fake storage. Copy rules: no em or en dashes.
 */
import { fundingRoundRank } from "../../../shared/game-balance.js";

/** localStorage key for the chosen mode. */
export const WORK_MODE_KEY = "grq:workMode";

/** localStorage key for "the unlock mail was announced on this device". */
export const WORK_MODE_ANNOUNCED_KEY = "grq:workModeAnnounced";

/** The Funding Rounds rank that unlocks the toggle (Series A). */
export const WORK_MODE_UNLOCK_RANK = 2;

export const WORK_MODE_WRITE = "write";
export const WORK_MODE_AGENTS = "agents";

/** The two segments, in display order. */
export const WORK_MODES = Object.freeze([
  Object.freeze({ id: WORK_MODE_WRITE, label: "Write code" }),
  Object.freeze({ id: WORK_MODE_AGENTS, label: "Manage agents" }),
]);

/** Whether the toggle shows: Series A or later is owned. */
export function workModeUnlocked(storeRanks) {
  return fundingRoundRank(storeRanks ?? {}) >= WORK_MODE_UNLOCK_RANK;
}

/**
 * The mode the Commit area shows. Below Series A it is always "write"
 * (the toggle does not exist yet), whatever this device remembers.
 */
export function effectiveWorkMode(storedMode, unlocked) {
  return unlocked && storedMode === WORK_MODE_AGENTS
    ? WORK_MODE_AGENTS
    : WORK_MODE_WRITE;
}

function defaultStorage() {
  try {
    if (
      typeof globalThis.localStorage !== "undefined" &&
      globalThis.localStorage &&
      typeof globalThis.localStorage.getItem === "function"
    ) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage blocked (private mode): fall through to no storage.
  }
  return null;
}

/** The mode remembered on this device. Missing, junk or blocked
 *  storage reads "write". */
export function readWorkMode(storage = defaultStorage()) {
  try {
    const value = storage ? storage.getItem(WORK_MODE_KEY) : null;
    return value === WORK_MODE_AGENTS ? WORK_MODE_AGENTS : WORK_MODE_WRITE;
  } catch {
    return WORK_MODE_WRITE;
  }
}

/** Remember the mode. A throwing storage is ignored: the toggle still
 *  works for the session, it just does not persist. */
export function writeWorkMode(mode, storage = defaultStorage()) {
  try {
    storage?.setItem(
      WORK_MODE_KEY,
      mode === WORK_MODE_AGENTS ? WORK_MODE_AGENTS : WORK_MODE_WRITE
    );
  } catch {
    // Quota or private mode: keep the in-memory state only.
  }
}

/** Whether this device already announced the toggle. Blocked storage
 *  reads false (the inbox dedup still stops a second mail). */
export function readWorkModeAnnounced(storage = defaultStorage()) {
  try {
    return storage ? storage.getItem(WORK_MODE_ANNOUNCED_KEY) === "1" : false;
  } catch {
    return false;
  }
}

/** Remember that the toggle was announced on this device. */
export function writeWorkModeAnnounced(storage = defaultStorage()) {
  try {
    storage?.setItem(WORK_MODE_ANNOUNCED_KEY, "1");
  } catch {
    // Quota or private mode: the inbox dedup still applies.
  }
}

/**
 * Claim this device's one announcement: true the first time (and the
 * flag is written before the caller dispatches, so a double-run effect
 * cannot send twice), false after. Blocked storage claims every time;
 * the inbox's trigger key dedup still stops a second mail.
 */
export function claimWorkModeAnnouncement(storage = defaultStorage()) {
  if (readWorkModeAnnounced(storage)) return false;
  writeWorkModeAnnounced(storage);
  return true;
}

/** The review queue header. Slice 1 has no agents, so it reads 0. */
export function reviewQueueHeader(openCount = 0) {
  const n = Math.max(0, Math.floor(Number(openCount) || 0));
  return `Review queue (${n} open)`;
}
