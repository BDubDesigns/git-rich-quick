/**
 * Save-service API client (Slice 2, guest-only).
 *
 * Thin fetch wrapper over the Slice 1 endpoints:
 * - POST /api/player — mint an anonymous player id (uuid-v4)
 * - GET  /api/load?playerId=... — last accepted snapshot, or 404
 * - POST /api/save — validate and store a save
 *
 * Direct to the live service by default (issue: Vercel rewrite drops
 * POST bodies). The client used to be same-origin ("") so /api/* went
 * through the rewrite in vercel.json, which made the Better Auth
 * session cookie first-party (Safari accepted it, where it blocked the
 * old cross-site cookie). That rewrite is broken for POSTs: it forwards
 * GETs fine but never delivers a POST body, so the server waits in
 * readJsonBody forever and every save/reset/link hangs — the footer
 * sits on "Saving…" and no progress ever lands, even though the
 * service itself is healthy (direct POSTs answer in ~1s). So the
 * browser default is now the live service URL, called directly. The
 * server already allows cross-origin requests from *.vercel.app
 * (PR #36 CORS), and the save/load endpoints authenticate by playerId
 * in the request, not by the session cookie, so they work cross-origin.
 * The Vercel rewrite stays in vercel.json but the client no longer
 * relies on it. In local dev the Vite dev-server proxy forwards /api/*
 * to the local backend (see vite.config.js), so localhost keeps
 * same-origin. Override the backend with VITE_SAVE_API_URL to point at
 * a different service directly (e.g. `VITE_SAVE_API_URL=http://localhost:3000
 * npm run dev`, or the live service from a non-Vercel host). The URL is
 * public, not a secret — there is no auth in v1, only the anonymous
 * player id.
 *
 * This module is plain JS (no React) so the sync engine can be tested in
 * Node against a local server. It must not import anything from the
 * client app (no GameContext) to avoid a circular import.
 */

// Live save service (verified live at https://grq-save.qcfailed.com).
// Used as the Node/test default, and as the rewrite target in vercel.json.
const LIVE_API_URL = "https://grq-save.qcfailed.com";

function resolveApiBaseUrl() {
  // Vite (browser): import.meta.env.VITE_SAVE_API_URL
  // Node (tests): process.env.VITE_SAVE_API_URL (via globalThis, which
  // exists in both; `process` is not a browser global).
  const viteUrl =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_SAVE_API_URL;
  const nodeUrl =
    typeof globalThis !== "undefined" &&
    globalThis.process &&
    globalThis.process.env &&
    globalThis.process.env.VITE_SAVE_API_URL;
  const override = viteUrl || nodeUrl;
  if (override) {
    // No trailing slash — callers append "/api/..." paths.
    return String(override).replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    // Browser default: call the live service directly, EXCEPT on
    // localhost (local dev), where same-origin ("") keeps the Vite
    // dev-server proxy forwarding /api/* to the local backend.
    // The Vercel rewrite is broken for POSTs — it forwards GETs fine
    // but never delivers a POST body, so the server waits in
    // readJsonBody forever and every save hangs (the footer sits on
    // "Saving…" and no progress lands). Direct calls bypass it.
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "";
    }
    return LIVE_API_URL;
  }
  // Node (tests): no page origin, so default to the live service URL.
  // Tests pass their own base URL explicitly; this is only the fallback.
  return LIVE_API_URL;
}

export const SAVE_API_URL = resolveApiBaseUrl();

/** localStorage key for the anonymous player id. The ONLY thing stored locally. */
export const PLAYER_ID_KEY = "grq:playerId";

/**
 * Default timeout for every save-service request. Fetch has no built-in
 * timeout, so without this a stalled request hangs forever: SaveSync
 * stays in "saving" (its _inFlight flag never clears, since _doSave
 * never reaches its finally) and every later save just queues behind
 * it, so the footer sits on "Saving…" and no progress ever lands.
 * A timeout turns a stall into an ordinary network failure, which the
 * engine already handles (status "offline", keep the actions, retry on
 * the next heartbeat). 15s is generous — the service normally answers
 * in under a second — but short enough that a hung save recovers
 * instead of sticking the UI.
 */
