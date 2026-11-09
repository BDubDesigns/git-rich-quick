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
Coolify: `DATABASE_URL`, `PORT`. The client stays on Vercel; only its
API base URL changes, in a later slice.
