# git-save-service

Server-authoritative save service for Get Rich Quick GIT (Slice 1).

The client sends a snapshot, not a trusted balance. The server holds the
last accepted snapshot and recomputes what is possible from it, so nobody
can edit a local save to a trillion dollars and top a leaderboard.

Spec: `save-schema-validation-spec.md` in the jellybean workspace, and
`shared/game-balance.js` for the single source of truth for every
balance number (imported by both the client and this server).

## Endpoints

- `POST /api/player` — mint an anonymous player id. Creates the row with
  the initial state, so the first save validates against it. Returns
  `201 { playerId, state, savedAt }`.
- `GET /api/load?playerId=...` — last accepted snapshot, or `404`
  `unknown-player`.
- `POST /api/save` — body `{ playerId, state, actionsSinceLastSave }`.
  Success: `200 { ok: true, savedAt, state }`. A save that fails
  validation: `409 { error: "save-rejected", rule, lastGoodState }` — the
  client discards its local state and loads `lastGoodState`. Malformed
  bodies are `400`; unknown players are `404`. A save within 30 seconds
  of the last accepted save is `429` with `Retry-After` — the client
  keeps its actions and retries on the next heartbeat.
- `GET /healthz` — liveness check for Coolify.
- `POST /api/admin/seed-test-player` — admin seed (issue #46): overwrite
  the ONE test player's saved state, bypassing save validation (it sets
  up a test fixture). Requires `Authorization: Bearer <ADMIN_TOKEN>`.
  The player must be linked to the test account (`jaybles@qcfailed.com`);
  any other player is `403 not-test-player`. Without `ADMIN_TOKEN`
  configured the endpoint answers `501 admin-not-configured`. Every
  call is audit-logged. No real player's save can be seeded.
- `GET /api/admin/player/:playerId` — admin read-only (issue #45): one
  player's current save state (`{ playerId, state, savedAt, createdAt }`).
  Requires `Authorization: Bearer <ADMIN_TOKEN>`. Read-only: it returns
  the snapshot and never modifies anything. Unlike the seed endpoint,
  this one MAY read a real player's save — that is its purpose
  (debugging a specific player's issue, by explicit playerId). There is
  no bulk/list-all-players endpoint. `400` for a malformed id, `404`
  for an unknown player, `501` when `ADMIN_TOKEN` is unset.
- `GET /api/admin/rejected-saves` — admin read-only (issue #45): recent
  rejected saves, most recent first, each `{ playerId, rule, detail,
  rejectedAt }`. Requires `Authorization: Bearer <ADMIN_TOKEN>`.
  `?limit=` caps the list (default 50, max 100). Sourced from an
  in-memory ring buffer (last 100 rejections, lost on restart) fed by
  the same rejection event the server logs to the console (PR #44) —
  the list and the log can never disagree. Read-only.
- `GET /api/admin/stats` — admin read-only (issue #45): aggregate
  counts only, never individual player data. Requires `Authorization:
  Bearer <ADMIN_TOKEN>`. Returns `playerCount`, `linkedAccounts`,
  `savesLastHour` / `savesLastDay` (players whose last accepted save is
  inside the last 1h / 24h — an activity proxy, not a save-event
  count), `rejectionsLastHour` / `rejectionsLastDay` (rejection events
  in the ring buffer inside the same windows), and `rejectionsStored`
  (ring buffer size). Read-only.

Admin guardrail, in one place: the seed endpoint is test-player-only;
the read-only endpoints are per-player debugging by explicit playerId
(read a real player's state to investigate their issue, never modify,
never bulk-list). All `/api/admin/*` calls are audit-logged (who/when,
never the token).

## Validation (nine rules)

Shape, rate limit (one accepted save per 30s), monotonicity, unlocks
recomputed from the snapshot, click cap (10/sec), LOC accounting
(tolerance `max(10, 1%)`), exact money accounting, action-delta
agreement, offline passive accrual capped at 8 hours. See `src/validate.js`
for the rules and the two deliberate deviations from the spec (new-rate
crediting, so legitimate mid-window upgrades never false-reject; and
400/429 instead of 409 for shape and rate-limit failures).

## Run it

Requires `DATABASE_URL` (Postgres). One table, `git_saves`, created
automatically on startup.

```sh
cd server
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/git npm start
```

## Test

```sh
cd server
npm test
```

Tests use `node:test` and an in-memory Postgres (pg-mem) running the
exact same SQL as production — no local Postgres needed.

## Deploy

GitHub Actions builds the image on every PR touching `server/`,
`shared/`, or `client/`, and pushes it to
`ghcr.io/bdubdesigns/git-rich-quick-save` on merge to master. Coolify on
the Hetzner box runs it as a Docker Image resource with a separate
Coolify-managed Postgres (own database, not RuneSpace's). Env vars in
Coolify: `DATABASE_URL`, `PORT`, `ADMIN_TOKEN` (bearer token for the
`/api/admin/*` endpoints; also kept in jellybean's Secure Vault — never
in the repo). The client stays on Vercel; only its API base URL changes,
in a later slice.
