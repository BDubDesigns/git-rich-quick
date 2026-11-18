/**
 * Get Rich Quick GIT — save service HTTP server (Slice 1 + Slice 3).
 *
 * Plain Node `http`, no framework. Endpoints:
 * - POST /api/player — mint an anonymous player id (uuid-v4)
 * - GET  /api/load?playerId=... — last accepted snapshot, or 404
 * - POST /api/save — validate and store a save (see validate.js)
 * - POST /api/save/reset — reset a player's progress (Danger Zone):
 *   overwrite their own save row with the fresh initial state. A normal
 *   save can never go backwards (the money rule is exact), so the reset
 *   has its own path; it only ever touches the requesting player's own row.
 * - POST /api/save/sell — Sell the Company (prestige, Slice 1): claim
 *   Equity from the player's lifetime LOC and atomically reset the
 *   company, from the client's freshest pre-sale state. Idempotent by
 *   saleId: a retried sale returns the already-applied state without
 *   claiming again. Not rate limited. See store.applySale.
 * - POST /api/save/store/buy — permanent store (prestige, Slice 2):
 *   buy the next rank of one store track during the post-sale
 *   intermission, from the client's freshest state. Idempotent by
 *   rank: a retried purchase returns the already-owned state without
 *   charging again. Not rate limited. See store.applyStoreBuy.
 * - POST /api/save/intermission/complete — post-sale intermission
 *   (prestige, Slice 2): apply the Starting Capital grant once, from
 *   the frozen sale quote, and clear the intermission. A retried
 *   completion returns the already-completed state without granting
 *   again. Not rate limited. See store.completeIntermission.
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
 * - GET  /api/load settles Night Shift (issue #149): offline LOC from
 *   the server clock and the stored state, once per absence, reported
 *   in the response's `nightShift` field.
 * - GET  /api/admin/player/:playerId/metrics: admin read-only
 *   telemetry (issue #152): the player's sampled click / passive
 *   snapshots (?from, ?to, ?limit). Bearer token required.
 * - GET  /api/admin/rejected-saves — admin read-only (issue #45): recent
 *   rejected saves (rule, detail, playerId, timestamp) from an
 *   in-memory ring buffer fed by the PR #44 rejection logging.
 * - GET  /api/admin/stats — admin read-only (issue #45): aggregate
 *   counts (players, linked accounts, recent save/rejection activity).
 *   All /api/admin/* endpoints share the bearer-token auth (ADMIN_TOKEN)
 *   and audit logging; see admin.js for the guardrail distinction
 *   (seed is test-player-only, read-only endpoints are per-player
 *   debugging by explicit playerId).
 * - POST /api/admin/prune-inactive-saves — admin prune (issue #25):
 *   delete guest rows whose last save is older than the 3-month
 *   inactivity window. Bearer token required, audit-logged. Body
 *   `{ dryRun?: boolean }`, default true: a dry run reports what
 *   WOULD be deleted and deletes nothing; only an explicit
 *   `{ "dryRun": false }` deletes. Account-linked rows are never
 *   touched. The same job also runs on a daily in-process schedule
 *   (see prune.js); this endpoint is the manual trigger and the safe
 *   way to verify before the first live run.
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
 * Prune (issue #25): PRUNE_INACTIVITY_DAYS (default 90), PRUNE_INTERVAL_MS
 * (default 24h), PRUNE_INITIAL_DELAY_MS (default 1h), PRUNE_DRY_RUN
 * ("true" runs the scheduled job in dry-run/log-only mode; default live).
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
import {
  GUEST_PRUNE_INACTIVITY_DAYS,
  PRUNE_INITIAL_DELAY_MS,
  PRUNE_INTERVAL_MS,
  pruneInactiveGuestSaves,
  startPruneScheduler,
} from "./prune.js";
import { SAVE_RATE_LIMIT_SECONDS, validateSeedState } from "./validate.js";
import {
  LEGACY_METRICS_REASONS,
  METRICS_REASONS,
  METRICS_SAMPLING,
  parseTimeParam,
} from "./metrics.js";
import { TEST_ACCOUNT_EMAIL, isAdminAuthorized } from "./admin.js";

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
   * Admin read-only telemetry (issue #152): GET
   * /api/admin/player/:playerId/metrics, one player's progress
   * snapshots, oldest first. Each entry is the capture time, the
   * sampling reason ("save" or "sale"; "first" / "hourly" on rows from
   * before issue #159), the healthy passive
   * LOC/s, the click LOC/s at 10 clicks/s (both without star buffs),
   * their ratio, and the progress at that moment. Optional `from` /
   * `to` (ISO date or ms since the epoch, inclusive) and `limit`
   * (default 1000, max 5000). Same bearer ADMIN_TOKEN as the other
   * admin endpoints, audit-logged. No PII: game numbers only.
   */
  async function handleAdminPlayerMetrics(req, res, url, playerId) {
    if (!requireAdmin(req, res, "player-metrics")) return;
    if (!UUID_RE.test(playerId)) {
      sendJson(res, 400, { error: "invalid-player-id" });
      return;
    }
    const fromMs = parseTimeParam(url.searchParams.get("from"));
    const untilMs = parseTimeParam(url.searchParams.get("to"));
    if (Number.isNaN(fromMs) || Number.isNaN(untilMs)) {
      sendJson(res, 400, { error: "invalid-time-range" });
      return;
    }
    const parsedLimit = Number.parseInt(
      url.searchParams.get("limit") ?? String(METRICS_SAMPLING.defaultLimit),
      10
    );
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(METRICS_SAMPLING.maxLimit, Math.max(1, parsedLimit))
      : METRICS_SAMPLING.defaultLimit;
    const snapshot = await store.get(playerId);
    if (!snapshot) {
      auditAdmin("player-metrics", { status: "unknown-player", playerId });
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    const rows = await store.listMetricsSnapshots(playerId, {
      fromMs,
      untilMs,
      limit,
    });
    const series = rows.map((row) => ({
      capturedAt: iso(row.capturedAtMs),
      reason: row.reason,
      passiveLocPerSec: row.passiveLocPerSec,
      clickLocPerSecAt10cps: row.clickLocPerSecAt10cps,
      clickToPassiveRatio:
        row.passiveLocPerSec > 0
          ? row.clickLocPerSecAt10cps / row.passiveLocPerSec
          : null,
      progress: row.progress,
    }));
    auditAdmin("player-metrics", { status: "ok", playerId, count: series.length });
    sendJson(res, 200, {
      playerId,
      from: fromMs === null ? null : iso(fromMs),
      to: untilMs === null ? null : iso(untilMs),
      count: series.length,
      sampling: {
        rule: METRICS_SAMPLING.rule,
        clicksPerSecond: METRICS_SAMPLING.clicksPerSecond,
        reasons: [...METRICS_REASONS],
        legacyReasons: [...LEGACY_METRICS_REASONS],
      },
      series,
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

  /**
   * Admin prune (issue #25): POST /api/admin/prune-inactive-saves —
   * delete guest rows whose last save is older than the 3-month
   * inactivity window. Bearer token required, audit-logged. Body
   * `{ dryRun?: boolean }`; when omitted or empty the run is a DRY
   * RUN (reports what would be deleted, deletes nothing) — only an
   * explicit `{ "dryRun": false }` deletes. Account-linked rows are
   * never touched (enforced in the store query). 400 for a malformed
   * body or a non-boolean dryRun.
   */
  async function handleAdminPrune(req, res) {
    if (!requireAdmin(req, res, "prune-inactive-saves")) return;
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
    if (body === null) body = {};
    if (
      typeof body !== "object" ||
      Array.isArray(body) ||
      (body.dryRun !== undefined && typeof body.dryRun !== "boolean")
    ) {
      sendJson(res, 400, {
        error: "invalid-prune",
        detail: "body must be an object with optional boolean dryRun",
      });
      return;
    }
    const dryRun = body.dryRun ?? true;
    const result = await pruneInactiveGuestSaves(store, {
      nowMs: clock(),
      dryRun,
    });
    auditAdmin("prune-inactive-saves", {
      status: "ok",
      dryRun,
      cutoff: iso(result.cutoffMs),
      ...(dryRun
        ? { wouldDelete: result.wouldDelete }
        : { deleted: result.deleted }),
    });
    sendJson(res, 200, {
      ok: true,
      dryRun,
      cutoff: iso(result.cutoffMs),
      ...(dryRun
        ? { wouldDelete: result.wouldDelete }
        : { deleted: result.deleted }),
      playerIds: result.playerIds,
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
   * player's own save row with the fresh initial state — the
   * player keeps the same playerId and the same account link; only
   * the progress goes to 0. A normal save can never do this (monotonicity
   * forbids progress going backwards), so the reset bypasses validateSave
   * on its own path. It is NOT rate
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

  /**
   * Sell the Company (prestige, Slice 1): POST /api/save/sell, body
   * `{ playerId, saleId, state, actionsSinceLastSave }`. `state` is
   * the client's freshest PRE-sale state (the sale settles production
   * up to the sale from its lifetime LOC); `saleId` is the client's
   * idempotency key for this sale. The server validates the pre-sale
   * state as an ordinary successor of the stored state, claims the
   * Equity, and atomically resets the company (see store.applySale).
   * A retried sale (same saleId) returns the already-applied state
   * without claiming again. 400 for a malformed body, 404 for an
   * unknown player, 409 with the last good state when the sale is
   * not claimable (no new Equity, or the Equity books disagree).
   * Like the reset endpoint, it is NOT rate limited: a player who
   * just saved can still sell. The playerId is the credential here,
   * the same as /api/save — the endpoint can only ever touch the row
   * matching the given playerId.
   */
  async function handleSellCompany(req, res) {
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
      typeof body.saleId !== "string" ||
      !UUID_RE.test(body.saleId) ||
      body.state === null ||
      typeof body.state !== "object" ||
      Array.isArray(body.state) ||
      body.actionsSinceLastSave === null ||
      typeof body.actionsSinceLastSave !== "object" ||
      Array.isArray(body.actionsSinceLastSave)
    ) {
      sendJson(res, 400, {
        error: "invalid-sell",
        detail:
          "playerId and saleId must be UUID strings, state and actionsSinceLastSave must be objects",
      });
      return;
    }
    const nowMs = clock();
    const result = await store.applySale(body.playerId, body, nowMs);
    if (result.status === "unknown-player") {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    if (result.status === "rejected") {
      console.warn(
        "[save] rejected sale",
        JSON.stringify({
          playerId: body.playerId,
          saleId: body.saleId,
          rule: result.rule,
          detail: result.detail,
          prevSavedAtMs: result.lastGood?.savedAtMs ?? null,
          state: body.state,
        })
      );
      sendJson(res, 409, {
        error: "sale-rejected",
        rule: result.rule,
        detail: result.detail,
        lastGoodState: snapshotBody(result.lastGood),
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      alreadyApplied: result.status === "already-applied",
      playerId: body.playerId,
      savedAt: iso(result.savedAtMs),
      state: result.state,
      sale: result.sale,
    });
  }

  /**
   * Permanent store (prestige, Slice 2): POST /api/save/store/buy,
   * body `{ playerId, storeId, rank, state, actionsSinceLastSave }`.
   * `rank` is the rank being bought (always the next rank after the
   * one owned); `state` is the client's freshest state, which must
   * still carry the open intermission. The server validates the
   * purchase (rank order, funds) and applies it atomically (see
   * store.applyStoreBuy). A retried purchase returns the
   * already-owned state without charging again. 400 for a malformed
   * body, 404 for an unknown player, 409 with the last good state
   * when the purchase is not valid (no intermission, wrong rank
   * order, insufficient Equity). Like the sale, it is NOT rate
   * limited: a player who just saved can still buy. The playerId is
   * the credential here, the same as /api/save.
   */
  async function handleStoreBuy(req, res) {
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
      typeof body.storeId !== "string" ||
      !Number.isInteger(body.rank) ||
      body.state === null ||
      typeof body.state !== "object" ||
      Array.isArray(body.state) ||
      body.actionsSinceLastSave === null ||
      typeof body.actionsSinceLastSave !== "object" ||
      Array.isArray(body.actionsSinceLastSave)
    ) {
      sendJson(res, 400, {
        error: "invalid-store-buy",
        detail:
          "playerId must be a UUID string, storeId a string, rank an integer, state and actionsSinceLastSave must be objects",
      });
      return;
    }
    const nowMs = clock();
    const result = await store.applyStoreBuy(body.playerId, body, nowMs);
    if (result.status === "unknown-player") {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    if (result.status === "rejected") {
      console.warn(
        "[save] rejected store buy",
        JSON.stringify({
          playerId: body.playerId,
          storeId: body.storeId,
          rank: body.rank,
          rule: result.rule,
          detail: result.detail,
          prevSavedAtMs: result.lastGood?.savedAtMs ?? null,
          state: body.state,
        })
      );
      sendJson(res, 409, {
        error: "store-buy-rejected",
        rule: result.rule,
        detail: result.detail,
        lastGoodState: snapshotBody(result.lastGood),
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      alreadyOwned: result.status === "already-owned",
      playerId: body.playerId,
      savedAt: iso(result.savedAtMs),
      state: result.state,
      purchase: result.purchase,
    });
  }

  /**
   * Complete the post-sale intermission (prestige, Slice 2): POST
   * /api/save/intermission/complete, body `{ playerId, state,
   * actionsSinceLastSave }`. The server applies the Starting Capital
   * grant once, from the frozen quote, and clears the intermission
   * (see store.completeIntermission). A retried completion returns
   * the already-completed state without granting again. 400 for a
   * malformed body, 404 for an unknown player, 409 with the last
   * good state when the completion is not valid. Not rate limited,
   * like the sale and the store buy.
   */
  async function handleCompleteIntermission(req, res) {
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
      Array.isArray(body.state) ||
      body.actionsSinceLastSave === null ||
      typeof body.actionsSinceLastSave !== "object" ||
      Array.isArray(body.actionsSinceLastSave)
    ) {
      sendJson(res, 400, {
        error: "invalid-intermission-complete",
        detail:
          "playerId must be a UUID string, state and actionsSinceLastSave must be objects",
      });
      return;
    }
    const nowMs = clock();
    const result = await store.completeIntermission(
      body.playerId,
      body,
      nowMs
    );
    if (result.status === "unknown-player") {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    if (result.status === "rejected") {
      console.warn(
        "[save] rejected intermission completion",
        JSON.stringify({
          playerId: body.playerId,
          rule: result.rule,
          detail: result.detail,
          prevSavedAtMs: result.lastGood?.savedAtMs ?? null,
          state: body.state,
        })
      );
      sendJson(res, 409, {
        error: "intermission-complete-rejected",
        rule: result.rule,
        detail: result.detail,
        lastGoodState: snapshotBody(result.lastGood),
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      alreadyCompleted: result.status === "already-completed",
      playerId: body.playerId,
      savedAt: iso(result.savedAtMs),
      state: result.state,
      grant: result.grant,
    });
  }

  async function handleLoad(req, res, url) {
    const playerId = url.searchParams.get("playerId");
    if (!playerId || !UUID_RE.test(playerId)) {
      sendJson(res, 400, { error: "invalid-player-id" });
      return;
    }
    // Night Shift (issue #149): the load settles offline production
    // with the server clock, in a row-locked transaction (see
    // store.loadAndSettle). `nightShift` is the one-time report, or
    // null when nothing was credited.
    const snapshot = await store.loadAndSettle(playerId, clock());
    if (!snapshot) {
      sendJson(res, 404, { error: "unknown-player" });
      return;
    }
    sendJson(res, 200, {
      ...snapshotBody(snapshot),
      nightShift: snapshot.nightShift ?? null,
    });
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
      } else if (req.method === "POST" && url.pathname === "/api/save/sell") {
        await handleSellCompany(req, res);
      } else if (
        req.method === "POST" &&
        url.pathname === "/api/save/store/buy"
      ) {
        await handleStoreBuy(req, res);
      } else if (
        req.method === "POST" &&
        url.pathname === "/api/save/intermission/complete"
      ) {
        await handleCompleteIntermission(req, res);
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
        // /api/admin/player/:playerId/metrics is the telemetry series
        // (issue #152); anything else deeper is not a player route.
        const rest = url.pathname.slice("/api/admin/player/".length);
        const parts = rest.split("/");
        if (parts.length === 2 && parts[1] === "metrics") {
          await handleAdminPlayerMetrics(req, res, url, parts[0]);
        } else if (parts.length !== 1) {
          sendJson(res, 404, { error: "not-found" });
        } else {
          await handleAdminPlayer(req, res, rest);
        }
      } else if (req.method === "GET" && url.pathname === "/api/admin/rejected-saves") {
        await handleAdminRejectedSaves(req, res, url);
      } else if (req.method === "GET" && url.pathname === "/api/admin/stats") {
        await handleAdminStats(req, res);
      } else if (req.method === "POST" && url.pathname === "/api/admin/prune-inactive-saves") {
        await handleAdminPrune(req, res);
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

/**
 * Read an integer env var, falling back (with a warning) when it is
 * unset, blank, or not a positive number. Prune tuning only: a bad
 * value must never stop the server from starting.
 */
function pruneEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[prune] ignoring invalid ${name}=${JSON.stringify(raw)}, using ${fallback}`
    );
    return fallback;
  }
  return parsed;
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
  // Background prune (issue #25): in-process daily job, first run an
  // hour after boot, then every PRUNE_INTERVAL_MS. Guest rows only,
  // 3 months of inactivity by default; account-linked rows are never
  // touched. PRUNE_DRY_RUN=true runs it in log-only mode (reports
  // what would be deleted, deletes nothing) for safe verification.
  const inactivityDays = pruneEnvInt(
    "PRUNE_INACTIVITY_DAYS",
    GUEST_PRUNE_INACTIVITY_DAYS
  );
  const pruneScheduler = startPruneScheduler(store, {
    inactivityMs: inactivityDays * 24 * 60 * 60 * 1000,
    intervalMs: pruneEnvInt("PRUNE_INTERVAL_MS", PRUNE_INTERVAL_MS),
    initialDelayMs: pruneEnvInt(
      "PRUNE_INITIAL_DELAY_MS",
      PRUNE_INITIAL_DELAY_MS
    ),
    dryRun: process.env.PRUNE_DRY_RUN === "true",
  });
  console.log(
    `[prune] scheduled cleanup: guest rows inactive ${inactivityDays} days, ` +
      `first run in ${PRUNE_INITIAL_DELAY_MS / 3600000}h then every ` +
      `${PRUNE_INTERVAL_MS / 3600000}h` +
      (process.env.PRUNE_DRY_RUN === "true" ? " (dry-run mode)" : "") +
      `; manual trigger POST /api/admin/prune-inactive-saves`
  );
  // Keep the scheduler handle reachable for a graceful shutdown hook
  // if one is ever added; today the unref'd timers never hold the
  // process open on their own.
  void pruneScheduler;
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
