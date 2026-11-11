/**
 * Save-service API client (Slice 2, guest-only).
 *
 * Thin fetch wrapper over the Slice 1 endpoints:
 * - POST /api/player — mint an anonymous player id (uuid-v4)
 * - GET  /api/load?playerId=... — last accepted snapshot, or 404
 * - POST /api/save — validate and store a save
 *
 * Same-origin by default (Slice 3, issue #28): in the browser the base
 * URL is "" (relative), so /api/* goes to the page's own origin. In
 * production and on Vercel previews the rewrite in vercel.json proxies
 * /api/* to the live service, which makes the Better Auth session cookie
 * first-party — Safari accepts it, where it blocked the old cross-site
 * cookie. In local dev the Vite dev-server proxy forwards /api/* to the
 * local backend (see vite.config.js). Override the backend with
 * VITE_SAVE_API_URL to point at a different service directly (e.g.
 * `VITE_SAVE_API_URL=http://localhost:3000 npm run dev`, or the live
 * service from a non-Vercel host). The URL is public, not a secret —
 * there is no auth in v1, only the anonymous player id.
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
    // Browser default: same-origin (""), so fetch("/api/...") is relative
    // to the page origin and goes through the Vercel rewrite (or the Vite
    // dev-server proxy locally). The auth client resolves the same way:
    // Better Auth's client falls back to window.location.origin + /api/auth.
    return "";
  }
  // Node (tests): no page origin, so default to the live service URL.
  // Tests pass their own base URL explicitly; this is only the fallback.
  return LIVE_API_URL;
}

export const SAVE_API_URL = resolveApiBaseUrl();

/** localStorage key for the anonymous player id. The ONLY thing stored locally. */
export const PLAYER_ID_KEY = "grq:playerId";

async function request(baseUrl, path, { method = "GET", body, keepalive } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    // keepalive lets a page-hide save finish after the tab unloads.
    keepalive: keepalive ? true : undefined,
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
 * `{ nextStarAtMs, secondsUntilStar, constellationLevel, countdownUnlocked }`.
 * `secondsUntilStar` is a duration (null at level 0), so the client
 * schedules from it instead of comparing wall clocks. Returns
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
