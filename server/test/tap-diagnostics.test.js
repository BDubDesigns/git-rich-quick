/**
 * Tests for the tap-latency diagnostics instrument
 * (`TapDiagnostics`, `client/src/save/tapDiagnostics.js`).
 *
 * The instrument is what Settings copies out (Copy diagnostics): every
 * Commit tap is counted, and a tap whose frame lands more than 500ms
 * after the tap is recorded with the context that pins down the cause
 * (golden star on screen, save status, page visibility).
 *
 * The key verification is the full measureTap path with a fake frame
 * scheduler and a fake clock: a slow frame records an entry, a fast
 * frame does not, and a bad event timeStamp can never produce a bogus
 * latency.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  TapDiagnostics,
  SLOW_TAP_THRESHOLD_MS,
  TAP_LOG_MAX_ENTRIES,
  TAP_LOG_KEY,
  goldenStarOnScreen,
} from "../../client/src/save/tapDiagnostics.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * A controllable stand-in for requestAnimationFrame: callbacks only
 * run when the test runs them, so the frame time is exact.
 */
function manualRaf() {
  const pending = [];
  return {
    fn(cb) {
      pending.push(cb);
    },
    runAll() {
      const cbs = pending.splice(0);
      for (const cb of cbs) cb();
    },
    get pendingCount() {
      return pending.length;
    },
  };
}

function makeInstrument({ storage, raf, nowFn, isHiddenFn } = {}) {
  const store = storage ?? memoryStorage();
  const frames = raf ?? manualRaf();
  let nowMs = 1000;
  const clock = nowFn ?? (() => nowMs);
  const tap = new TapDiagnostics({
    storage: store,
    requestAnimationFrameFn: frames.fn,
    nowFn: clock,
    isHiddenFn,
  });
  return {
    tap,
    store,
    frames,
    setNow(ms) {
      nowMs = ms;
    },
  };
}

test("a slow tap is recorded through the full measureTap path", () => {
  const { tap, frames, setNow } = makeInstrument();
  // Tap at t=1000 with a star on screen and a save in progress.
  tap.measureTap(1000, { starOnScreen: true, saveStatus: "saving" });
  // The frame lands 1200ms later: over the 500ms threshold.
  setNow(2200);
  frames.runAll();

  const snap = tap.getSnapshot();
  assert.equal(snap.totalTaps, 1);
  assert.equal(snap.slowTaps, 1);
  assert.equal(snap.entries.length, 1);
  const entry = snap.entries[0];
  assert.equal(entry.latencyMs, 1200);
  assert.equal(entry.starOnScreen, true);
  assert.equal(entry.saveStatus, "saving");
  assert.equal(entry.visible, true);
  assert.equal(typeof entry.at, "string");
});

test("a fast tap is counted but not logged", () => {
  const { tap, frames, setNow } = makeInstrument();
  tap.measureTap(1000, { starOnScreen: false, saveStatus: "saved" });
  setNow(1150);
  frames.runAll();

  const snap = tap.getSnapshot();
  assert.equal(snap.totalTaps, 1);
  assert.equal(snap.slowTaps, 0);
  assert.deepEqual(snap.entries, []);
});

test("a tap at exactly the 500ms threshold is not slow", () => {
  const { tap, frames, setNow } = makeInstrument();
  tap.measureTap(1000, {});
  setNow(1000 + SLOW_TAP_THRESHOLD_MS);
  frames.runAll();

  const snap = tap.getSnapshot();
  assert.equal(snap.totalTaps, 1);
  assert.equal(snap.slowTaps, 0);
  assert.deepEqual(snap.entries, []);
});

test("an epoch-based event timeStamp falls back to the handler time", () => {
  const { tap, frames, setNow } = makeInstrument();
  // Old browsers stamped events with epoch time (far larger than the
  // performance clock). Without the fallback the latency would be a
  // bogus huge negative number; with it, the tap is measured from the
  // handler time and this fast frame records nothing.
  tap.measureTap(1_700_000_000_000, {});
  setNow(1100);
  frames.runAll();

  const snap = tap.getSnapshot();
  assert.equal(snap.totalTaps, 1);
  assert.equal(snap.slowTaps, 0);
  assert.deepEqual(snap.entries, []);
});

