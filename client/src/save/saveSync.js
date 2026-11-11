/**
 * SaveSync — guest-only save synchronization engine (Slice 2).
 *
 * Owns the whole client save loop: mint a player id on first run, load
 * the last accepted snapshot, heartbeat saves, saves on big actions, and
 * the retry/revert rules the server requires.
 *
 * Rules it enforces (from the Slice 1 spec + server contract):
 * - localStorage holds ONLY the anonymous playerId, never currency.
 * - 429 (rate limit, one accepted save per 10s): keep the actions and
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
 * Star claims are the other exception: a claim carries its effect,
 * good/bad roll, and amounts, which no state delta can reconstruct, so
 * the star UI records them explicitly via recordStarClaim. Like clicks,
 * they reset on an accepted save (200) or a revert (409) and are kept
 * on a rate limit (429) so the retry sends them with the longer window.
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
} from "./api.js";
import {
  stateToSaveState,
  bigActionFields,
  bigActionIncreased,
  diffCounts,
  isInitialSaveState,
} from "./serialize.js";
import {
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  initialSaveState,
} from "../../../shared/game-balance.js";

/** Heartbeat interval (spec rule 9: "heartbeat is 60 seconds"). */
export const SAVE_HEARTBEAT_MS = 60_000;
/** Fallback retry delay when the server gives no retryAfterSeconds. */
export const DEFAULT_RETRY_AFTER_SECONDS = 10;
/**
 * Minimum seconds between accepted saves, enforced by the server.
 * Must match SAVE_RATE_LIMIT_SECONDS in server/src/validate.js.
 * The footer uses it to grey out "Save now" until a manual save can
 * actually land, instead of letting the user tap it into a 429 retry.
 */
