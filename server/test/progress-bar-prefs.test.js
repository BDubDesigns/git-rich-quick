/**
 * Tests for the progress bar toggles (issue #128): one Settings toggle
 * per progress bar, persisted across reloads in localStorage under the
 * `grq:` prefix (the same device-preference pattern as the sound
 * settings), defaulting to shown, with subscribers notified on change.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  PROGRESS_BARS,
  PROGRESS_BAR_IDS,
  isProgressBarEnabled,
  progressBarPrefsSnapshot,
  progressBarStorageKey,
  setProgressBarEnabled,
  subscribeProgressBarPrefs,
} from "../../client/src/utils/progressBarPrefs.js";

/** A Map-backed stand-in for localStorage. */
function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("there is a toggle for every progress bar the game draws", () => {
  for (const id of [
    "unlock",
    "equityStrip",
    "equityMeter",
    "starCountdown",
    "starEffects",
    "starBuy",
    "achievements",
  ]) {
    assert.ok(PROGRESS_BAR_IDS.includes(id), id);
  }
  assert.equal(new Set(PROGRESS_BAR_IDS).size, PROGRESS_BAR_IDS.length);
});

test("toggle copy has a label and a description and no em dashes", () => {
  for (const bar of PROGRESS_BARS) {
    assert.ok(bar.label.length > 0, bar.id);
    assert.ok(bar.description.length > 0, bar.id);
    assert.ok(!bar.label.includes("—"), bar.id);
    assert.ok(!bar.description.includes("—"), bar.id);
  }
});

test("every bar defaults to shown (no behavior change until the player chooses)", () => {
  const storage = fakeStorage();
  for (const id of PROGRESS_BAR_IDS) {
    assert.equal(isProgressBarEnabled(id, storage), true, id);
  }
  assert.deepEqual(
    Object.values(progressBarPrefsSnapshot(storage)).every(Boolean),
    true
  );
});

test("a toggle persists under a grq: key and survives a reload", () => {
  const storage = fakeStorage();
  setProgressBarEnabled("equityStrip", false, storage);
  assert.equal(storage.map.get(progressBarStorageKey("equityStrip")), "0");
  assert.equal(progressBarStorageKey("equityStrip"), "grq:progressBar:equityStrip");
  // A "reload": a fresh read from the same storage.
  assert.equal(isProgressBarEnabled("equityStrip", storage), false);
  // Other bars are untouched.
  assert.equal(isProgressBarEnabled("unlock", storage), true);
  setProgressBarEnabled("equityStrip", true, storage);
  assert.equal(storage.map.get(progressBarStorageKey("equityStrip")), "1");
  assert.equal(isProgressBarEnabled("equityStrip", storage), true);
});

test("an unknown bar id is ignored and reads as shown", () => {
  const storage = fakeStorage();
  setProgressBarEnabled("notABar", false, storage);
  assert.equal(storage.map.size, 0);
  assert.equal(isProgressBarEnabled("notABar", storage), true);
});

test("storage that throws (private mode) still works for the session", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  setProgressBarEnabled("starBuy", false, broken);
  assert.equal(isProgressBarEnabled("starBuy", broken), false);
  setProgressBarEnabled("starBuy", true, broken);
  assert.equal(isProgressBarEnabled("starBuy", broken), true);
});

test("subscribers hear every change, and unsubscribe stops them", () => {
  const storage = fakeStorage();
  let calls = 0;
  const unsubscribe = subscribeProgressBarPrefs(() => {
    calls += 1;
  });
  setProgressBarEnabled("starEffects", false, storage);
  setProgressBarEnabled("starEffects", true, storage);
  assert.equal(calls, 2);
  unsubscribe();
  setProgressBarEnabled("starEffects", false, storage);
  assert.equal(calls, 2);
});