test("a tap while the page is hidden is not measured", () => {
  const { tap, frames } = makeInstrument();
  tap.measureTap(1000, { visible: false });

  // No frame was even scheduled: a hidden page has no frames.
  assert.equal(frames.pendingCount, 0);
  const snap = tap.getSnapshot();
  assert.equal(snap.totalTaps, 0);
  assert.equal(snap.slowTaps, 0);
});

test("a tab switch between tap and frame does not log a false slow tap", () => {
  let hidden = false;
  const { tap, frames, setNow } = makeInstrument({
    isHiddenFn: () => hidden,
  });
  tap.measureTap(1000, {});
  // The player switches tabs; the frame only fires when they return,
  // 10s later. That delay is the tab switch, not a blocked main
  // thread, so no entry is recorded.
  hidden = true;
  setNow(11_000);
  frames.runAll();

  const snap = tap.getSnapshot();
  assert.equal(snap.totalTaps, 1);
  assert.equal(snap.slowTaps, 0);
  assert.deepEqual(snap.entries, []);
});

test("an invalid latency never poisons the log", () => {
  const { tap } = makeInstrument();
  tap.recordTap({ latencyMs: Number.NaN });
  tap.recordTap({ latencyMs: Infinity });
  tap.recordTap({ latencyMs: -5 });
  tap.recordTap({});

  const snap = tap.getSnapshot();
  assert.equal(snap.slowTaps, 0);
  assert.deepEqual(snap.entries, []);
});

test("the log keeps only the last 20 entries but the counters keep counting", () => {
  const { tap } = makeInstrument();
  for (let i = 0; i < 25; i += 1) {
    tap.recordTap({ latencyMs: 600 + i, starOnScreen: false });
  }
  const snap = tap.getSnapshot();
  assert.equal(snap.entries.length, TAP_LOG_MAX_ENTRIES);
  assert.equal(snap.slowTaps, 25);
  // The oldest entries were dropped; the newest kept.
  assert.equal(snap.entries[0].latencyMs, 605);
  assert.equal(snap.entries[19].latencyMs, 624);
});

test("the log persists and round-trips through storage", () => {
  const store = memoryStorage();
  const first = makeInstrument({ storage: store });
  first.tap.measureTap(1000, { starOnScreen: true, saveStatus: "saved" });
  first.setNow(2000);
  first.frames.runAll();

  // A fresh instance on the same storage sees the same log.
  const second = makeInstrument({ storage: store });
  const snap = second.tap.getSnapshot();
  assert.equal(snap.totalTaps, 1);
  assert.equal(snap.slowTaps, 1);
  assert.equal(snap.entries.length, 1);
  assert.equal(snap.entries[0].latencyMs, 1000);

  // And the stored JSON is exactly the persisted key.
  const stored = JSON.parse(store.getItem(TAP_LOG_KEY));
  assert.equal(stored.totalTaps, 1);
  assert.equal(stored.slowTaps, 1);
  assert.equal(stored.entries.length, 1);
});

test("a malformed stored log loads as empty, never throws", () => {
  const store = memoryStorage();
  store.setItem(TAP_LOG_KEY, "{not json");
  const broken = makeInstrument({ storage: store });
  assert.deepEqual(broken.tap.getSnapshot(), {
    totalTaps: 0,
    slowTaps: 0,
    entries: [],
  });

  store.setItem(
    TAP_LOG_KEY,
    JSON.stringify({
      totalTaps: "lots",
      slowTaps: -3,
      entries: [{ at: "x", latencyMs: "fast" }, null, "junk"],
    })
  );
  const junk = makeInstrument({ storage: store });
  assert.deepEqual(junk.tap.getSnapshot(), {
    totalTaps: 0,
    slowTaps: 0,
    entries: [],
  });
});

test("goldenStarOnScreen is false with no document", () => {
  // Node has no document; the helper must not throw and must report
  // no star. (In the browser it reads the .golden-star element.)
  assert.equal(goldenStarOnScreen(), false);
});
