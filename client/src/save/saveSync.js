/**
 * SaveSync — guest-only save synchronization engine (Slice 2).
 *
 * Owns the whole client save loop: mint a player id on first run, load
 * the last accepted snapshot, heartbeat saves, saves on big actions, and
 * the retry/revert rules the server requires.
 *
 * Rules it enforces (from the Slice 1 spec + server contract):
 * - localStorage holds ONLY the anonymous playerId, never currency.
 * - 429 (rate limit, one accepted save per 1s): keep the actions and
 *   retry after the server's retry delay. Never reset the accumulator.
 *   While waiting, the engine reports status "retrying" and the delay
 *   (via onRetry) so the footer can show a countdown instead of a bare
 *   "Saving...".
 * - 409 (validation failure): revert local state to the server's
 *   lastGoodState and reset the accumulator — the local state was wrong.
 * - 400 (shape): log it; it is a client bug, not a state problem.
 * - 404 on load: fresh start (mint a new player).
 * - A brand-new player's first save can 429 (the rate limit is measured
 *   from the minting time) — that is handled by the same retry path,
 *   not treated as an error.
 *
 * Action deltas are derived from state (current - last accepted), never
 * counted from dispatches, so a reducer-rejected action (e.g. buying
 * with too little money) can never be counted. Clicks are the one
 * exception: WRITE_CODE always applies, so they are counted directly.
 * A star claim is a prompt save (the claim's reward is in the state,
 * and the star schedule re-rolls — both are big-action fields — but a
 * bought-star claim changes neither, so the star UI also asks for a
 * prompt save explicitly via requestClaimSave). Golden-star outcomes
 * and farm kids are rolled client-side now, so they arrive inside the
 * ordinary save payload — there is nothing to record or validate
 * against a server-issued outcome anymore.
 *
 * Framework-free (plain JS, no React) so it can be tested in Node
 * against a local save server. The React adapter lives in GameContext,
 * which passes getState / restore / onStatus callbacks in.
 */

import {
  SAVE_API_URL,
  PLAYER_ID_KEY,
  mintPlayer,
  loadSave,
  saveGame,
  resetSave,
  sellCompany,
  buyStoreRank,
  completeIntermission,
} from "./api.js";
import {
  stateToSaveState,
  bigActionFields,
  bigActionIncreased,
  diffCounts,
  isInitialSaveState,
  savePayloadError,
} from "./serialize.js";
import {
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  initialSaveState,
} from "../../../shared/game-balance.js";
import { setOffsetFromSavedAt } from "./serverClock.js";
import { defaultFetchDeployedBuild } from "./versionCheck.js";
import { BUILD_ID } from "../version.js";

/** Heartbeat interval (spec rule 9: "heartbeat is 60 seconds"). */
export const SAVE_HEARTBEAT_MS = 60_000;
/**
 * Save status while a newer build is deployed (stale-client guard):
 * this tab no longer saves, and the footer asks the player to reload.
 * Sticky: once set, no other status replaces it.
 */
export const NEW_VERSION_STATUS = "update-available";
/**
 * Minimum gap between two version.json fetches before saves: one per
 * heartbeat (a little under 60s, so timer jitter cannot skip one).
 * Starting up and coming back to the tab check right away.
 */
export const VERSION_CHECK_INTERVAL_MS = SAVE_HEARTBEAT_MS - 5_000;
/** Fallback retry delay when the server gives no retryAfterSeconds. */
export const DEFAULT_RETRY_AFTER_SECONDS = 10;
/**
 * Minimum seconds between accepted saves, enforced by the server.
 * Must match SAVE_RATE_LIMIT_SECONDS in server/src/validate.js.
 * The footer uses it to grey out "Save now" until a manual save can
 * actually land, instead of letting the user tap it into a 429 retry.
 */
export const SAVE_RATE_LIMIT_SECONDS = 1;

/** localStorage key for the save-attempt diagnostics log. */
const SAVE_ATTEMPTS_KEY = "grq:saveAttempts";
/** How many save attempts the diagnostics log keeps (newest 20). */
const SAVE_ATTEMPTS_MAX = 20;

/**
 * Short greppable detail for a thrown error: the timeout name for a
 * stalled request, otherwise the message (fetch failures read
 * "Failed to fetch"). Used in the diagnostics log so a network failure
 * is identifiable without opening the console.
 */
function errorDetail(err) {
  if (!err) return "unknown error";
  if (err.name === "TimeoutError") return "TimeoutError";
  if (err.message) return String(err.message);
  return String(err.name ?? err);
}

/**
 * Short greppable detail for a server rejection: "RULE: detail"
 * (e.g. "SHAPE: freelanceProjectsCompleted has a null value"), the
 * rule alone when there is no detail, or the server's error string.
 */