const REQUEST_TIMEOUT_MS = 15_000;

async function request(baseUrl, path, { method = "GET", body, keepalive } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    // keepalive lets a page-hide save finish after the tab unloads.
    keepalive: keepalive ? true : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  const retryAfterHeader = res.headers.get("retry-after");
  const retryAfterSeconds = data?.retryAfterSeconds
    ? Number(data.retryAfterSeconds)
    : retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : null;
  return { status: res.status, data, retryAfterSeconds };
}

/**
 * Mint an anonymous player. Returns `{ playerId, state, savedAt }`
 * (201) or throws on a non-201 / network failure.
 */
export async function mintPlayer(baseUrl = SAVE_API_URL) {
  const { status, data } = await request(baseUrl, "/api/player", {
    method: "POST",
    body: {},
  });
  if (status !== 201) {
    throw new Error(`mint player failed: HTTP ${status}`);
  }
  return data;
}

/**
 * Load the last accepted snapshot for a player.
 * Returns `{ status, data }` — 200 with `{ playerId, state, savedAt }`,
 * 404 `{ error: "unknown-player" }` for a fresh/unknown player,
 * 400 for a malformed id. Throws on network failure.
 */
export async function loadSave(baseUrl, playerId) {
  return request(baseUrl, `/api/load?playerId=${encodeURIComponent(playerId)}`);
}

/**
 * Save a snapshot. `body` is `{ playerId, state, actionsSinceLastSave }`.
 * Returns `{ status, data, retryAfterSeconds }`:
 * - 200 `{ ok: true, savedAt, state }`
 * - 409 `{ error, rule, detail, lastGoodState }` (revert to lastGoodState)
 * - 429 `{ error, rule, retryAfterSeconds }` (keep actions, retry later)
 * - 400 `{ error, rule, detail }` (malformed — a client bug, log it)
 * - 404 `{ error: "unknown-player" }` (player row is gone)
 * Throws on network failure.
 */
export async function saveGame(baseUrl, body, { keepalive } = {}) {
  return request(baseUrl, "/api/save", {
    method: "POST",
    body,
    keepalive,
  });
}

/**
 * Reset a player's progress (Danger Zone): POST /api/save/reset, body
 * `{ playerId }`. The server overwrites the player's own save row with
 * the fresh initial state and clears their server-side star state.
 * Returns `{ status, data }`:
 * - 200 `{ ok: true, playerId, savedAt, state }` — the fresh state.
 * - 404 `{ error: "unknown-player" }`.
 * - 400 for a malformed id.
 * Throws on network failure.
 */
export async function resetSave(baseUrl, playerId) {
  return request(baseUrl, "/api/save/reset", {
    method: "POST",
    body: { playerId },
  });
}

/**
 * Leaderboard (issue #29): the top 10 accounts, ranked by `sort`
 * ("lifetime" | "current" | "cash"; default lifetime). Public read.
 * Returns `{ status, data }` — 200 with
 * `{ sort, entries: [{ rank, displayName, lifetimeLoc, currentLoc, money }] }`.
 * Throws on network failure.
 */
export async function getLeaderboard(baseUrl = SAVE_API_URL, sort = "lifetime") {
  return request(
    baseUrl,
    `/api/leaderboard?sort=${encodeURIComponent(sort)}`
  );
}

/**
 * Next golden star (issue #29): when the player's next star may spawn.
 * The server rolls the time; the response is
 * `{ nextStarAtMs, secondsUntilStar, constellationLevel, countdownUnlocked,
 *   starBrokerLevel, buyCooldownSecondsRemaining, buyCost }`.
 * `secondsUntilStar` is a duration (null at level 0), so the client
 * schedules from it instead of comparing wall clocks. The StarBroker
 * fields are the buy status for the Buy Star button: the player's
 * StarBroker level, seconds until another star can be bought (0 when
 * ready, null when the player owns no StarBroker), and the LOC cost of
 * the next buy (30x passive LOC/s). Returns
 * `{ status, data }`; 404 for an unknown player. Throws on network failure.
 */
