/**
 * Get Rich Quick GIT — save service HTTP server (Slice 1 + Slice 3).
 *
 * Plain Node `http`, no framework. Endpoints:
 * - POST /api/player — mint an anonymous player id (uuid-v4)
 * - GET  /api/load?playerId=... — last accepted snapshot, or 404
 * - POST /api/save — validate and store a save (see validate.js)
 * - POST /api/save/reset — reset a player's progress (Danger Zone):
 *   overwrite their own save row with the fresh initial state and
 *   clear their server-side star state. A normal save can never go
 *   backwards (the money rule is exact), so the reset has its own
 *   path; it only ever touches the requesting player's own row.
 * - GET  /healthz — liveness check for Coolify
 * - /api/auth/* — Better Auth (Slice 3, issue #28): sign-up, sign-in,
 *   sign-out, session. Mounted via toNodeHandler; see auth.js.
 * - POST /api/account/link — link a guest playerId to the signed-in
 *   account (Slice 3). GET /api/account/link reads the link.
 *   POST /api/account/unlink removes it.
 * - POST /api/admin/seed-test-player — admin seed (issue #46): overwrite
 *   the ONE test player's saved state, bypassing save validation. Bearer
 *   token (ADMIN_TOKEN) required, test-player-only — see admin.js.
 *   Disabled (501) when ADMIN_TOKEN is unset.
 * - GET  /api/admin/player/:playerId — admin read-only (issue #45): one
 *   player's current save state, by explicit playerId. Bearer token
 *   required; read-only, audit-logged. This one MAY read a real
 *   player's save (that is the point — debugging a specific player's
 *   issue); it never modifies anything. Disabled (501) when unset.
 * - GET  /api/admin/rejected-saves — admin read-only (issue #45): recent
 *   rejected saves (rule, detail, playerId, timestamp) from an
 *   in-memory ring buffer fed by the PR #44 rejection logging.
 * - GET  /api/admin/stats — admin read-only (issue #45): aggregate
 *   counts (players, linked accounts, recent save/rejection activity).
 *   All /api/admin/* endpoints share the bearer-token auth (ADMIN_TOKEN)
 *   and audit logging; see admin.js for the guardrail distinction
 *   (seed is test-player-only, read-only endpoints are per-player
 *   debugging by explicit playerId).
 * - GET  /api/leaderboard — leaderboard (issue #29): top 10 accounts
 *   only, by lifetime LOC (default), current LOC, or cash. Public read.
 * - GET  /api/star/next — next golden star (issue #29): when the
 *   player's next star may spawn, rolled server-side; the client
 *   schedules from it and shows a countdown when unlocked. Also
 *   carries the StarBroker buy status (level, cooldown remaining,
 *   cost) for the Buy Star button.
 * - POST /api/star/claim — claim the due star (issue #29): the server
 *   rolls the outcome, records it as an issued outcome, and rolls the
 *   next spawn time. The client applies exactly the returned claim.
 * - POST /api/star/buy — buy a golden star (StarBroker): the player
 *   sacrifices 30x their passive LOC/s to summon a star on demand.
 *   The natural star timer is never touched — the bought star stacks
 *   with a natural one. See store.buyStar.
 * - POST /api/star/claim-bought — claim a bought star (StarBroker):
 *   the player clicked the star they bought. The server rolls the
 *   outcome (at click time, like the natural star) and clears the
 *   pending bought star. See store.claimBoughtStar.
 *
 * Status mapping: malformed bodies are 400, unknown players are 404,
 * validation failures are 409 with the last good state, and a save that
 * arrives too soon after the last accepted save is 429 — the client keeps
 * its local actions and retries on the next heartbeat instead of
 * discarding them (the 409 path discards local state, which is wrong for
 * a rate limit).
 *
 * CORS allows the Vercel-hosted client and local Vite dev/preview. The
 * client stays on Vercel; only the API lives on Hetzner. The client
 * normally reaches the API same-origin through the Vercel rewrite
 * (vercel.json) or the Vite dev-server proxy, so CORS does not apply to
 * it — but CORS is kept for direct API use (e.g. a client pointed at
 * this API with VITE_SAVE_API_URL, or local dev against the live API).
 * Where the cookie is cross-site (direct use), allowed origins also get
 * Access-Control-Allow-Credentials (and the client must use
 * credentials: "include"); the origin is echoed, never "*".
 *
 * Env: DATABASE_URL (required), PORT (default 3000), HOST (default 0.0.0.0),
 * BETTER_AUTH_SECRET (required in production), BETTER_AUTH_URL (public API
 * URL, default http://localhost:3000), ADMIN_TOKEN (bearer token for the
 * /api/admin/* endpoints; when unset, admin endpoints answer 501).
 * `clock` is injectable for tests; production uses Date.now. `auth` is
 * injectable for tests; production builds it from the pool (see main()).
 * `adminToken` is injectable for tests; production reads ADMIN_TOKEN.
 */