function rejectionDetail(data) {
  if (!data || typeof data !== "object") return "rejected";
  if (data.rule) {
    return data.detail ? `${data.rule}: ${data.detail}` : String(data.rule);
  }
  if (data.error) return String(data.error);
  return "rejected";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh idempotency key for one sale attempt (prestige, Slice 1).
 * crypto.randomUUID when available; a v4-shaped Math.random fallback
 * otherwise, so the key is always a UUID the sale endpoint accepts. */
function newSaleId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const hex = (n) =>
    [...Array(n)]
      .map(() => Math.floor(Math.random() * 16).toString(16))
      .join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

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

export class SaveSync {
  /**
   * @param {string} apiBaseUrl - save service base URL.
   * @param {() => object} getState - returns the current client reducer state.
   * @param {(saveState) => void} restore - replaces the game fields with a server snapshot.
   * @param {(status: string) => void} onStatus - "loading" | "saving" |
   *   "retrying" | "saved" | "offline" | "error".
   * @param {(playerId: string) => void} [onPlayerId] - called when the player id is known.
   * @param {(timestampMs: number) => void} [onSavedAt] - called when a save is
   *   accepted, with the time it completed (drives the footer's "Saved Xs ago").
   *   Also called with the loaded save's savedAt when init loads an
   *   existing save, so the footer shows the real relative time.
   * @param {(seconds: number | null) => void} [onRetry] - called with the
   *   retry delay in seconds when a save is rate-limited and a retry is
   *   scheduled, and with null once the retry wait is over (save
   *   accepted or rejected). Drives the footer's "Retrying in Ns".
   * @param {object} [storage] - getItem/setItem/removeItem (defaults to localStorage).
   * @param {(fn: Function, ms: number) => any} [setTimeoutFn] - timer
   *   used to schedule the rate-limit retry (defaults to the global
   *   setTimeout). Injectable so tests can control the retry clock:
   *   the retry-timer test asserts the timer object is unchanged by
   *   saves during the wait, which is only deterministic when the
   *   timer cannot fire mid-test on a loaded runner (issue #50).
   * @param {(id: any) => void} [clearTimeoutFn] - timer used to cancel
   *   the rate-limit retry (defaults to the global clearTimeout).
   * @param {(savedAt: string) => void} [onServerTime] - called with the
   *   `savedAt` of every response the server stamped "now" (an accepted
   *   save, a mint, a fresh reset / sale / store buy / intermission),
   *   never a load's (that is when the save was stored, not the current
   *   time) and never a failed save's. Defaults to the star clock's
   *   setOffsetFromSavedAt (issue #148).
   * @param {(report: object) => void} [onNightShift] - called once with the
   *   load response's Night Shift report (issue #149) when the server
   *   settled offline production, after the settled state is restored.
   * @param {string} [clientBuild] - this bundle's build id, sent with
   *   every state-writing request (the server refuses one without it,
   *   rule STALE_CLIENT). Defaults to BUILD_ID (__BUILD_ID__); tests
   *   pass a fixed id.
   * @param {(() => Promise<string | null>) | null} [fetchDeployedBuild] -
   *   returns the deployed build id (version.json), or null when it
   *   cannot be told. Defaults to the version.json fetch in a browser
   *   and none in Node. When it answers an id other than clientBuild,
   *   the engine stops saving and reports NEW_VERSION_STATUS.
   * @param {() => number} [now] - clock for the version-check throttle
   *   (defaults to Date.now).
   */
  constructor({
    apiBaseUrl = SAVE_API_URL,
    getState,
    restore,
    onStatus,
    onPlayerId,
    onSavedAt,
    onRetry,
    storage,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onServerTime = setOffsetFromSavedAt,
    onNightShift,
    clientBuild = BUILD_ID,
    fetchDeployedBuild = defaultFetchDeployedBuild(),
    now = Date.now,
  } = {}) {
    this.apiBaseUrl = apiBaseUrl;
    this.getState = getState;
    this.restore = restore;
    this.onStatus = onStatus || (() => {});
    this.onPlayerId = onPlayerId || (() => {});
    this.onSavedAt = onSavedAt || (() => {});
    this.onRetry = onRetry || (() => {});
    this.onServerTime = onServerTime || (() => {});
    this.onNightShift = onNightShift || (() => {});
    this.storage = storage || defaultStorage();
    // Stale-client guard: this bundle's build id, and how to read the
    // deployed one. newVersionAvailable latches true once they differ.
    this.clientBuild = clientBuild;
    this._fetchDeployedBuild = fetchDeployedBuild || null;
    this._now = now;
    this.newVersionAvailable = false;
    this._versionCheckedAtMs = null;
    this._versionCheckPromise = null;
    // Wrap the timers rather than storing them as-is: calling a stored
    // function as this._setTimeout(...) binds `this` to the SaveSync
    // instance, and the browser's window.setTimeout/clearTimeout throw
    // "TypeError: Illegal invocation" when `this` isn't window. Node's
    // timers don't care, so only a real browser showed it. The wrappers
    // call the functions unbound, which both browsers and test fakes accept.
    this._setTimeout = (fn, ms) => setTimeoutFn(fn, ms);
    this._clearTimeout = (id) => clearTimeoutFn(id);

    this.playerId = null;
    // Last accepted snapshot (flat save shape). The baseline for deltas.
    this.baseline = null;
    // Clicks since the baseline. Only WRITE_CODE increments this, and it
    // always applies, so the count is exact.
    this.clicks = 0;
    // A prompt save is pending for a golden-star claim (natural or
    // bought). Set by requestClaimSave, cleared when noteState starts
    // the save — one prompt attempt per claim, not one per tick. The
    // claim itself needs no record anymore: the star is rolled
    // client-side, so the reward is just part of the save state.
    this._claimSavePending = false;
    this.initialized = false;
    // True when init could not reach the server: play locally from the
    // initial state and retry the load before the first save.
    this.needsLoad = false;

    this._inFlight = false;
    // True while resetProgress() runs: requestSave is a no-op then, so
    // no stale save can land after the reset and resurrect old progress.
    this._resetting = false;
    // True while sellCompany() runs: requestSave is a no-op then, for
    // the same reason — a stale pre-sale save must not land after the
    // sale and resurrect the sold company.
    this._selling = false;
    // True while a store buy or an intermission completion runs:
    // requestSave is a no-op then, for the same reason — a stale
    // save must not land after the purchase and resurrect the spent
    // Equity, or after the completion and resurrect the intermission.
    this._storeBusy = false;
    this._pendingSave = false;
    this._currentSave = null;
    this._retryTimer = null;
    this._heartbeatTimer = null;
    this._startPromise = null;
    this._started = false;
    this._lastSeenBig = null;
    this._onVisibilityChange = null;
    this._onPageHide = null;
    // Diagnostics: the current status and last-saved time (for the
    // snapshot), and the save-attempt log (last 20, persisted so a
    // stuck save can be inspected after a reload).
    this._saveStatus = "loading";
    this._lastSavedAtMs = null;
    this._saveAttempts = this._loadSaveAttempts();
  }

  setStatus(status) {
    // A newer build is deployed: the reload prompt stays up whatever
    // else happens (a failed sale, a load), until the player reloads.
    if (this.newVersionAvailable && status !== NEW_VERSION_STATUS) return;
    this._saveStatus = status;
    this.onStatus(status);
  }

  // Night Shift (issue #149): hand a load's settlement report to the
  // game once the settled state is restored. A missing report (nothing
  // settled) is skipped; a throwing callback never breaks the load.
  _reportNightShift(report) {
    if (!report || typeof report !== "object") return;
    try {
      this.onNightShift(report);
    } catch (err) {
      console.warn("[save] could not show the Night Shift report:", err);
    }
  }

  // Star clock (issue #148): pass a server-stamped "now" to the clock
  // offset. Only called with a FRESH savedAt; a missing value is
  // ignored by the clock (it keeps the old offset).
  _reportServerTime(savedAt) {
    try {
      this.onServerTime(savedAt);
    } catch (err) {
      console.warn("[save] could not update the server clock offset:", err);
    }
  }

  // Record when a save was accepted (or an existing save was loaded)
  // so the diagnostics snapshot reports the real last-saved time.
  _reportSavedAt(timestampMs) {
    this._lastSavedAtMs = timestampMs;
    this.onSavedAt(timestampMs);
  }

  // Load the persisted save-attempt log (last 20). A missing,
  // malformed, or unreadable value just means an empty log.
  _loadSaveAttempts() {
    try {
      const raw = this.storage.getItem(SAVE_ATTEMPTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (e) =>
            e &&
            typeof e === "object" &&
            typeof e.at === "string" &&
            typeof e.trigger === "string" &&
            typeof e.outcome === "string"
        )
        .slice(-SAVE_ATTEMPTS_MAX);
    } catch {
      return [];
    }
  }

  // Append one save attempt to the diagnostics log (capped at 20,
  // oldest dropped) and persist it. Storage failures (private mode,
  // quota) are swallowed: the log stays in-memory only.
  _recordSaveAttempt({ trigger, outcome, status, detail }) {
    const entry = {
      at: new Date().toISOString(),
      trigger,
      outcome,
      status: typeof status === "number" ? status : null,
      detail: detail ? String(detail) : null,
    };
    this._saveAttempts.push(entry);
    if (this._saveAttempts.length > SAVE_ATTEMPTS_MAX) {
      this._saveAttempts.splice(
        0,
        this._saveAttempts.length - SAVE_ATTEMPTS_MAX
      );
    }
    try {
      this.storage.setItem(
        SAVE_ATTEMPTS_KEY,
        JSON.stringify(this._saveAttempts)
      );
    } catch {
      // Storage unavailable: in-memory only, do not throw.
    }
  }

  /**
   * Diagnostics snapshot for Settings (Copy diagnostics): the save
   * attempt log (chronological, oldest first), the current save
   * status, the last accepted save time (ms since epoch, null when
   * never), and the player id. A fresh copy each call, so the caller
   * cannot mutate the engine's log.
   */
  getSaveDiagnostics() {
    return {
      attempts: this._saveAttempts.map((a) => ({ ...a })),
      saveStatus: this._saveStatus,
      lastSavedAt: this._lastSavedAtMs,
      playerId: this.playerId,
    };
  }

  /**
   * Stale-client guard: is a newer build deployed than this one?
   * Fetches version.json at most once per VERSION_CHECK_INTERVAL_MS
   * (`force` skips the wait: start-up and coming back to the tab), and
   * shares one fetch between callers. When the deployed id differs
   * from clientBuild, latches newVersionAvailable, cancels a pending
   * retry and reports NEW_VERSION_STATUS; from then on no save is
   * sent. An unknown deployed id (offline, 404, `vite dev`) counts as
   * "same version", so the save goes ahead. Resolves to
   * newVersionAvailable; never throws.
   */
  async checkForNewVersion({ force = false } = {}) {
    if (this.newVersionAvailable) return true;
    if (!this._fetchDeployedBuild) return false;
    if (this._versionCheckPromise) return this._versionCheckPromise;
    if (
      !force &&
      this._versionCheckedAtMs != null &&
      this._now() - this._versionCheckedAtMs < VERSION_CHECK_INTERVAL_MS
    ) {
      return false;
    }
    this._versionCheckedAtMs = this._now();
    this._versionCheckPromise = (async () => {
      let deployed = null;
      try {
        deployed = await this._fetchDeployedBuild();
      } catch {
        deployed = null;
      }
      if (
        typeof deployed === "string" &&
        deployed !== "" &&
        deployed !== this.clientBuild
      ) {
        this._markNewVersion(deployed);
      }
      return this.newVersionAvailable;
    })();
    try {
      return await this._versionCheckPromise;
    } finally {
      this._versionCheckPromise = null;
    }
  }

  _markNewVersion(deployed) {
    if (this.newVersionAvailable) return;
    console.warn(
      `[save] a newer build is deployed (${deployed}, this tab runs ${this.clientBuild}); saves are paused until reload`
    );
    this._recordSaveAttempt({
      trigger: "version-check",
      outcome: "new-version",
      status: null,
      detail: `deployed ${deployed}, running ${this.clientBuild}`,
    });
    this._pendingSave = false;
    this._clearRetryTimer();
    this.onRetry(null);
    this.newVersionAvailable = true;
    this.setStatus(NEW_VERSION_STATUS);
  }

  /** Start: init (mint/load), then the 60s heartbeat. Safe to call twice. */
  async start() {
    if (this._startPromise) return this._startPromise;
    this._started = true;
    this._startPromise = (async () => {
      await this.init();
      // init may have been stopped while it was in flight (StrictMode
      // double-mount in dev): only start the heartbeat if still started.
      if (!this._started) return;
      this.startHeartbeat();
      this._attachPageHideSave();
      // Stale-client guard: check once on load, without holding up start.
      this.checkForNewVersion({ force: true });
    })();
    return this._startPromise;
  }

  /** Stop: clear timers/listeners. A later start() re-initializes. */
  stop() {
    this._started = false;
    this._startPromise = null;
    if (this._retryTimer) {
      this._clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._detachPageHideSave();
  }

  startHeartbeat() {
    if (this._heartbeatTimer) return;
    this._heartbeatTimer = setInterval(
      () => this.requestSave("heartbeat"),
      SAVE_HEARTBEAT_MS
    );
    // Don't unref in the browser; in Node the interval keeps the process
    // alive, which is fine for tests that call stop().
    if (
      typeof this._heartbeatTimer.unref === "function" &&
      typeof process !== "undefined"
    ) {
      this._heartbeatTimer.unref();
    }
  }

  _attachPageHideSave() {
    if (typeof document === "undefined") return;
    this._onVisibilityChange = () => {
      if (document.hidden) {
        this.requestSave("page-hide");
      } else {
        // Back on the tab (maybe after hours): look for a newer build.
        this.checkForNewVersion({ force: true });
      }
    };
    this._onPageHide = () => {
      // keepalive lets the request finish after the tab unloads.
      this.requestSave("page-hide", { keepalive: true });
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);
    window.addEventListener("pagehide", this._onPageHide);
  }

  _detachPageHideSave() {
    if (typeof document === "undefined") return;
    if (this._onVisibilityChange) {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    if (this._onPageHide) {
      window.removeEventListener("pagehide", this._onPageHide);
      this._onPageHide = null;
    }
  }

  /** Mint a player or load the stored one. Sets baseline + playerId. */
  async init() {
    this.setStatus("loading");
    const stored = this.storage.getItem(PLAYER_ID_KEY);
    if (stored && UUID_RE.test(stored)) {
      try {
        const { status, data } = await loadSave(this.apiBaseUrl, stored);
        if (status === 200) {
          this.playerId = stored;
          this.baseline = data.state;
          this.onPlayerId(stored);
          this.restore(data.state);
          this._lastSeenBig = bigActionFields(data.state);
          this._reportNightShift(data.nightShift);
          this.initialized = true;
          // The load tells us when the server last accepted a save;
          // report it so the footer shows the real relative time
          // ("Saved 5m ago") instead of the "Progress saved" fallback.
          const savedAtMs = Date.parse(data.savedAt);
          if (!Number.isNaN(savedAtMs)) this._reportSavedAt(savedAtMs);
          this.setStatus("saved");
          return;
        }
        // 404/400: the stored id is unknown or malformed — fresh start.
        console.warn(`[save] stored player id not found (HTTP ${status}); minting a new player`);
      } catch (err) {
        // Network failure: play locally from the initial state and retry
        // the load before the first save (see needsLoad in _doSave).
        console.warn("[save] could not reach the save server on load:", err);
        this.playerId = stored;
        this.baseline = initialSaveState();
        this.needsLoad = true;
        this.onPlayerId(stored);
        this.initialized = true;
        this.setStatus("offline");
        return;
      }
    }
    // No stored id (or it was unknown): mint a new anonymous player.
    try {
      const minted = await mintPlayer(this.apiBaseUrl);
      this._reportServerTime(minted.savedAt);
      this.playerId = minted.playerId;
      this.baseline = minted.state;
      this.storage.setItem(PLAYER_ID_KEY, minted.playerId);
      this.onPlayerId(minted.playerId);
      this.restore(minted.state);
      this._lastSeenBig = bigActionFields(minted.state);
      this.initialized = true;
      this.setStatus("saved");
    } catch (err) {
      console.warn("[save] could not reach the save server to mint a player:", err);
      // No player yet: keep playing locally; the heartbeat will retry init.
      this.baseline = initialSaveState();
      this.needsLoad = true;
      this.initialized = true;
      this.setStatus("offline");
    }
  }

  /** Record one click (WRITE_CODE). It always applies, so this is exact. */
  recordClick() {
    this.clicks += 1;
  }

  /**
   * Ask for a prompt save after a golden-star claim (a clicked star's
   * resolved outcome, natural or bought). The claim's reward is in
   * the state already (LOC/money or a buff), so there is nothing to
   * record — this only marks a prompt save as pending. noteState
   * requests it once the state change propagates. Call it in the same
   * handler that dispatches the reward, so the claim and the state
   * change can never disagree. A natural claim also re-rolls the star
   * schedule (a big-action field), so it would save promptly anyway;
   * this flag is what covers a bought-star claim, which changes no
   * big-action field (no schedule change, no buff unless it rolls
   * one) — without it, a bought Lucky claim would wait for the 60s
   * heartbeat.
   */
  requestClaimSave() {
    this._claimSavePending = true;
  }

  /**
   * Called on every state change (from the React provider). Triggers a
   * save when a big action actually happened (a hire, an open-source
   * level) — not on ticks, failed actions, or project completions.
   * Ship is deliberately excluded: it's a rapid-fire action, and saving
   * on every Ship spams the 1s rate limit. Ship progress is saved by
   * the heartbeat and the keepalive instead.
   */
  noteState(clientState) {
    const big = bigActionFields(stateToSaveState(clientState));
    if (!this.initialized) {
      this._lastSeenBig = big;
      return;
    }
    // A golden-star claim must reach the server promptly: the reward
    // (LOC/money or a buff) is in the state, but a bought-star claim
    // changes no big-action field, so without this the claim would
    // wait for the 60s heartbeat — and a tab close before then loses
    // it. Request one prompt save per claim (requestClaimSave sets
    // the flag); the flag clears when the save starts, so it fires
    // once. No save is started while one is in flight (the flag stays
    // set, so the next state change retries it) or while a rate-limit
    // retry is already scheduled, so a rate-limited or offline claim
    // does not spam a save on every tick.
    if (
      this._claimSavePending &&
      !this._inFlight &&
      this._retryTimer == null
    ) {
      this._claimSavePending = false;
      this.requestSave("star-claim");
    } else if (bigActionIncreased(this._lastSeenBig, big)) {
      this.requestSave("big-action");
    }
    this._lastSeenBig = big;
  }

  /**
   * Reset all progress (Danger Zone): wipe the player's save back to
   * the fresh initial state, on the server AND locally. The player
   * keeps the same playerId (and the same account link); only the
   * progress goes to 0. A normal save can never do this — the server
   * rejects going backwards — so this calls the dedicated reset
   * endpoint, which overwrites the row server-side. While the reset
   * runs, no other save may start (the `_resetting` flag makes
   * requestSave a no-op), and an in-flight save is awaited first, so
   * a stale save cannot land after the reset and resurrect the old
   * progress. On success the local state is restored to the initial
   * state (same RESTORE_SAVE path as a load), the baseline is reset,
   * and the status reads "saved". On failure the local state is
   * untouched. Returns `{ ok: true }` or `{ ok: false, error }`.
   */
  async resetProgress() {
    if (!this.initialized || !this.playerId) {
      return { ok: false, error: "not-initialized" };
    }
    this._resetting = true;
    try {
      // Wait for an in-flight save so it cannot land after the reset.
      // Its finally flushes any save queued behind it, so by the time
      // this await resolves nothing is pending.
      if (this._inFlight && this._currentSave) {
        try {
          await this._currentSave;
        } catch {
          // A failed in-flight save must not block the reset.
        }
      }
      this._pendingSave = false;
      this._clearRetryTimer();
      this.onRetry(null);
      let result;
      try {
        result = await resetSave(this.apiBaseUrl, this.playerId);
      } catch (err) {
        console.warn("[save] reset failed (network):", err);
        this._recordSaveAttempt({
          trigger: "reset",
          outcome: "offline",
          status: null,
          detail: errorDetail(err),
        });
        this.setStatus("error");
        return { ok: false, error: "network" };
      }
      if (result.status !== 200) {
        console.warn(`[save] reset failed (HTTP ${result.status})`);
        this._recordSaveAttempt({
          trigger: "reset",
          outcome: "error",
          status: result.status,
          detail: `HTTP ${result.status}`,
        });
        this.setStatus("error");
        return { ok: false, error: `http-${result.status}` };
      }
      const initial = initialSaveState();
      this.baseline = initial;
      this.clicks = 0;
      this._claimSavePending = false;
      this._lastSeenBig = bigActionFields(initial);
      this.needsLoad = false;
      this.restore(initial);
      this._reportServerTime(result.data?.savedAt);
      this._reportSavedAt(Date.now());
      this.setStatus("saved");
      this._recordSaveAttempt({
        trigger: "reset",
        outcome: "reset",
        status: 200,
        detail: null,
      });
      return { ok: true };
    } finally {
      this._resetting = false;
    }
  }

  /**
   * Sell the Company (prestige, Slice 1): claim Equity from the
   * player's lifetime LOC and atomically reset the company, on the
   * server AND locally. The player keeps the same playerId (and the
   * same account link); only the company goes to 0 — Lifetime LOC,
   * Equity, cosmetics, emails, and preferences survive (see
   * shared.applyPrestigeSale for the full reset list).
   *
   * The sale goes through the dedicated /api/save/sell endpoint, not
   * the normal save: a normal save can never go backwards, so it
   * could never carry the reset. The request sends the freshest
   * pre-sale state (the sale settles production up to the sale) plus
   * a fresh saleId; the server validates, claims, and stores the
   * post-sale state in one transaction, and this method restores it
   * locally (the same RESTORE_SAVE path as a load) and re-baselines
   * the engine on it. While the sale runs, no other save may start
   * (the `_selling` flag makes requestSave a no-op), and an in-flight
   * save is awaited first, so a stale pre-sale save cannot land after
   * the sale and resurrect the sold company.
   *
   * Idempotency (criterion 5): the saleId is fresh per attempt. If
   * this attempt's response is lost and the UI retries, the retry
   * must mint a NEW saleId — the server answers a repeated saleId
   * with the already-applied state, and a new saleId with no new
   * Equity behind it is a 409, not a second claim. (The SellCompany
   * panel retries by calling this method again, which mints a new
   * id; a retry of the same HTTP request is the transport's job, and
   * the server's already-applied path covers it.)
   *
   * On failure the local state is untouched. Returns
   * `{ ok: true, state, sale }` or `{ ok: false, error, detail }`
   * (error is "not-initialized" | "network" | a rule like "SALE" /
   * "PRESTIGE" | `http-<status>`).
   */
  /**
   * Funding Rounds save wipe (issue #170): a sale, store buy or
   * intermission call that hits a save row from before the current
   * schema gets a 409 with rule WIPE and the fresh company as
   * lastGoodState. The server already reset the row, so the local
   * state is stale: adopt the fresh one, the same revert the heartbeat
   * save does on a 409. Any other rejection keeps the local state (a
   * "no new Equity" sale must not throw away unsaved progress).
   */
  _revertIfWiped(result) {
    const lastGood = result?.data?.lastGoodState;
    if (result?.status !== 409 || result?.data?.rule !== "WIPE" || !lastGood) {
      return;
    }
    this.baseline = lastGood.state;
    this.restore(lastGood.state);
    this._lastSeenBig = bigActionFields(lastGood.state);
    this.clicks = 0;
  }

  async sellCompany() {
    if (!this.initialized || !this.playerId) {
      return { ok: false, error: "not-initialized" };
    }
    // Stale-client guard: a tab behind the deployed build must not
    // write its older state (the reload prompt is already up).
    if (await this.checkForNewVersion()) {
      return { ok: false, error: "new-version" };
    }
    this._selling = true;
    try {
      // Wait for an in-flight save so it cannot land after the sale.
      // Its finally flushes any save queued behind it, so by the time
      // this await resolves nothing is pending.
      if (this._inFlight && this._currentSave) {
        try {
          await this._currentSave;
        } catch {
          // A failed in-flight save must not block the sale.
        }
      }
      this._pendingSave = false;
      this._clearRetryTimer();
      this.onRetry(null);
      const current = this.getState();
      const saveState = stateToSaveState(current);
      const actions = this._actionsSinceBaseline(saveState);
      let result;
      try {
        result = await sellCompany(this.apiBaseUrl, {
          playerId: this.playerId,
          saleId: newSaleId(),
          state: saveState,
          actionsSinceLastSave: actions,
          clientBuild: this.clientBuild,
        });
      } catch (err) {
        console.warn("[save] sale failed (network):", err);
        this._recordSaveAttempt({
          trigger: "sale",
          outcome: "offline",
          status: null,
          detail: errorDetail(err),
        });
        this.setStatus("error");
        return { ok: false, error: "network" };
      }
      if (result.status !== 200) {
        this._revertIfWiped(result);
        console.warn(
          `[save] sale failed (HTTP ${result.status}):`,
          result.data?.rule,
          result.data?.detail
        );
        this._recordSaveAttempt({
          trigger: "sale",
          outcome: "error",
          status: result.status,
          detail: rejectionDetail(result.data),
        });
        this.setStatus("error");
        return {
          ok: false,
          error: result.data?.rule ?? `http-${result.status}`,
          detail: result.data?.detail ?? null,
        };
      }
      const postState = result.data.state;
      this.baseline = postState;
      this.clicks = 0;
      this._claimSavePending = false;
      this._lastSeenBig = bigActionFields(postState);
      this.needsLoad = false;
      this.restore(postState);
      // A replayed request (already applied / owned / completed)
      // echoes the OLD savedAt, so only a fresh write sets the clock.
      if (
        !result.data?.alreadyApplied &&
        !result.data?.alreadyOwned &&
        !result.data?.alreadyCompleted
      ) {
        this._reportServerTime(result.data?.savedAt);
      }
      this._reportSavedAt(Date.now());
      this.setStatus("saved");
      this._recordSaveAttempt({
        trigger: "sale",
        outcome: "sale",
        status: 200,
        detail: result.data.alreadyApplied
          ? "already applied (retry)"
          : null,
      });
      return { ok: true, state: postState, sale: result.data.sale ?? null };
    } finally {
      this._selling = false;
    }
  }

  /**
   * The actions since the last accepted save, derived from state
   * (current - baseline), never counted from dispatches — shared by
   * the sale, the store buy, and the intermission completion, which
   * all send the freshest state plus the same actions shape. Clicks
   * are the one exception: WRITE_CODE always applies, so they are
   * counted directly.
   */
  _actionsSinceBaseline(saveState) {
    return {
      clicks: this.clicks,
      employeesBought: diffCounts(
        this.baseline.employees,
        saveState.employees,
        EMPLOYEE_TYPES
      ),
      projectsCompleted: diffCounts(
        this.baseline.freelanceProjectsCompleted,
        saveState.freelanceProjectsCompleted,
        FREELANCE_PROJECT_KEYS
      ),
      autoShips: diffCounts(
        this.baseline.autoShipsCompleted,
        saveState.autoShipsCompleted,
        FREELANCE_PROJECT_KEYS
      ),
      openSourceLevelsBought: diffCounts(
        this.baseline.openSourceProjects,
        saveState.openSourceProjects,
        OPEN_SOURCE_IDS
      ),
    };
  }

  /**
   * Buy the next rank of one permanent-store track (prestige, Slice
   * 2). Mirrors sellCompany: await an in-flight save first, block
   * requestSave while it runs (the `_storeBusy` flag), send the
   * freshest state plus the actions since the baseline, and restore
   * the server's returned state locally (the same RESTORE_SAVE path
   * as a load) and re-baseline the engine on it.
   *
   * `rank` is the rank being bought — always the next rank after the
   * one owned, computed here from the local state, so the UI never
   * has to track it. Idempotency: the server answers a retried
   * purchase of an already-owned rank with the already-owned state
   * and no second charge; this method restores that state and
   * reports success (alreadyOwned: true), so a lost response never
   * double-charges.
   *
   * On failure the local state is untouched. Returns
   * `{ ok: true, state, purchase, alreadyOwned }` or
   * `{ ok: false, error, detail }` (error is "not-initialized" |
   * "network" | a rule like "STORE" / "PRESTIGE" | `http-<status>`).
   */
  async buyStoreRank(storeId) {
    if (!this.initialized || !this.playerId) {
      return { ok: false, error: "not-initialized" };
    }
    // Stale-client guard: a tab behind the deployed build must not
    // write its older state (the reload prompt is already up).
    if (await this.checkForNewVersion()) {
      return { ok: false, error: "new-version" };
    }
    this._storeBusy = true;
    try {
      if (this._inFlight && this._currentSave) {
        try {
          await this._currentSave;
        } catch {
          // A failed in-flight save must not block the purchase.
        }
      }
      this._pendingSave = false;
      this._clearRetryTimer();
      this.onRetry(null);
      const current = this.getState();
      const saveState = stateToSaveState(current);
      const rank = (current.permanentStoreRanks?.[storeId] ?? 0) + 1;
      const actions = this._actionsSinceBaseline(saveState);
      let result;
      try {
        result = await buyStoreRank(this.apiBaseUrl, {
          playerId: this.playerId,
          storeId,
          rank,
          state: saveState,
          actionsSinceLastSave: actions,
          clientBuild: this.clientBuild,
        });
      } catch (err) {
        console.warn("[save] store buy failed (network):", err);
        this._recordSaveAttempt({
          trigger: "store-buy",
          outcome: "offline",
          status: null,
          detail: errorDetail(err),
        });
        this.setStatus("error");
        return { ok: false, error: "network" };
      }
      if (result.status !== 200) {
        this._revertIfWiped(result);
        console.warn(
          `[save] store buy failed (HTTP ${result.status}):`,
          result.data?.rule,
          result.data?.detail
        );
        this._recordSaveAttempt({
          trigger: "store-buy",
          outcome: "error",
          status: result.status,
          detail: rejectionDetail(result.data),
        });
        this.setStatus("error");
        return {
          ok: false,
          error: result.data?.rule ?? `http-${result.status}`,
          detail: result.data?.detail ?? null,
        };
      }
      const postState = result.data.state;
      this.baseline = postState;
      this.clicks = 0;
      this._claimSavePending = false;
      this._lastSeenBig = bigActionFields(postState);
      this.needsLoad = false;
      this.restore(postState);
      // A replayed request (already applied / owned / completed)
      // echoes the OLD savedAt, so only a fresh write sets the clock.
      if (
        !result.data?.alreadyApplied &&
        !result.data?.alreadyOwned &&
        !result.data?.alreadyCompleted
      ) {
        this._reportServerTime(result.data?.savedAt);
      }
      this._reportSavedAt(Date.now());
      this.setStatus("saved");
      this._recordSaveAttempt({
        trigger: "store-buy",
        outcome: "store-buy",
        status: 200,
        detail: result.data.alreadyOwned
          ? "already owned (retry)"
          : null,
      });
      return {
        ok: true,
        state: postState,
        purchase: result.data.purchase ?? null,
        alreadyOwned: result.data.alreadyOwned ?? false,
      };
    } finally {
      this._storeBusy = false;
    }
  }

  /**
   * Complete the post-sale intermission (prestige, Slice 2). Mirrors
   * sellCompany and buyStoreRank: await an in-flight save, block
   * requestSave while it runs, send the freshest state, and restore
   * the server's returned state locally and re-baseline on it. The
   * server applies the Starting Capital grant once, from the frozen
   * sale quote, and clears the intermission in the same transaction.
   *
   * Idempotency: the server answers a retried completion with the
   * already-completed state and no second grant; this method restores
   * that state and reports success (alreadyCompleted: true).
   *
   * On failure the local state is untouched. Returns
   * `{ ok: true, state, grant, alreadyCompleted }` or
   * `{ ok: false, error, detail }`.
   */
  async completeIntermission() {
    if (!this.initialized || !this.playerId) {
      return { ok: false, error: "not-initialized" };
    }
    // Stale-client guard: a tab behind the deployed build must not
    // write its older state (the reload prompt is already up).
    if (await this.checkForNewVersion()) {
      return { ok: false, error: "new-version" };
    }
    this._storeBusy = true;
    try {
      if (this._inFlight && this._currentSave) {
        try {
          await this._currentSave;
        } catch {
          // A failed in-flight save must not block the completion.
        }
      }
      this._pendingSave = false;
      this._clearRetryTimer();
      this.onRetry(null);
      const current = this.getState();
      const saveState = stateToSaveState(current);
      const actions = this._actionsSinceBaseline(saveState);
      let result;
      try {
        result = await completeIntermission(this.apiBaseUrl, {
          playerId: this.playerId,
          state: saveState,
          actionsSinceLastSave: actions,
          clientBuild: this.clientBuild,
        });
      } catch (err) {
        console.warn("[save] intermission completion failed (network):", err);
        this._recordSaveAttempt({
          trigger: "intermission-complete",
          outcome: "offline",
          status: null,
          detail: errorDetail(err),
        });
        this.setStatus("error");
        return { ok: false, error: "network" };
      }
      if (result.status !== 200) {
        this._revertIfWiped(result);
        console.warn(
          `[save] intermission completion failed (HTTP ${result.status}):`,
          result.data?.rule,
          result.data?.detail
        );
        this._recordSaveAttempt({
          trigger: "intermission-complete",
          outcome: "error",
          status: result.status,
          detail: rejectionDetail(result.data),
        });
        this.setStatus("error");
        return {
          ok: false,
          error: result.data?.rule ?? `http-${result.status}`,
          detail: result.data?.detail ?? null,
        };
      }
      const postState = result.data.state;
      this.baseline = postState;
      this.clicks = 0;
      this._claimSavePending = false;
      this._lastSeenBig = bigActionFields(postState);
      this.needsLoad = false;
      this.restore(postState);
      // A replayed request (already applied / owned / completed)
      // echoes the OLD savedAt, so only a fresh write sets the clock.
      if (
        !result.data?.alreadyApplied &&
        !result.data?.alreadyOwned &&
        !result.data?.alreadyCompleted
      ) {
        this._reportServerTime(result.data?.savedAt);
      }
      this._reportSavedAt(Date.now());
      this.setStatus("saved");
      this._recordSaveAttempt({
        trigger: "intermission-complete",
        outcome: "intermission-complete",
        status: 200,
        detail: result.data.alreadyCompleted
          ? "already completed (retry)"
          : null,
      });
      return {
        ok: true,
        state: postState,
        grant: result.data.grant ?? null,
        alreadyCompleted: result.data.alreadyCompleted ?? false,
      };
    } finally {
      this._storeBusy = false;
    }
  }

  /**
   * Request a save. Serializes: if one is in flight, queues one after it.
   * Returns a promise that resolves when the save (and any queued flush)
   * completes, so callers can await it. Fire-and-forget callers (heartbeat,
   * retry timer) just ignore the return.
   */
  requestSave(reason, { keepalive } = {}) {
    if (this.newVersionAvailable) {
      // A newer build is deployed: this tab's idea of the save may lack
      // fields the new build writes, so it must not save at all.
      return Promise.resolve(false);
    }
    if (this._resetting || this._selling || this._storeBusy) {
      // A reset, a sale, or a store/intermission step is running: no
      // save may start (or queue) while it runs, or a stale save could
      // land after it and bring the old progress back.
      return Promise.resolve(false);
    }
    if (!this.initialized || !this.playerId) {
      // Mint failed (offline at init): retry init on the next heartbeat.
      if (this.initialized && !this.playerId) {
        this._retryInit();
      }
      return Promise.resolve(false);
    }
    if (this._inFlight) {
      this._pendingSave = true;
      return this._currentSave ?? Promise.resolve(false);
    }
    this._currentSave = this._doSave(reason, { keepalive });
    return this._currentSave;
  }

  async _retryInit() {
    // Only one init retry at a time.
    if (this._initRetrying) return;
    this._initRetrying = true;
    try {
      await this.init();
    } finally {
      this._initRetrying = false;
    }
  }

  _clearRetryTimer() {
    if (this._retryTimer) {
      this._clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  /**
   * Schedule a retry after the server's delay. If a retry is already
   * pending, keep it — don't re-arm the timer. Every Ship click during
   * the wait was sending another save that 429'd and reset the 10s
   * countdown, so the save kept getting pushed back and the footer
   * stayed on "Retrying..." forever. The pending retry sends the latest
   * state when it fires, so nothing is lost. Returns true when a new
   * timer was scheduled, false when one was already pending.
   */
  _scheduleRetry(seconds) {
    if (this._retryTimer != null) return false;
    const delayMs = Math.max(1, seconds) * 1000;
    this._retryTimer = this._setTimeout(() => {
      // Clear before requesting, so the retry's own requestSave doesn't
      // hit a stale timer.
      this._retryTimer = null;
      this.requestSave("retry");
    }, delayMs);
    if (
      typeof this._retryTimer.unref === "function" &&
      typeof process !== "undefined"
    ) {
      this._retryTimer.unref();
    }
    return true;
  }

  async _doSave(reason, { keepalive } = {}) {
    this._inFlight = true;
    this.setStatus("saving");
    let outcome = "done";
    // Diagnostics for this attempt: each branch sets the outcome as
    // it is decided; the finally records it, so every completion is
    // logged (success, rate-limit, revert, error, network failure) even
    // though the branches return early.
    let attemptOutcome = null;
    let attemptStatus = null;
    let attemptDetail = null;
    const note = (o, s, d) => {
      attemptOutcome = o;
      attemptStatus = s ?? null;
      attemptDetail = d ?? null;
    };
    try {
      // Stale-client guard: before saving, make sure no newer build is
      // deployed (throttled to one fetch per heartbeat). A page-hide
      // keepalive save skips the fetch, since the tab may be unloading,
      // and goes by the last answer.
      if (!keepalive) await this.checkForNewVersion();
      if (this.newVersionAvailable) {
        outcome = "new-version";
        return;
      }
      // Offline at init: load the server state before saving, so we never
      // overwrite a real save with a local initial state.
      if (this.needsLoad) {
        try {
          const { status, data } = await loadSave(this.apiBaseUrl, this.playerId);
          if (status === 200) {
            const local = stateToSaveState(this.getState());
            if (isInitialSaveState(local)) {
              // No local progress yet: just adopt the server state.
              this.baseline = data.state;
              this.restore(data.state);
              this._lastSeenBig = bigActionFields(data.state);
              this._reportNightShift(data.nightShift);
              this.clicks = 0;
              this.needsLoad = false;
              // Same as init's load: report when the server last saved.
              const savedAtMs = Date.parse(data.savedAt);
              if (!Number.isNaN(savedAtMs)) this._reportSavedAt(savedAtMs);
              note("saved", 200, "adopted server state");
              this.setStatus("saved");
              return;
            }
            // Local progress exists: keep it and let the server validate
            // it against the loaded snapshot (a 409 reverts if invalid).
            this.baseline = data.state;
            this.needsLoad = false;
          } else {
            // Stored id is gone: mint fresh and start over.
            console.warn(`[save] stored player id not found on retry (HTTP ${status}); minting a new player`);
            try {
              await this._mintFresh();
            } catch (err) {
              console.warn("[save] could not mint a fresh player:", err);
              note("offline", null, errorDetail(err));
              this.setStatus("offline");
              return;
            }
          }
        } catch (err) {
          console.warn("[save] still offline, skipping save:", err);
          note("offline", null, errorDetail(err));
          this.setStatus("offline");
          return;
        }
      }

      const current = this.getState();
      const saveState = stateToSaveState(current);
      // Validate the payload before writing (issue #132): a NaN or a
      // malformed achievements record would 400 on the server anyway,
      // so catch it here, keep the actions, and say why in the
      // diagnostics instead of sending a write the server must refuse.
      const payloadError = savePayloadError(saveState);
      if (payloadError) {
        console.error(`[save] not sending an invalid payload: ${payloadError}`);
        note("invalid-payload", null, payloadError);
        this.setStatus("error");
        outcome = "invalid-payload";
        return;
      }
      const sentClicks = this.clicks;
      const actions = {
        clicks: sentClicks,
        employeesBought: diffCounts(
          this.baseline.employees,
          saveState.employees,
          EMPLOYEE_TYPES
        ),
        projectsCompleted: diffCounts(
          this.baseline.freelanceProjectsCompleted,
          saveState.freelanceProjectsCompleted,
          FREELANCE_PROJECT_KEYS
        ),
        // Release Manager auto-ships this window, per project. Derived
        // from the cumulative auto-ship counter (new - baseline), the
        // same way projectsCompleted is derived above — so the server
        // can rate-cap them against the assigned managers and the ship
        // interval. A reducer-rejected ship is never counted, because
        // the counter only moves when the reducer actually ships.
        autoShips: diffCounts(
          this.baseline.autoShipsCompleted,
          saveState.autoShipsCompleted,
          FREELANCE_PROJECT_KEYS
        ),
        openSourceLevelsBought: diffCounts(
          this.baseline.openSourceProjects,
          saveState.openSourceProjects,
          OPEN_SOURCE_IDS
        ),
      };

      let result;
      try {
        result = await saveGame(
          this.apiBaseUrl,
          {
            playerId: this.playerId,
            state: saveState,
            actionsSinceLastSave: actions,
            clientBuild: this.clientBuild,
          },
          { keepalive }
        );
      } catch (err) {
        // Network failure: keep everything, retry on the next heartbeat.
        console.warn("[save] save failed (network):", err);
        note("offline", null, errorDetail(err));
        this.setStatus("offline");
        outcome = "offline";
        return;
      }

      if (result.status === 200) {
        // Accepted: the sent state is the new baseline. Only subtract the
        // clicks that were sent — clicks made while the save was in flight
        // stay counted for the next save.
        this.baseline = saveState;
        this.clicks = Math.max(0, this.clicks - sentClicks);
        this._clearRetryTimer();
        this.onRetry(null);
        this._reportServerTime(result.data?.savedAt);
        this._reportSavedAt(Date.now());
        note("saved", 200, null);
        this.setStatus("saved");
        return;
      }
      if (result.status === 429) {
        // Rate limit: keep the actions and retry after the server's delay.
        // Never reset the accumulator here. Only report the wait (and
        // re-arm the footer countdown) when a new retry was actually
        // scheduled — a save that 429s while a retry is already pending
        // must not reset the countdown the footer is showing.
        outcome = "rate-limited";
        const retryAfter =
          result.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
        console.info(`[save] rate-limited, retrying in ${retryAfter}s`);
        note("rate-limited", 429, `retry in ${retryAfter}s`);
        if (this._scheduleRetry(retryAfter)) {
          this.onRetry(retryAfter);
        }
        this.setStatus("retrying");
        return;
      }
      if (result.status === 409) {
        // Validation failure: the local state was wrong. Revert to the
        // server's last good state and reset the accumulator. Log the
        // sent state and actions too, so the browser console shows
        // exactly what was rejected and why (not just the rule).
        const lastGood = result.data?.lastGoodState;
        console.error(
          `[save] save rejected (${result.data?.rule}: ${result.data?.detail}); reverting to the last good state`,
          { sentState: saveState, sentActions: actions }
        );
        note("reverted", 409, rejectionDetail(result.data));
        if (lastGood) {
          this.baseline = lastGood.state;
          this.restore(lastGood.state);
          this._lastSeenBig = bigActionFields(lastGood.state);
        }
        this.clicks = 0;
        this._clearRetryTimer();
        this.onRetry(null);
        this.setStatus("error");
        return;
      }
      if (result.status === 404) {
        // The player row is gone: mint fresh and start over.
        console.warn("[save] player not found on save; minting a new player");
        try {
          await this._mintFresh();
        } catch (err) {
          console.warn("[save] could not mint a fresh player:", err);
          note("offline", null, errorDetail(err));
          this.setStatus("offline");
          return;
        }
        note("error", 404, rejectionDetail(result.data));
        this.setStatus("error");
        return;
      }
      if (result.status === 400) {
        // Malformed body: a client bug. Log it (with the sent state and
        // actions, so the browser console shows what was malformed);
        // keep the state and let the next heartbeat retry with fresh state.
        console.error(
          `[save] save rejected as malformed (${result.data?.rule}: ${result.data?.detail})`,
          { sentState: saveState, sentActions: actions }
        );
        note("error", 400, rejectionDetail(result.data));
        this.setStatus("error");
        return;
      }
      console.warn(`[save] unexpected save status ${result.status}`);
      note(
        "error",
        result.status,
        result.data
          ? rejectionDetail(result.data)
          : `HTTP ${result.status}`
      );
      this.setStatus("error");
    } finally {
      if (attemptOutcome) {
        this._recordSaveAttempt({
          trigger: reason,
          outcome: attemptOutcome,
          status: attemptStatus,
          detail: attemptDetail,
        });
      }
      this._inFlight = false;
      // Flush a save that was requested while this one was in flight —
      // unless the outcome was a rate limit, which already scheduled a retry.
      // Awaiting the flush makes the returned promise cover the whole chain.
      if (this._pendingSave && outcome !== "rate-limited") {
        this._pendingSave = false;
        await this.requestSave("pending");
      } else if (outcome === "rate-limited") {
        this._pendingSave = false;
      }
    }
  }

  async _mintFresh() {
    const minted = await mintPlayer(this.apiBaseUrl);
    this._reportServerTime(minted.savedAt);
    this.playerId = minted.playerId;
    this.baseline = minted.state;
    this.storage.setItem(PLAYER_ID_KEY, minted.playerId);
    this.onPlayerId(minted.playerId);
    this.restore(minted.state);
    this._lastSeenBig = bigActionFields(minted.state);
    this.clicks = 0;
    this.needsLoad = false;
  }
}
