/**
 * Tap-latency diagnostics (PR #101): instruments Brandon's report that
 * taps sometimes don't register for 1+ seconds on his phone, so the
 * next time it happens the diagnostics dump shows what actually
 * happened instead of a guess.
 *
 * What it measures: on each Commit button tap, the click handler
 * records the event's timeStamp (when the browser created the tap
 * event) and schedules a requestAnimationFrame check. The frame after
 * the dispatch is when the new LOC is painted, so the tap-to-frame
 * time is the latency the player actually feels: it covers both a tap
 * event queued behind a blocked main thread and a render delayed
 * after the dispatch. A tap whose frame lands more than 500ms after
 * the tap is recorded as a slow tap, with the context that pins down
 * the cause (golden star on screen, save status, page visibility).
 *
 * This only records. It never changes what the game does, shows, or
 * sounds like. Fast taps are counted, never logged; only slow taps
 * get an entry (last 20, persisted in localStorage next to the save
 * attempt log, so a slow tap survives a reload and lands in the same
 * Copy diagnostics dump).
 *
 * Framework-free (plain JS, no React) so it can be tested in Node
 * with fake timers, the same way SaveSync is tested.
 */

/** A tap is "slow" when its frame lands more than this long after the tap. */
export const SLOW_TAP_THRESHOLD_MS = 500;
/** How many slow-tap entries the log keeps (newest 20). */
export const TAP_LOG_MAX_ENTRIES = 20;
/** localStorage key for the tap log (same `grq:` prefix as the save log). */
export const TAP_LOG_KEY = "grq:slowTaps";

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

function defaultStorage() {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.localStorage &&
    typeof globalThis.localStorage.getItem === "function"
  ) {
    return globalThis.localStorage;
  }
  return memoryStorage();
}

function defaultRaf() {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.requestAnimationFrame === "function"
  ) {
    return globalThis.requestAnimationFrame.bind(globalThis);
  }
  // No animation frames (Node, tests without a fake): a zero-delay
  // timer is the closest frame proxy.
  return (fn) => setTimeout(fn, 0);
}

function defaultNow() {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.performance &&
    typeof globalThis.performance.now === "function"
  ) {
    return () => globalThis.performance.now();
  }
  return () => Date.now();
}

function defaultIsHidden() {
  return (
    typeof document !== "undefined" && document.hidden === true
  );
}

// A persisted tap-log entry is valid only when every field has the
// right shape. A malformed stored value is dropped, never trusted.
function isValidTapEntry(e) {
  return (
    e &&
    typeof e === "object" &&
    typeof e.at === "string" &&
    typeof e.latencyMs === "number" &&
    Number.isFinite(e.latencyMs) &&
    e.latencyMs >= 0 &&
    typeof e.starOnScreen === "boolean" &&
    (e.saveStatus === null || typeof e.saveStatus === "string") &&
    typeof e.visible === "boolean"
  );
}

/**
 * Whether a golden star is on screen right now. The star's visibility
 * lives in GoldenStar's local state, not the reducer, so the tap
 * handler reads the DOM instead: a star element (natural or bought)
 * is only in the document while it is showing. Diagnostic read only.
 */
export function goldenStarOnScreen() {
  if (typeof document === "undefined") return false;
  try {
    return document.querySelector(".golden-star") !== null;
  } catch {
    return false;
  }
}

export class TapDiagnostics {
  /**
   * @param {object} [storage] - getItem/setItem/removeItem (defaults
   *   to localStorage, memory fallback when unavailable).
   * @param {(fn: Function) => any} [requestAnimationFrameFn] - frame
   *   scheduler (defaults to the global requestAnimationFrame).
   *   Injectable so tests can control when the frame lands.
   * @param {() => number} [nowFn] - clock in ms, same origin as the
   *   event timeStamp (defaults to performance.now). Injectable so
   *   tests can set the tap and frame times exactly.
   * @param {() => boolean} [isHiddenFn] - whether the page is hidden
   *   right now (defaults to document.hidden). Injectable so tests
   *   can simulate a tab switch between tap and frame.
   */
  constructor({
    storage,
    requestAnimationFrameFn,
    nowFn,
    isHiddenFn,
  } = {}) {
    this.storage = storage || defaultStorage();
    this._raf = requestAnimationFrameFn || defaultRaf();
    this._now = nowFn || defaultNow();
    this._isHidden = isHiddenFn || defaultIsHidden;
    const loaded = this._load();
    this._totalTaps = loaded.totalTaps;
    this._slowTaps = loaded.slowTaps;
    this._entries = loaded.entries;
  }