import http from "node:http";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { toNodeHandler } from "better-auth/node";
import { createAuth } from "./auth.js";
import { createStore } from "./store.js";
import { SAVE_RATE_LIMIT_SECONDS, validateSeedState } from "./validate.js";
import { TEST_ACCOUNT_EMAIL, isAdminAuthorized } from "./admin.js";
import { normalizeLeaderboardSort } from "./leaderboard.js";

const MAX_BODY_BYTES = 64 * 1024;

// The Vercel-hosted game client, plus local dev/preview origins.
// Any *.vercel.app origin is allowed so Vercel preview deployments work,
// not just the production domain.
const ALLOWED_ORIGINS = new Set([
  "https://gitrichquick.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    return new URL(origin).hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function iso(ms) {
  return new Date(ms).toISOString();
}

function snapshotBody(snapshot) {
  return {
    playerId: snapshot.playerId,
    state: snapshot.state,
    savedAt: iso(snapshot.savedAtMs),
  };
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    // Echo the origin (never "*") and allow credentials: direct
    // cross-site use of the API (VITE_SAVE_API_URL) still sends the
    // session cookie, so the browser only sends it when credentials
    // mode is on (Slice 3). Same-origin use through the Vercel/Vite
    // proxy does not need CORS at all.
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  // `authorization` is for bearer-token auth clients; the browser client
  // uses the session cookie instead.
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error("request body too large");
      err.code = "BODY_TOO_LARGE";
      throw err;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  return JSON.parse(text);
}

export function createServer(store, { clock = Date.now, auth, adminToken } = {}) {
  const authHandler = auth ? toNodeHandler(auth) : null;

  /** One structured audit line per admin call (issue #46). No token, no state. */
  function auditAdmin(action, fields) {
    console.warn(
      "[admin]",
      action,
      JSON.stringify({ at: new Date(clock()).toISOString(), ...fields })
    );
  }

  /**
   * Admin gate (issues #45/#46): 501 when ADMIN_TOKEN is not
   * configured, 401 for a missing/wrong/malformed token. Returns true
   * when the request is authorized; on failure it has already sent the
   * response (and audit-logged) and the caller returns.
   */
  function requireAdmin(req, res, action) {
    if (!adminToken) {
      auditAdmin(action, { status: "admin-not-configured" });
      sendJson(res, 501, { error: "admin-not-configured" });
      return false;
    }
    if (!isAdminAuthorized(req, adminToken)) {
      auditAdmin(action, { status: "unauthorized" });
      sendJson(res, 401, { error: "unauthorized" });
      return false;
    }
    return true;
  }

  /**
   * Recent rejected saves (issue #45): an in-memory ring buffer fed by
   * the same rejection event the PR #44 logging writes to the console
   * (see handleSave). In-memory on purpose — this endpoint is for
   * debugging RECENT rejections, and a DB table would need schema,
   * pruning, and a migration for data the console log already keeps.
   * Capped at 100 entries (oldest dropped); lost on restart. Entries
   * are `{ playerId, rule, detail, rejectedAtMs }`, newest last.
   */
  const MAX_REJECTED_SAVES = 100;
  const rejectedSaves = [];
  function recordRejectedSave(entry) {
    rejectedSaves.push(entry);
    if (rejectedSaves.length > MAX_REJECTED_SAVES) rejectedSaves.shift();
  }

  /**
   * Admin seed (issue #46): POST /api/admin/seed-test-player, body
   * `{ playerId, state }`. Bearer token required; the seed only ever
   * touches the one test player (linked to the test account — see
   * admin.js). The state is shape-validated but bypasses progression,
   * rate-limit, and LOC/money rules, so a test fixture can be any valid
   * state. 401 for a missing/wrong token, 501 when ADMIN_TOKEN is not
   * configured, 403 when the player is not the test player, 404 for an
   * unknown playerId, 400 for a malformed body or state.
   */
  async function handleAdminSeed(req, res) {
    if (!requireAdmin(req, res, "seed-test-player")) return;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err.code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body-too-large" });
        return;
      }
      sendJson(res, 400, { error: "invalid-json" });
      return;
    }
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.playerId !== "string" ||
      !UUID_RE.test(body.playerId) ||
      body.state === null ||
      typeof body.state !== "object" ||
      Array.isArray(body.state)
    ) {
      sendJson(res, 400, {
        error: "invalid-seed",
        detail: "playerId must be a UUID string and state must be an object",
      });
      return;
    }
    const shape = validateSeedState(body.state);
    if (!shape.ok) {
      sendJson(res, 400, { error: "invalid-seed", detail: shape.detail });
      return;
    }
    const nowMs = clock();
    const result = await store.seedTestPlayer(
      body.playerId,
      shape.state,
      nowMs,
      TEST_ACCOUNT_EMAIL
    );
    if (result.status === "unknown-player") {
      auditAdmin("seed-test-player", {
        status: "unknown-player",
        playerId: body.playerId,
      });
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    if (result.status === "not-test-player") {
      auditAdmin("seed-test-player", {
        status: "not-test-player",
        playerId: body.playerId,
      });
      sendJson(res, 403, { error: "not-test-player" });
      return;
    }
    auditAdmin("seed-test-player", {
      status: "ok",
      playerId: body.playerId,
    });
    sendJson(res, 200, {
      ok: true,
      playerId: body.playerId,
      savedAt: iso(result.savedAtMs),
      state: result.state,
    });
  }

  /**
   * Admin read-only (issue #45): GET /api/admin/player/:playerId — one
   * player's current save state. Read-only: it returns the snapshot,
   * never modifies anything. Unlike the seed endpoint, this one MAY
   * read a REAL player's save — that is its purpose (debugging a
   * specific player's issue, by explicit playerId). It is still
   * token-protected and audit-logged, and there is no bulk/list
   * endpoint. 400 for a malformed id, 404 for an unknown player.
   */
  async function handleAdminPlayer(req, res, playerId) {
    if (!requireAdmin(req, res, "player")) return;
    if (!UUID_RE.test(playerId)) {
      sendJson(res, 400, { error: "invalid-player-id" });
      return;
    }
    const snapshot = await store.get(playerId);
    if (!snapshot) {
      auditAdmin("player", { status: "unknown-player", playerId });
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    auditAdmin("player", { status: "ok", playerId });
    sendJson(res, 200, {
      playerId: snapshot.playerId,
      state: snapshot.state,
      savedAt: iso(snapshot.savedAtMs),
      createdAt: iso(snapshot.createdAtMs),
    });
  }

  /**
   * Admin read-only (issue #45): GET /api/admin/rejected-saves —
   * recent rejected saves, most recent first. Each entry is the rule,
   * detail, playerId, and timestamp — the same event the PR #44
   * logging writes to the console. `?limit=` caps the list (default
   * 50, max 100, the ring buffer size). Read-only: it never touches
   * player data, it only reads the in-memory buffer.
   */
  async function handleAdminRejectedSaves(req, res, url) {
    if (!requireAdmin(req, res, "rejected-saves")) return;
    const parsed = Number.parseInt(
      url.searchParams.get("limit") ?? "50",
      10
    );
    const limit = Number.isFinite(parsed)
      ? Math.min(100, Math.max(1, parsed))
      : 50;
    const entries = [...rejectedSaves]
      .reverse()
      .slice(0, limit)
      .map((entry) => ({
        playerId: entry.playerId,
        rule: entry.rule,
        detail: entry.detail,
        rejectedAt: iso(entry.rejectedAtMs),
      }));
    auditAdmin("rejected-saves", { status: "ok", count: entries.length });
    sendJson(res, 200, { rejections: entries, count: entries.length });
  }

  /**
   * Admin read-only (issue #45): GET /api/admin/stats — aggregate
   * counts only, never individual player data. Windows are the last
   * 1 hour and the last 24 hours (documented here and in the README):
   * - playerCount / linkedAccounts: rows in git_saves, and rows linked
   *   to an account.
   * - savesLastHour / savesLastDay: players whose last accepted save
   *   is inside the window (activity proxy, not a save-event count).
   * - rejectionsLastHour / rejectionsLastDay: rejection events in the
   *   ring buffer inside the window; rejectionsStored is the buffer
   *   size. Read-only: it only counts.
   */
  async function handleAdminStats(req, res) {
    if (!requireAdmin(req, res, "stats")) return;
    const nowMs = clock();
    const counts = await store.getAdminStats(nowMs);
    const hourAgo = nowMs - 60 * 60 * 1000;
    const dayAgo = nowMs - 24 * 60 * 60 * 1000;
    const rejectionsLastHour = rejectedSaves.filter(
      (entry) => entry.rejectedAtMs >= hourAgo
    ).length;
    const rejectionsLastDay = rejectedSaves.filter(
      (entry) => entry.rejectedAtMs >= dayAgo
    ).length;
    auditAdmin("stats", { status: "ok" });
    sendJson(res, 200, {
      ...counts,
      rejectionsLastHour,
      rejectionsLastDay,
      rejectionsStored: rejectedSaves.length,
    });
  }

  /** The signed-in user for this request, or null (no/invalid session). */
  async function getSessionUser(req) {
    if (!auth) return null;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const session = await auth.api.getSession({ headers });
    return session?.user ?? null;
  }

  async function handleLink(req, res) {
    if (!auth) {
      sendJson(res, 501, { error: "auth-not-configured" });
      return;
    }
    const user = await getSessionUser(req);
    if (!user) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err.code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body-too-large" });
        return;
      }
      sendJson(res, 400, { error: "invalid-json" });
      return;
    }
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.playerId !== "string" ||
      !UUID_RE.test(body.playerId)
    ) {
      sendJson(res, 400, {
        error: "invalid-player-id",
        detail: "playerId must be a UUID string",
      });
      return;
    }
    const result = await store.linkPlayerToUser(body.playerId, user.id);
    if (result.status === "unknown-player") {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    if (result.status === "conflict") {
      sendJson(res, 409, {
        error: "link-conflict",
        reason: result.reason,
      });
      return;
    }
    sendJson(res, 200, { ok: true, playerId: result.playerId });
  }

  async function handleGetLink(req, res) {
    if (!auth) {
      sendJson(res, 501, { error: "auth-not-configured" });
      return;
    }
    const user = await getSessionUser(req);
    if (!user) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const playerId = await store.getPlayerIdForUser(user.id);
    if (!playerId) {
      sendJson(res, 404, { error: "not-linked" });
      return;
    }
    sendJson(res, 200, { playerId });
  }

  async function handleUnlink(req, res) {
    if (!auth) {
      sendJson(res, 501, { error: "auth-not-configured" });
      return;
    }
    const user = await getSessionUser(req);
    if (!user) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const playerId = await store.unlinkPlayerFromUser(user.id);
    sendJson(res, 200, { ok: true, playerId });
  }

  async function handleSave(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err.code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body-too-large" });
        return;
      }
      sendJson(res, 400, { error: "invalid-json" });
      return;
    }
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.playerId !== "string" ||
      !UUID_RE.test(body.playerId)
    ) {
      sendJson(res, 400, {
        error: "invalid-save",
        rule: "SHAPE",
        detail: "playerId must be a UUID string",
      });
      return;
    }
    const nowMs = clock();
    const result = await store.applySave(body.playerId, body, nowMs);
    if (result.status === "unknown-player") {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    if (result.status === "rejected") {
      // Log rejected saves with the state and reason, so a 409/400/429
      // can be diagnosed from the server logs without asking the player
      // for a screenshot. One line per rejection; no secrets or tokens.
      console.warn(
        "[save] rejected save",
        JSON.stringify({
          playerId: body.playerId,
          rule: result.rule,
          detail: result.detail,
          prevSavedAtMs: result.lastGood?.savedAtMs ?? null,
          state: body.state,
          actionsSinceLastSave: body.actionsSinceLastSave,
        })
      );
      // Feed the admin rejected-saves ring buffer (issue #45) with
      // the same event, so the list and the log can never disagree.
      recordRejectedSave({
        playerId: body.playerId,
        rule: result.rule,
        detail: result.detail,
        rejectedAtMs: nowMs,
      });
      if (result.rule === "RATE_LIMIT") {
        const retryAfter = Math.max(
          1,
          Math.ceil(
            (SAVE_RATE_LIMIT_SECONDS * 1000 -
              (nowMs - result.lastGood.savedAtMs)) /
              1000
          )
        );
        sendJson(
          res,
          429,
          { error: "rate-limited", rule: "RATE_LIMIT", retryAfterSeconds: retryAfter },
          { "retry-after": String(retryAfter) }
        );
        return;
      }
      if (result.rule === "SHAPE") {
        sendJson(res, 400, {
          error: "invalid-save",
          rule: "SHAPE",
          detail: result.detail,
        });
        return;
      }
      sendJson(res, 409, {
        error: "save-rejected",
        rule: result.rule,
        detail: result.detail,
        lastGoodState: snapshotBody(result.lastGood),
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      savedAt: iso(result.savedAtMs),
      state: result.state,
    });
  }

  /**
   * Reset a player's progress (Danger Zone): POST /api/save/reset,
   * body `{ playerId }`. The server overwrites the requesting
   * player's own save row with the fresh initial state and clears
   * their server-side star state (see store.resetPlayer) — the
   * player keeps the same playerId and the same account link; only
   * the progress goes to 0. A normal save can never do this (the
   * money rule is exact and the deltas forbid going backwards), so
   * the reset bypasses validateSave on its own path. It is NOT rate
   * limited: a player who just saved can still reset. 400 for a
   * malformed body, 404 for an unknown player. The playerId is the
   * credential here, the same as /api/save in v1 — the endpoint can
   * only ever touch the row matching the given playerId.
   */
  async function handleResetSave(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err.code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body-too-large" });
        return;
      }
      sendJson(res, 400, { error: "invalid-json" });
      return;
    }
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.playerId !== "string" ||
      !UUID_RE.test(body.playerId)
    ) {
      sendJson(res, 400, {
        error: "invalid-reset",
        detail: "playerId must be a UUID string",
      });
      return;
    }
    const nowMs = clock();
    const result = await store.resetPlayer(body.playerId, nowMs);
    if (result.status === "unknown-player") {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      playerId: body.playerId,
      savedAt: iso(result.savedAtMs),
      state: result.state,
    });
  }

  async function handleLoad(req, res, url) {
    const playerId = url.searchParams.get("playerId");
    if (!playerId || !UUID_RE.test(playerId)) {
      sendJson(res, 400, { error: "invalid-player-id" });
      return;
    }
    const snapshot = await store.get(playerId);
    if (!snapshot) {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    sendJson(res, 200, snapshotBody(snapshot));
  }

  /**
   * Leaderboard (issue #29): GET /api/leaderboard?sort=lifetime|current|cash.
   * Public read — no auth. Returns the top 10 accounts only, ranked by
   * the requested sort (default lifetime LOC). The response carries
   * rank, display name, and the three score fields — never a save or
   * an email. Unknown sort values fall back to lifetime.
   */
  async function handleLeaderboard(req, res, url) {
    const sort = normalizeLeaderboardSort(
      url.searchParams.get("sort") ?? "lifetime"
    );
    const entries = await store.getLeaderboard(sort, 10);
    sendJson(res, 200, { sort, entries });
  }

  /**
   * Next star (issue #29): GET /api/star/next?playerId=... — when the
   * player's next golden star may spawn. The server rolls the time
   * (see getOrRollNextStarAt); the client schedules the star from
   * `secondsUntilStar` (a duration, so client/server clock skew cannot
   * shift it) and shows a countdown only when `countdownUnlocked` is
   * true. The response also carries the StarBroker buy status
   * (starBrokerLevel, buyCooldownSecondsRemaining, buyCost) for the
   * Buy Star button. 400 for a malformed id, 404 for an unknown player.
   */
  async function handleStarNext(req, res, url) {
    const playerId = url.searchParams.get("playerId");
    if (!playerId || !UUID_RE.test(playerId)) {
      sendJson(res, 400, { error: "invalid-player-id" });
      return;
    }
    const nowMs = clock();
    const result = await store.getOrRollNextStarAt(playerId, nowMs);
    if (!result) {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    const secondsUntilStar =
      result.nextStarAtMs === null
        ? null
        : Math.max(0, Math.ceil((result.nextStarAtMs - nowMs) / 1000));
    sendJson(res, 200, {
      nextStarAtMs: result.nextStarAtMs,
      secondsUntilStar,
      constellationLevel: result.constellationLevel,
      countdownUnlocked: result.countdownUnlocked,
      starBrokerLevel: result.starBrokerLevel,
      buyCooldownSecondsRemaining: result.buyCooldownSecondsRemaining,
      buyCost: result.buyCost,
    });
  }

  /**
   * Claim the due star (issue #29): POST /api/star/claim, body
   * `{ playerId }`. The server rolls the outcome, records it as an
   * issued outcome, and rolls the next spawn time — all atomically
   * (see store.claimStar). The client applies exactly the returned
   * claim and reports it in the next save; the save is only valid if
   * the claim matches the issued outcome. 400 for a malformed body,
   * 404 for an unknown player, 409 when there are no stars (level 0)
   * or no star is due yet.
   */
  async function handleStarClaim(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err.code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body-too-large" });
        return;
      }
      sendJson(res, 400, { error: "invalid-json" });
      return;
    }
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.playerId !== "string" ||
      !UUID_RE.test(body.playerId)
    ) {
      sendJson(res, 400, {
        error: "invalid-star-claim",
        detail: "playerId must be a UUID string",
      });
      return;
    }
    const nowMs = clock();
    const result = await store.claimStar(body.playerId, nowMs);
    if (result.status === "unknown-player") {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    if (result.status === "no-stars") {
      sendJson(res, 409, {
        error: "no-stars",
        detail: "Constellation level 0 has no golden stars",
      });
      return;
    }
    if (result.status === "not-due") {
      sendJson(res, 409, {
        error: "star-not-due",
        detail: result.expired
          ? "the golden star already burned out — re-fetch for the next one"
          : "no golden star is due yet",
        nextStarAtMs: result.nextStarAtMs,
      });
      return;
    }
    const secondsUntilStar = Math.max(
      0,
      Math.ceil((result.nextStarAtMs - nowMs) / 1000)
    );
    sendJson(res, 200, {
      claim: result.claim,
      nextStarAtMs: result.nextStarAtMs,
      secondsUntilStar,
    });
  }

  /**
   * Buy a golden star (StarBroker): POST /api/star/buy, body
   * `{ playerId }`. The server validates the StarBroker level, the
   * buy cooldown, and affordability against the stored state, deducts
   * the cost (30x passive LOC/s) from the stored state's LOC, and
   * records a pending bought star — without touching the natural star
   * timer, so the bought star stacks with a natural one. The outcome
   * is rolled when the bought star is clicked (claim-bought), not
   * here. 400 for a malformed body, 404 for an unknown player,
   * 409 when the player owns no StarBroker, has no Constellation
   * levels, is still on cooldown, or cannot afford the cost.
   */
  async function handleStarBuy(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err.code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body-too-large" });
        return;
      }
      sendJson(res, 400, { error: "invalid-json" });
      return;
    }
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.playerId !== "string" ||
      !UUID_RE.test(body.playerId)
    ) {
      sendJson(res, 400, {
        error: "invalid-star-buy",
        detail: "playerId must be a UUID string",
      });
      return;
    }
    const nowMs = clock();
    const result = await store.buyStar(body.playerId, nowMs);
    if (result.status === "unknown-player") {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    if (result.status === "no-star-broker") {
      sendJson(res, 409, {
        error: "no-star-broker",
        detail: "StarBroker level 0 cannot buy stars",
      });
      return;
    }
    if (result.status === "no-stars") {
      sendJson(res, 409, {
        error: "no-stars",
        detail: "Constellation level 0 has no golden stars",
      });
      return;
    }
    if (result.status === "on-cooldown") {
      sendJson(res, 409, {
        error: "star-buy-cooldown",
        detail: "a star was bought too recently",
        nextBuyAtMs: result.nextBuyAtMs,
        cooldownSecondsRemaining: result.cooldownSecondsRemaining,
      });
      return;
    }
    if (result.status === "not-enough-loc") {
      sendJson(res, 409, {
        error: "not-enough-loc",
        detail: "not enough LOC to buy a star",
        cost: result.cost,
        linesOfCode: result.linesOfCode,
      });
      return;
    }
    sendJson(res, 200, {
      cost: result.cost,
      linesOfCode: result.linesOfCode,
      nextBuyAtMs: result.nextBuyAtMs,
      boughtStarAtMs: result.boughtStarAtMs,
      starBrokerLevel: result.starBrokerLevel,
      buyCooldownSeconds: result.buyCooldownSeconds,
    });
  }

  /**
   * Claim a bought golden star (StarBroker): POST /api/star/claim-bought,
   * body `{ playerId }`. The server rolls the outcome from the stored
   * state, records it as an issued outcome, and clears the pending
   * bought star — the natural star timer is never touched. The client
   * applies exactly the returned claim (same as a natural claim) and
   * reports it in the next save. 400 for a malformed body, 404 for an
   * unknown player, 409 when there is no pending bought star, no
   * Constellation levels, or the bought star already burned out.
   */
  async function handleClaimBoughtStar(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err.code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body-too-large" });
        return;
      }
      sendJson(res, 400, { error: "invalid-json" });
      return;
    }
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.playerId !== "string" ||
      !UUID_RE.test(body.playerId)
    ) {
      sendJson(res, 400, {
        error: "invalid-star-claim",
        detail: "playerId must be a UUID string",
      });
      return;
    }
    const nowMs = clock();
    const result = await store.claimBoughtStar(body.playerId, nowMs);
    if (result.status === "unknown-player") {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    if (result.status === "no-stars") {
      sendJson(res, 409, {
        error: "no-stars",
        detail: "Constellation level 0 has no golden stars",
      });
      return;
    }
    if (result.status === "no-bought-star") {
      sendJson(res, 409, {
        error: "no-bought-star",
        detail: "no bought star is pending",
      });
      return;
    }
    if (result.status === "not-due") {
      sendJson(res, 409, {
        error: "star-not-due",
        detail: "the bought star already burned out — buy another one",
      });
      return;
    }
    sendJson(res, 200, { claim: result.claim });
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    applyCors(req, res);
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
      } else if (req.method === "POST" && url.pathname === "/api/player") {
        const snapshot = await store.createPlayer(clock());
        sendJson(res, 201, snapshotBody(snapshot));
      } else if (req.method === "GET" && url.pathname === "/api/load") {
        await handleLoad(req, res, url);
      } else if (req.method === "POST" && url.pathname === "/api/save") {
        await handleSave(req, res);
      } else if (req.method === "POST" && url.pathname === "/api/save/reset") {
        await handleResetSave(req, res);
      } else if (req.method === "GET" && url.pathname === "/api/leaderboard") {
        await handleLeaderboard(req, res, url);
      } else if (req.method === "GET" && url.pathname === "/api/star/next") {
        await handleStarNext(req, res, url);
      } else if (req.method === "POST" && url.pathname === "/api/star/claim") {
        await handleStarClaim(req, res);
      } else if (req.method === "POST" && url.pathname === "/api/star/buy") {
        await handleStarBuy(req, res);
      } else if (req.method === "POST" && url.pathname === "/api/star/claim-bought") {
        await handleClaimBoughtStar(req, res);
      } else if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
      } else if (url.pathname === "/api/account/link" && req.method === "POST") {
        await handleLink(req, res);
      } else if (url.pathname === "/api/account/link" && req.method === "GET") {
        await handleGetLink(req, res);
      } else if (url.pathname === "/api/account/unlink" && req.method === "POST") {
        await handleUnlink(req, res);
      } else if (req.method === "POST" && url.pathname === "/api/admin/seed-test-player") {
        await handleAdminSeed(req, res);
      } else if (req.method === "GET" && url.pathname.startsWith("/api/admin/player/")) {
        // /api/admin/player/:playerId — one segment after the prefix;
        // anything deeper is not a player route.
        const playerId = url.pathname.slice("/api/admin/player/".length);
        if (playerId.includes("/")) {
          sendJson(res, 404, { error: "not-found" });
        } else {
          await handleAdminPlayer(req, res, playerId);
        }
      } else if (req.method === "GET" && url.pathname === "/api/admin/rejected-saves") {
        await handleAdminRejectedSaves(req, res, url);
      } else if (req.method === "GET" && url.pathname === "/api/admin/stats") {
        await handleAdminStats(req, res);
      } else if (url.pathname.startsWith("/api/auth/") && authHandler) {
        // Better Auth owns everything under /api/auth/* (sign-up,
        // sign-in, sign-out, session...). It reads the raw body itself,
        // so this branch runs before any body parsing above.
        await authHandler(req, res);
      } else {
        sendJson(res, 404, { error: "not-found" });
      }
    } catch (err) {
      console.error("request failed:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal-error" });
      } else {
        res.end();
      }
    } finally {
      console.log(
        `${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`
      );
    }
  });

  return server;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  const pool = new Pool({ connectionString: databaseUrl });
  const store = createStore(pool);
  await store.ensureSchema();
  const auth = createAuth(pool);
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    console.warn(
      "[admin] ADMIN_TOKEN is not set; /api/admin/* endpoints are disabled."
    );
  }
  const server = createServer(store, { auth, adminToken });
  server.listen(port, host, () => {
    console.log(`git-save-service listening on ${host}:${port}`);
  });
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