export async function getNextStar(baseUrl, playerId) {
  return request(
    baseUrl,
    `/api/star/next?playerId=${encodeURIComponent(playerId)}`
  );
}

/**
 * Claim the due golden star (issue #29): the server rolls the outcome,
 * records it as an issued outcome, and rolls the next spawn time.
 * Returns `{ status, data }`:
 * - 200 `{ claim, nextStarAtMs, secondsUntilStar }` — apply exactly
 *   this claim (it carries its claimId) and record it for the next save.
 * - 409 `{ error: "no-stars" | "star-not-due" }` — no star to claim.
 * - 404 `{ error: "unknown-player" }`.
 * Throws on network failure.
 */
export async function claimStar(baseUrl, playerId) {
  return request(baseUrl, "/api/star/claim", {
    method: "POST",
    body: { playerId },
  });
}

/**
 * Buy a golden star (StarBroker): the server validates the StarBroker
 * level, the buy cooldown, and affordability against the stored state,
 * deducts the cost (30x passive LOC/s) from the stored state's LOC,
 * and records a pending bought star — without touching the natural
 * star timer, so the bought star stacks with a natural one. The
 * outcome is rolled when the bought star is clicked (claimBoughtStar),
 * not here. Returns `{ status, data }`:
 * - 200 `{ cost, linesOfCode, nextBuyAtMs, boughtStarAtMs,
 *   starBrokerLevel, buyCooldownSeconds }` — deduct the cost locally,
 *   show the bought star, and arm the cooldown from nextBuyAtMs.
 * - 409 `{ error: "no-star-broker" | "no-stars" | "star-buy-cooldown" |
 *   "not-enough-loc" }` — the buy was refused (the cooldown response
 *   carries nextBuyAtMs + cooldownSecondsRemaining).
 * - 404 `{ error: "unknown-player" }`.
 * Throws on network failure.
 */
export async function buyStar(baseUrl, playerId) {
  return request(baseUrl, "/api/star/buy", {
    method: "POST",
    body: { playerId },
  });
}

/**
 * Claim a bought golden star (StarBroker): the server rolls the
 * outcome from the stored state, records it as an issued outcome,
 * and clears the pending bought star. Returns `{ status, data }`:
 * - 200 `{ claim }` — apply exactly this claim (it carries its
 *   claimId) and record it for the next save, same as a natural claim.
 * - 409 `{ error: "no-stars" | "no-bought-star" | "star-not-due" }` —
 *   no bought star to claim (already claimed, never bought, or burned out).
 * - 404 `{ error: "unknown-player" }`.
 * Throws on network failure.
 */
export async function claimBoughtStar(baseUrl, playerId) {
  return request(baseUrl, "/api/star/claim-bought", {
    method: "POST",
    body: { playerId },
  });
}

/**
 * Roll one farm breeding tick server-side (issue #79 feedback): the
 * server rolls the breeding outcome from the sent farm (same
 * mood/lighting odds) and records it as an issued outcome. Returns
 * `{ status, data }`:
 * - 200 `{ breedId, kids }` — kids is the list of `{ stallIndex, type }`
 *   born this tick (empty when nothing was born; breedId is null then).
 *   Apply exactly these kids and record the claim for the next save.
 * - 409 `{ error: "farm-not-owned" | "farm-breed-cooldown" }` — no
 *   farm yet, or the breed was rolled too recently.
 * - 404 `{ error: "unknown-player" }`.
 * - 400 `{ error: "invalid-farm-breed" }` — malformed farm.
 * Throws on network failure.
 */
export async function breedFarm(baseUrl, playerId, farm) {
  return request(baseUrl, "/api/farm/breed", {
    method: "POST",
    body: { playerId, farm },
  });
}