  // Load the persisted log. A missing, malformed, or unreadable value
  // just means an empty log.
  _load() {
    try {
      const raw = this.storage.getItem(TAP_LOG_KEY);
      if (!raw) return { totalTaps: 0, slowTaps: 0, entries: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { totalTaps: 0, slowTaps: 0, entries: [] };
      }
      const totalTaps =
        Number.isFinite(parsed.totalTaps) && parsed.totalTaps >= 0
          ? Math.floor(parsed.totalTaps)
          : 0;
      const slowTaps =
        Number.isFinite(parsed.slowTaps) && parsed.slowTaps >= 0
          ? Math.floor(parsed.slowTaps)
          : 0;
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries.filter(isValidTapEntry).slice(-TAP_LOG_MAX_ENTRIES)
        : [];
      return { totalTaps, slowTaps, entries };
    } catch {
      return { totalTaps: 0, slowTaps: 0, entries: [] };
    }
  }

  // Persist the log (counters + entries). Storage failures (private
  // mode, quota) are swallowed: the log stays in-memory only.
  _persist() {
    try {
      this.storage.setItem(
        TAP_LOG_KEY,
        JSON.stringify({
          totalTaps: this._totalTaps,
          slowTaps: this._slowTaps,
          entries: this._entries,
        })
      );
    } catch {
      // Storage unavailable: in-memory only, do not throw.
    }
  }

  /**
   * Measure one Commit tap. Called from the click handler with the
   * event's timeStamp (when the browser created the tap). Counts the
   * tap, then schedules a frame check: when the frame lands, the
   * tap-to-frame latency is classified (recordTap). A tap while the
   * page is hidden is not measured at all: no frame fires while
   * hidden, so there is no latency to measure.
   *
   * The timeStamp shares performance.now()'s time origin in modern
   * browsers, but older ones used epoch time (far larger than now)
   * or 0. A stamp that cannot be a real tap time falls back to the
   * handler time, so a bad stamp can never produce a bogus huge
   * latency.
   */
  measureTap(
    tapTimeMs,
    { starOnScreen = false, saveStatus = null, visible = true } = {}
  ) {
    if (!visible) return;
    const now = this._now();
    let tapTime = tapTimeMs;
    if (!Number.isFinite(tapTime) || tapTime <= 0 || tapTime > now) {
      tapTime = now;
    }
    this._totalTaps += 1;
    this._persist();
    const context = {
      starOnScreen: Boolean(starOnScreen),
      saveStatus: saveStatus ?? null,
      visible: true,
    };
    this._raf(() => {
      // The tab was backgrounded between tap and frame: the frame was
      // delayed by the tab switch, not by a blocked main thread, so
      // the latency is meaningless. Skip it instead of logging a
      // false slow tap.
      if (this._isHidden()) return;
      this.recordTap({ latencyMs: this._now() - tapTime, ...context });
    });
  }

  /**
   * Classify one measured tap. Only a slow tap (latency over the
   * 500ms threshold) gets an entry; fast taps just count. An invalid
   * latency (not finite, negative) records nothing: it must never
   * poison the log.
   */
  recordTap({
    latencyMs,
    starOnScreen = false,
    saveStatus = null,
    visible = true,
  } = {}) {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    if (latencyMs <= SLOW_TAP_THRESHOLD_MS) return;
    const entry = {
      at: new Date().toISOString(),
      latencyMs: Math.round(latencyMs),
      starOnScreen: Boolean(starOnScreen),
      saveStatus: saveStatus ?? null,
      visible: Boolean(visible),
    };
    this._entries.push(entry);
    if (this._entries.length > TAP_LOG_MAX_ENTRIES) {
      this._entries.splice(0, this._entries.length - TAP_LOG_MAX_ENTRIES);
    }
    this._slowTaps += 1;
    this._persist();
  }

  /**
   * Diagnostics snapshot for Settings (Copy diagnostics): the tap
   * counters and the slow-tap log (chronological, oldest first). A
   * fresh copy each call, so the caller cannot mutate the log.
   */
  getSnapshot() {
    return {
      totalTaps: this._totalTaps,
      slowTaps: this._slowTaps,
      entries: this._entries.map((e) => ({ ...e })),
    };
  }
}
