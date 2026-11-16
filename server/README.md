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
- `POST /api/save/sell` — Sell the Company (prestige, Slice 1): body
  `{ playerId, state, actionsSinceLastSave, saleId }`, where `state` is
  the client's freshest pre-sale snapshot and `saleId` is a fresh
  uuid-v4 per sale attempt. The server validates the pre-sale state as
  an ordinary successor of the stored state (same trust boundary as a
  normal save, minus the rate limit), claims the Equity the lifetime
  LOC entitles, and stores the post-sale state atomically in one
  transaction under a row lock. Success: `200 { ok, alreadyApplied,
  playerId, savedAt, state, sale }` where `sale` is `{ gainedEquity,
  lifetimeEquityEarned, founderMultiplierBefore, founderMultiplierAfter,
  saleCount }`. A retry with the same `saleId` returns the already
  applied post-sale state with `alreadyApplied: true` and no second
  claim. A sale with no new Equity is `409 { error: "sale-rejected",
  rule: "SALE", lastGoodState }`. Malformed bodies are `400`; unknown
  players are `404`. Normal saves cannot move the Equity books:
  lowering `lifetimeEquityEarned` / `equitySpent` / `saleCount`, spending
  more Equity than earned, or changing `lifetimeLocAtLastSale` /
  `lastSaleId` outside a sale are rejected (`MONOTONIC` / `PRESTIGE`).
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
- `POST /api/admin/prune-inactive-saves` — admin prune (issue #25):
  delete guest rows whose last save is older than the 3-month
  inactivity window. Requires `Authorization: Bearer <ADMIN_TOKEN>`.
  Body `{ dryRun?: boolean }`, default **true**: a dry run reports
  `{ wouldDelete, playerIds }` and deletes nothing; only an explicit
  `{ "dryRun": false }` deletes. Account-linked rows are never
  touched, however old they are. Every run is audit-logged and writes
  one `[prune]` log line (cutoff, count, sample playerIds). This is
  also the safe way to verify against live data before the first real
  run: call it with no body (or `{ "dryRun": true }`) and check
  `wouldDelete` first.

Admin guardrail, in one place: the seed endpoint is test-player-only;
the read-only endpoints are per-player debugging by explicit playerId
(read a real player's state to investigate their issue, never modify,
never bulk-list). All `/api/admin/*` calls are audit-logged (who/when,
never the token).

## Validation (nine rules)

Shape, rate limit (one accepted save per 30s), monotonicity, unlocks
recomputed from the snapshot, click cap (10/sec), LOC accounting
(tolerance `max(10, 1%)`), exact money accounting, action-delta
agreement, offline passive accrual capped at 8 hours, plus the
prestige guards (Equity books are monotonic, spending can never exceed
lifetime Equity earned, and `lifetimeLocAtLastSale` / `lastSaleId`
change only on a sale — see `POST /api/save/sell` above). See `src/validate.js`
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

## Prune (issue #25)

A background job deletes guest saves inactive for 3 months
(`PRUNE_INACTIVITY_DAYS`, default 90). It runs in-process: first run
one hour after boot (`PRUNE_INITIAL_DELAY_MS`, default 1h), then once
a day (`PRUNE_INTERVAL_MS`, default 24h). No new infrastructure, no
new dependency, no new cost. Only guest rows are ever deleted
(`user_id` unlinked); account-linked rows are never touched, however
old they are — their window is still undecided. The job never touches
the save/load path: it only DELETEs rows.

Verify safely before the first live run: `PRUNE_DRY_RUN=true` runs
the scheduled job in log-only mode (it reports what would be deleted
and deletes nothing), or call the admin endpoint with no body — it
defaults to a dry run. Every run writes one `[prune]` log line
(dry-run or live, cutoff, count, up to 100 sample playerIds). A failed
run is logged and never takes the server down.

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
