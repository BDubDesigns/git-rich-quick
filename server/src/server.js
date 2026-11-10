/**
 * Get Rich Quick GIT — save service HTTP server (Slice 1 + Slice 3).
 *
 * Plain Node `http`, no framework. Endpoints:
 * - POST /api/player — mint an anonymous player id (uuid-v4)
 * - GET  /api/load?playerId=... — last accepted snapshot, or 404
 * - POST /api/save — validate and store a save (see validate.js)
 * - GET  /healthz — liveness check for Coolify
 * - /api/auth/* — Better Auth (Slice 3, issue #28): sign-up, sign-in,
 *   sign-out, session. Mounted via toNodeHandler; see auth.js.
 * - POST /api/account/link — link a guest playerId to the signed-in
 *   account (Slice 3). GET /api/account/link reads the link.
 *   POST /api/account/unlink removes it.
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
 * URL, default http://localhost:3000). `clock` is injectable for tests;
 * production uses Date.now. `auth` is injectable for tests; production
 * builds it from the pool (see main()).
 */

import http from "node:http";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { toNodeHandler } from "better-auth/node";
import { createAuth } from "./auth.js";
import { createStore } from "./store.js";
import { SAVE_RATE_LIMIT_SECONDS } from "./validate.js";

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

export function createServer(store, { clock = Date.now, auth } = {}) {
  const authHandler = auth ? toNodeHandler(auth) : null;

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
      } else if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
      } else if (url.pathname === "/api/account/link" && req.method === "POST") {
        await handleLink(req, res);
      } else if (url.pathname === "/api/account/link" && req.method === "GET") {
        await handleGetLink(req, res);
      } else if (url.pathname === "/api/account/unlink" && req.method === "POST") {
        await handleUnlink(req, res);
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
  const server = createServer(store, { auth });
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