export const SAVE_RATE_LIMIT_SECONDS = 10;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  } = {}) {
    this.apiBaseUrl = apiBaseUrl;
    this.getState = getState;
    this.restore = restore;
    this.onStatus = onStatus || (() => {});
    this.onPlayerId = onPlayerId || (() => {});
    this.onSavedAt = onSavedAt || (() => {});
    this.onRetry = onRetry || (() => {});
    this.storage = storage || defaultStorage();
    this._setTimeout = setTimeoutFn;
    this._clearTimeout = clearTimeoutFn;

    this.playerId = null;
    // Last accepted snapshot (flat save shape). The baseline for deltas.
    this.baseline = null;
    // Clicks since the baseline. Only WRITE_CODE increments this, and it
    // always applies, so the count is exact.
    this.clicks = 0;
    // Golden-star claims since the baseline. Only the star UI records
    // these (recordStarClaim), with the effect and amounts the server
    // validates. Reset on an accepted save or a revert, kept on a 429.
    this.starClaims = [];
    // Farm breed claims since the baseline (issue #79 feedback). Only
    // the farm breed handler records these (recordFarmBreed), with the
    // breedId and kids the server rolled. Reset on an accepted save or
    // a revert, kept on a 429. A kid being born changes the farm llama
    // count, which is a big-action save trigger, so no separate
    // prompt-save flag is needed — the big-action path saves promptly.
    this.farmBreedClaims = [];
    // A prompt save is pending for the recorded claims (star fix
    // slice). Set by recordStarClaim, cleared when noteState starts
    // the save — one prompt attempt per claim, not one per tick.
    this._starClaimSavePending = false;
    this.initialized = false;
    // True when init could not reach the server: play locally from the
    // initial state and retry the load before the first save.
    this.needsLoad = false;

    this._inFlight = false;
    // True while resetProgress() runs: requestSave is a no-op then, so
    // no stale save can land after the reset and resurrect old progress.
    this._resetting = false;
    this._pendingSave = false;
    this._currentSave = null;
    this._retryTimer = null;
    this._heartbeatTimer = null;
    this._startPromise = null;
    this._started = false;
    this._lastSeenBig = null;
    this._onVisibilityChange = null;
    this._onPageHide = null;
  }

  setStatus(status) {
    this.onStatus(status);
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
      if (document.hidden) this.requestSave("page-hide");
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
          this.initialized = true;
          // The load tells us when the server last accepted a save;
          // report it so the footer shows the real relative time
          // ("Saved 5m ago") instead of the "Progress saved" fallback.
          const savedAtMs = Date.parse(data.savedAt);
          if (!Number.isNaN(savedAtMs)) this.onSavedAt(savedAtMs);
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
   * Record one golden-star claim (a clicked star's resolved outcome).
   * The claim is the shape `resolveStarClaim` returns in
   * shared/game-balance.js; the server validates it and credits it in
   * the LOC/money rules. Call it in the same handler that dispatches
   * the reward, with the exact deltas applied, so the claim and the
   * state change can never disagree. Marks a prompt save as pending —
   * noteState requests it once the state change propagates
   * (star-claim-expiry fix: the issued outcome stays valid 300s after
   * issue).
   */
  recordStarClaim(claim) {
    this.starClaims.push({ ...claim });
    this._starClaimSavePending = true;
  }

  /**
   * Record one farm breed claim (a server-rolled breeding tick's kids).
   * The claim is `{ breedId, kids }` (kids is the list of
   * `{ stallIndex, type }` the server rolled); the server validates it
   * and the save only accepts kids that match an issued outcome. Call
   * it in the same handler that dispatches the breed result, with the
   * exact kids applied, so the claim and the state change can never
   * disagree.
   */
  recordFarmBreed(claim) {
    this.farmBreedClaims.push({ ...claim });
  }

  /**
   * Called on every state change (from the React provider). Triggers a
   * save when a big action actually happened (a hire, an open-source
   * level) — not on ticks, failed actions, or project completions.
   * Ship is deliberately excluded: it's a rapid-fire action, and saving
   * on every Ship spams the 10s rate limit. Ship progress is saved by
   * the heartbeat and the keepalive instead.
   */
  noteState(clientState) {
    const big = bigActionFields(stateToSaveState(clientState));
    if (!this.initialized) {
      this._lastSeenBig = big;
      return;
    }
    // A golden-star claim must reach the server promptly: the issued
    // outcome stays valid 300s after issue (star-claim-expiry fix),
    // and the claim only reaches the server in a save. The big-action
    // email trigger does not cover it — when the inbox is full (25
    // emails), a new email deletes the oldest, the count stays 25, and
    // no big-action save fires, so the claim would wait for the 60s
    // heartbeat. Request one prompt save per claim (recordStarClaim
    // sets the flag); the save splices the claims out on success, so
    // it fires once. No save is started while one is in flight (the
    // flag stays set, so the next state change retries it) or while a
    // rate-limit retry is already scheduled, so a rate-limited or
    // offline claim does not spam a save on every tick.
    if (
      this._starClaimSavePending &&
      this.starClaims.length > 0 &&
      !this._inFlight &&
      this._retryTimer == null
    ) {
      this._starClaimSavePending = false;
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
        this.setStatus("error");
        return { ok: false, error: "network" };
      }
      if (result.status !== 200) {
        console.warn(`[save] reset failed (HTTP ${result.status})`);
        this.setStatus("error");
        return { ok: false, error: `http-${result.status}` };
      }
      const initial = initialSaveState();
      this.baseline = initial;
      this.clicks = 0;
      this.starClaims = [];
      this.farmBreedClaims = [];
      this._starClaimSavePending = false;
      this._lastSeenBig = bigActionFields(initial);
      this.needsLoad = false;
      this.restore(initial);
      this.onSavedAt(Date.now());
      this.setStatus("saved");
      return { ok: true };
    } finally {
      this._resetting = false;
    }
  }

  /**
   * Request a save. Serializes: if one is in flight, queues one after it.
   * Returns a promise that resolves when the save (and any queued flush)
   * completes, so callers can await it. Fire-and-forget callers (heartbeat,
   * retry timer) just ignore the return.
   */
  requestSave(reason, { keepalive } = {}) {
    if (this._resetting) {
      // A reset is running: no save may start (or queue) while it
      // runs, or a stale save could land after the reset and bring
      // the old progress back.
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
    try {
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
              this.clicks = 0;
              this.starClaims = [];
              this.farmBreedClaims = [];
              this.needsLoad = false;
              // Same as init's load: report when the server last saved.
              const savedAtMs = Date.parse(data.savedAt);
              if (!Number.isNaN(savedAtMs)) this.onSavedAt(savedAtMs);
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
              this.setStatus("offline");
              return;
            }
          }
        } catch (err) {
          console.warn("[save] still offline, skipping save:", err);
          this.setStatus("offline");
          return;
        }
      }

      const current = this.getState();
      const saveState = stateToSaveState(current);
      const sentClicks = this.clicks;
      const sentStarClaimCount = this.starClaims.length;
      const sentFarmBreedClaimCount = this.farmBreedClaims.length;
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
        // A copy: claims recorded while this save is in flight stay
        // queued for the next save (same as clicks, below).
        starClaims: [...this.starClaims],
        // Farm breed claims (issue #79 feedback): same copy pattern
        // as the star claims above.
        farmBreedClaims: [...this.farmBreedClaims],
      };

      let result;
      try {
        result = await saveGame(
          this.apiBaseUrl,
          { playerId: this.playerId, state: saveState, actionsSinceLastSave: actions },
          { keepalive }
        );
      } catch (err) {
        // Network failure: keep everything, retry on the next heartbeat.
        console.warn("[save] save failed (network):", err);
        this.setStatus("offline");
        outcome = "offline";
        return;
      }

      if (result.status === 200) {
        // Accepted: the sent state is the new baseline. Only subtract the
        // clicks that were sent — clicks made while the save was in flight
        // stay counted for the next save. Same for star claims: drop the
        // sent ones, keep any claimed while the save was in flight.
        // Same for farm breed claims.
        this.baseline = saveState;
        this.clicks = Math.max(0, this.clicks - sentClicks);
        this.starClaims.splice(0, sentStarClaimCount);
        this.farmBreedClaims.splice(0, sentFarmBreedClaimCount);
        this._clearRetryTimer();
        this.onRetry(null);
        this.onSavedAt(Date.now());
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
        if (lastGood) {
          this.baseline = lastGood.state;
          this.restore(lastGood.state);
          this._lastSeenBig = bigActionFields(lastGood.state);
        }
        this.clicks = 0;
        this.starClaims = [];
        this.farmBreedClaims = [];
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
          this.setStatus("offline");
          return;
        }
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
        this.setStatus("error");
        return;
      }
      console.warn(`[save] unexpected save status ${result.status}`);
      this.setStatus("error");
    } finally {
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
    this.playerId = minted.playerId;
    this.baseline = minted.state;
    this.storage.setItem(PLAYER_ID_KEY, minted.playerId);
    this.onPlayerId(minted.playerId);
    this.restore(minted.state);
    this._lastSeenBig = bigActionFields(minted.state);
    this.clicks = 0;
    this.starClaims = [];
    this.farmBreedClaims = [];
    this.needsLoad = false;
  }
}
