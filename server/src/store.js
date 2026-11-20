/**
 * Get Rich Quick GIT — Postgres store for save snapshots (Slice 1).
 *
 * One table, `git_saves`, per the save spec. A row is created when a
 * player is minted (`POST /api/player`), holding the initial state, so the
 * first save validates against the initial snapshot with the window
 * starting at player creation — a player who plays a while before their
 * first save is not punished for it.
 *
 * `applySave` runs the whole save inside one transaction with a row lock
 * (`SELECT ... FOR UPDATE`), so two concurrent saves for one player cannot
 * both validate against the same stale snapshot and lose each other's
 * progress. Validation runs inside the transaction, against the locked row.
 *
 * The store takes a `pg` Pool (or any pool with the same interface — the
 * tests pass a pg-mem in-memory pool, running the exact same SQL).
 */

import { randomUUID } from "node:crypto";
import {
  applyPrestigeSale,
  availableEquity,
  completePrestigeIntermission,
  founderMultiplier,
  initialSaveState,
  normalizeSaveState,
  settleNightShift,
  wipedSaveState,
} from "../../shared/game-balance.js";
import { METRICS_SAMPLING, deriveMetricsSnapshot } from "./metrics.js";
import {
  validateCompleteIntermission,
  validatePrestigeSale,
  validateSave,
  validateStoreBuy,
} from "./validate.js";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS git_saves (
    player_id UUID PRIMARY KEY,
    schema_version INT NOT NULL DEFAULT 1,
    state JSONB NOT NULL,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

/**
 * Progress telemetry (issue #152): derived click / passive snapshots,
 * one per accepted save (issue #159) plus one per sale. Derived from
 * the save, never part of it. Rows go when their save row goes (the
 * guest prune deletes both). No PII: game numbers only.
 */
const CREATE_METRICS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS git_save_metrics (
    player_id UUID NOT NULL REFERENCES git_saves(player_id) ON DELETE CASCADE,
    captured_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    passive_loc_per_sec DOUBLE PRECISION NOT NULL,
    click_loc_per_sec_at_10cps DOUBLE PRECISION NOT NULL,
    progress JSONB NOT NULL,
    PRIMARY KEY (player_id, captured_at)
  )
`;

/**
 * Better Auth core tables (Slice 3, issue #28). This is Better Auth's
 * required core schema (user / session / account / verification); the auth
 * library owns all reads and writes to these tables. Embedded here to
 * match the existing ensureSchema() pattern (no separate migration step).
 * The SQL is the core schema from Better Auth's docs (camelCase columns);
 * a fresh install's `npx auth@latest generate` produces the same four
 * tables. We could not run the generator here — it needs a live Postgres
 * to validate, and this VM has none — so the tables are covered by the
 * auth tests below instead.
 */
const CREATE_AUTH_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "expiresAt" TIMESTAMP NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP,
    "refreshTokenExpiresAt" TIMESTAMP,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP,
    "updatedAt" TIMESTAMP
  );
`;

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

function rowToSnapshot(row) {
  return {
    playerId: row.player_id,
    state: row.state,
    savedAtMs: toMs(row.saved_at),
    createdAtMs: toMs(row.created_at),
  };
}

/**
 * Save schema version (issue #170, Funding Rounds). A row stored
 * under an older version is wiped to a fresh initialSaveState the
 * first time it is touched: the cube-root Equity curve, the 1.4x
 * tracks and the round caps make old-scale lifetime LOC, levels and
 * achievement peaks meaningless (Brandon confirmed the wipe; there is
 * no migration). Every row written from here on carries this version.
 * Bump it for the next deliberate wipe.
 *
 * Version 3 (issue #192, Bridge Rounds): Ship Happens joined the gated
 * tracks, so a save holding it above its new cap would fail the cap
 * check on its next save. Clamping would be migration code, so every
 * row below 3 is wiped the same way (Brandon approved the wipe).
 */
export const SAVE_SCHEMA_VERSION = 3;

/**
 * Lock a player's save row for the rest of the transaction
 * (`SELECT ... FOR UPDATE`) and wipe it when it predates
 * SAVE_SCHEMA_VERSION. Returns null for an unknown player, else
 * `{ snapshot, wiped }`: `wiped` is true when the row was reset in
 * this transaction (the snapshot is then the fresh state at nowMs).
 * The caller commits, so the wipe and whatever follows are atomic.
 */
async function lockSaveRow(client, playerId, nowMs) {
  const res = await client.query(
    `SELECT player_id, state, saved_at, created_at, schema_version
     FROM git_saves WHERE player_id = $1 FOR UPDATE`,
    [playerId]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  const version = Number(row.schema_version);
  if (Number.isFinite(version) && version >= SAVE_SCHEMA_VERSION) {
    return { snapshot: rowToSnapshot(row), wiped: false };
  }
  // Issue #172: the fresh inbox explains the reset (one unread mail,
  // fixed trigger key). Only this path adds it; a mint stays empty.
  const state = wipedSaveState(SAVE_SCHEMA_VERSION, {
    emailId: randomUUID(),
    nowMs,
  });
  await client.query(
    `UPDATE git_saves SET state = $1, saved_at = $2, schema_version = $3
     WHERE player_id = $4`,
    [
      JSON.stringify(state),
      new Date(nowMs).toISOString(),
      SAVE_SCHEMA_VERSION,
      playerId,
    ]
  );
  return {
    snapshot: {
      playerId: row.player_id,
      state,
      savedAtMs: nowMs,
      createdAtMs: toMs(row.created_at),
    },
    wiped: true,
  };
}

/** The rejection a write path returns when lockSaveRow just wiped the row. */
function wipedRejection(snapshot) {
  return {
    status: "rejected",
    rule: "WIPE",
    detail: `save predates schema ${SAVE_SCHEMA_VERSION} and was reset to a fresh company`,
    lastGood: snapshot,
  };
}

/**
 * Progress telemetry (issue #152): record a derived snapshot (see
 * store.recordMetricsSnapshot). A plain function so the save and sale
 * paths call it without relying on `this`.
 */
async function recordMetricsSnapshot(pool, playerId, state, nowMs, { sale = false } = {}) {
  try {
    // Issue #159: every accepted save records ("save"); a sale records
    // its pre-sale state ("sale"). No hourly gate any more.
    const reason = sale ? "sale" : "save";
    const snapshot = deriveMetricsSnapshot(state);
    await pool.query(
      `INSERT INTO git_save_metrics
         (player_id, captured_at, reason, passive_loc_per_sec,
          click_loc_per_sec_at_10cps, progress)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (player_id, captured_at) DO NOTHING`,
      [
        playerId,
        new Date(nowMs).toISOString(),
        reason,
        snapshot.passiveLocPerSec,
        snapshot.clickLocPerSecAt10cps,
        JSON.stringify(snapshot.progress),
      ]
    );
    return reason;
  } catch (err) {
    console.warn(
      `[metrics] snapshot failed for ${playerId}:`,
      err?.message ?? err
    );
    return null;
  }
}

export function createStore(pool) {
  return {
    async ensureSchema() {
      await pool.query(CREATE_TABLE_SQL);
      await pool.query(CREATE_AUTH_TABLES_SQL);
      // Link a guest save to a Better Auth account (Slice 3). One
      // account links to at most one guest playerId, and a playerId
      // links to at most one account (unique partial index below).
      await pool.query(`
        ALTER TABLE git_saves
          ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES "user"("id") ON DELETE SET NULL
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS git_saves_user_id_unique
          ON git_saves (user_id) WHERE user_id IS NOT NULL
      `);
      await pool.query(CREATE_METRICS_TABLE_SQL);
    },

    /**
     * Progress telemetry (issue #152): record a derived snapshot of
     * `state` for a player, best effort: "save" for an accepted save
     * (every one, issue #159), "sale" with `sale: true` (the pre-sale
     * state). Never throws: telemetry must not break a save (a failure
     * is logged and swallowed). Returns the reason recorded, or null.
     */
    async recordMetricsSnapshot(playerId, state, nowMs, options) {
      return recordMetricsSnapshot(pool, playerId, state, nowMs, options);
    },

    /**
     * Progress telemetry (issue #152): one player's snapshots, oldest
     * first, optionally bounded by `fromMs` / `untilMs` (inclusive, ms
     * since the epoch), capped at `limit` rows.
     */
    async listMetricsSnapshots(
      playerId,
      { fromMs = null, untilMs = null, limit = METRICS_SAMPLING.defaultLimit } = {}
    ) {
      const params = [playerId];
      const clauses = ["player_id = $1"];
      if (fromMs !== null) {
        params.push(new Date(fromMs).toISOString());
        clauses.push("captured_at >= $" + params.length);
      }
      if (untilMs !== null) {
        params.push(new Date(untilMs).toISOString());
        clauses.push("captured_at <= $" + params.length);
      }
      params.push(limit);
      const res = await pool.query(
        "SELECT captured_at, reason, passive_loc_per_sec, " +
          "click_loc_per_sec_at_10cps, progress FROM git_save_metrics " +
          "WHERE " + clauses.join(" AND ") +
          " ORDER BY captured_at ASC LIMIT $" + params.length,
        params
      );
      return res.rows.map((row) => ({
        capturedAtMs: toMs(row.captured_at),
        reason: row.reason,
        passiveLocPerSec: Number(row.passive_loc_per_sec),
        clickLocPerSecAt10cps: Number(row.click_loc_per_sec_at_10cps),
        progress:
          typeof row.progress === "string"
            ? JSON.parse(row.progress)
            : row.progress,
      }));
    },

    async close() {
      await pool.end();
    },

    /**
     * Mint an anonymous player and store their initial state.
     * Returns `{ playerId, state, savedAtMs, createdAtMs }`.
     */
    async createPlayer(nowMs) {
      const state = initialSaveState();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const playerId = randomUUID();
        try {
          await pool.query(
            `INSERT INTO git_saves (player_id, schema_version, state, saved_at, created_at)
             VALUES ($1, $4, $2, $3, $3)`,
            [
              playerId,
              JSON.stringify(state),
              new Date(nowMs).toISOString(),
              SAVE_SCHEMA_VERSION,
            ]
          );
          return { playerId, state, savedAtMs: nowMs, createdAtMs: nowMs };
        } catch (err) {
          // UUID collision (astronomically unlikely): mint a fresh one.
          if (err && err.code === "23505" && attempt === 0) continue;
          throw err;
        }
      }
      throw new Error("could not mint a unique player id");
    },

    /** Last accepted snapshot for a player, or null if unknown. */
    async get(playerId) {
      const res = await pool.query(
        `SELECT player_id, state, saved_at, created_at
         FROM git_saves WHERE player_id = $1`,
        [playerId]
      );
      if (res.rowCount === 0) return null;
      return rowToSnapshot(res.rows[0]);
    },

    /**
     * Load a save and settle Night Shift (issue #149), atomically. The
     * row is locked (`SELECT ... FOR UPDATE`) and the absence is
     * measured with the SERVER clock only: away = nowMs - saved_at (the
     * last accepted save). When settleNightShift credits anything (a
     * level of 1+, away >= 5 minutes, positive production), the credit
     * is added to the stored state and saved_at moves to nowMs in the
     * same transaction, so a second load right after finds nothing to
     * settle (idempotent), and the credit can never be counted twice.
     * P comes from the stored (already accepted) state, never the
     * client. The report mail is filed in the same stored state, so it
     * persists with the credit. Returns null for an unknown player,
     * else the snapshot plus `nightShift` (the report, or null when
     * nothing settled).
     */
    async loadAndSettle(playerId, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // A row from before the current save schema is wiped to a
        // fresh state in this same transaction (issue #170); a load
        // then simply returns the fresh company.
        const locked = await lockSaveRow(client, playerId, nowMs);
        if (!locked) {
          await client.query("ROLLBACK");
          return null;
        }
        const snapshot = locked.snapshot;
        const awaySeconds = (nowMs - snapshot.savedAtMs) / 1000;
        const settled = Number.isFinite(awaySeconds)
          ? settleNightShift(snapshot.state, awaySeconds, {
              nowMs,
              emailId: randomUUID(),
            })
          : null;
        if (!settled) {
          await client.query("COMMIT");
          return { ...snapshot, nightShift: null };
        }
        await client.query(
          `UPDATE git_saves SET state = $1, saved_at = $2 WHERE player_id = $3`,
          [
            JSON.stringify(settled.state),
            new Date(nowMs).toISOString(),
            playerId,
          ]
        );
        await client.query("COMMIT");
        return {
          ...snapshot,
          state: settled.state,
          savedAtMs: nowMs,
          nightShift: { ...settled.report, settledAt: new Date(nowMs).toISOString() },
        };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection is already broken; nothing to roll back.
        }
        throw err;
      } finally {
        client.release();
      }
    },

    /**
     * Link a guest save to a Better Auth account (Slice 3, issue #28).
     * One account links to at most one guest playerId, and a playerId
     * links to at most one account. Returns one of:
     * - `{ status: "ok", playerId }`
     * - `{ status: "unknown-player" }` (no save row for that playerId)
     * - `{ status: "conflict", reason: "player-linked" }` (playerId is
     *   already linked to a different account)
     * - `{ status: "conflict", reason: "user-linked" }` (account already
     *   links to a different playerId)
     * Linking the same playerId to the same account again is a no-op ok.
     */
    async linkPlayerToUser(playerId, userId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT player_id, user_id FROM git_saves WHERE player_id = $1 FOR UPDATE`,
          [playerId]
        );
        if (res.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        const existingUserId = res.rows[0].user_id;
        if (existingUserId && existingUserId !== userId) {
          await client.query("ROLLBACK");
          return { status: "conflict", reason: "player-linked" };
        }
        const other = await client.query(
          `SELECT player_id FROM git_saves WHERE user_id = $1 AND player_id <> $2`,
          [userId, playerId]
        );
        if (other.rowCount > 0) {
          await client.query("ROLLBACK");
          return { status: "conflict", reason: "user-linked" };
        }
        await client.query(
          `UPDATE git_saves SET user_id = $1 WHERE player_id = $2`,
          [userId, playerId]
        );
        await client.query("COMMIT");
        return { status: "ok", playerId };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection is already broken; nothing to roll back.
        }
        throw err;
      } finally {
        client.release();
      }
    },

    /** The playerId linked to an account, or null if none. */
    async getPlayerIdForUser(userId) {
      const res = await pool.query(
        `SELECT player_id FROM git_saves WHERE user_id = $1`,
        [userId]
      );
      if (res.rowCount === 0) return null;
      return res.rows[0].player_id;
    },

    /** Remove the link between a guest save and an account. */
    async unlinkPlayerFromUser(userId) {
      const res = await pool.query(
        `UPDATE git_saves SET user_id = NULL WHERE user_id = $1 RETURNING player_id`,
        [userId]
      );
      return res.rowCount > 0 ? res.rows[0].player_id : null;
    },

    /**
     * Admin stats (issue #45, read-only): aggregate counts for the
     * stats endpoint. `nowMs` is the (injected) current time.
     * - playerCount: rows in git_saves.
     * - linkedAccounts: rows linked to a Better Auth account.
     * - savesLastHour / savesLastDay: rows whose last accepted save is
     *   within the window (players who saved recently — an activity
     *   proxy, not a count of save events).
     * Date objects are passed for the window bounds (portable across
     * the real pg driver and pg-mem).
     */
    async getAdminStats(nowMs) {
      const res = await pool.query(
        `SELECT
           COUNT(*)::int AS "playerCount",
           COALESCE(SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS "linkedAccounts",
           COALESCE(SUM(CASE WHEN saved_at >= $1 THEN 1 ELSE 0 END), 0)::int AS "savesLastHour",
           COALESCE(SUM(CASE WHEN saved_at >= $2 THEN 1 ELSE 0 END), 0)::int AS "savesLastDay"
         FROM git_saves`,
        [new Date(nowMs - 60 * 60 * 1000), new Date(nowMs - 24 * 60 * 60 * 1000)]
      );
      const row = res.rows[0];
      return {
        playerCount: Number(row.playerCount),
        linkedAccounts: Number(row.linkedAccounts),
        savesLastHour: Number(row.savesLastHour),
        savesLastDay: Number(row.savesLastDay),
      };
    },


    /**
     * Prune inactive guest saves (issue #25): delete rows whose last
     * accepted save is before `cutoffMs` AND that are not linked to a
     * Better Auth account (`user_id IS NULL`). Account-linked rows are
     * NEVER touched by this method, however old they are — their window
     * is still undecided. The cutoff is strict (`saved_at < cutoff`):
     * a row saved exactly at the cutoff is kept.
     * - Live: deletes the rows and returns
     *   `{ deleted, wouldDelete: 0, playerIds }` (playerIds capped at
     *   100 for the log line; `deleted` is exact).
     * - Dry run (`{ dryRun: true }`): deletes nothing, returns
     *   `{ deleted: 0, wouldDelete, playerIds }` for the same rows.
     * The save/load path never calls this; only the background prune
     * job and the admin prune endpoint do.
     */
    async pruneInactiveGuests(cutoffMs, { dryRun = false } = {}) {
      const cutoff = new Date(cutoffMs);
      // Guest-only, enforced here: `NOT (user_id IS NOT NULL)` is
      // exactly `user_id IS NULL` in Postgres (IS NOT NULL is always
      // true/false, never NULL), written this way because pg-mem 2.9.0
      // returns no rows for `user_id IS NULL` on this foreign-key
      // column while `IS NOT NULL` works — verified by experiment, so
      // the guardrail stays test-verified instead of silently
      // untestable. Do not "simplify" this back to IS NULL without
      // re-running the prune tests: they would pass vacuously.
      const where = `FROM git_saves WHERE NOT (user_id IS NOT NULL) AND saved_at < $1`;
      if (dryRun) {
        const countRes = await pool.query(
          `SELECT COUNT(*)::int AS "count" ${where}`,
          [cutoff]
        );
        const idsRes = await pool.query(
          `SELECT player_id ${where} ORDER BY saved_at ASC LIMIT 100`,
          [cutoff]
        );
        return {
          deleted: 0,
          wouldDelete: Number(countRes.rows[0].count),
          playerIds: idsRes.rows.map((row) => row.player_id),
        };
      }
      const res = await pool.query(
        `DELETE ${where} RETURNING player_id`,
        [cutoff]
      );
      return {
        deleted: res.rowCount,
        wouldDelete: 0,
        playerIds: res.rows
          .slice(0, 100)
          .map((row) => row.player_id),
      };
    },

    /**
     * Validate and store a save, atomically. `body` is the parsed save
     * request (`{ playerId, state, actionsSinceLastSave }`).
     * Returns one of:
     * - `{ status: "unknown-player" }`
     * - `{ status: "rejected", rule, detail, lastGood }` (lastGood is the
     *   previous snapshot, for the 409 response)
     * - `{ status: "ok", state, savedAtMs }`
     */
    async applySave(playerId, body, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await lockSaveRow(client, playerId, nowMs);
        if (!locked) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        if (locked.wiped) {
          // Funding Rounds save wipe (issue #170): the row predated
          // the current schema and was just reset. Commit the reset
          // and reject what the client sent: it was built on the old
          // state, so the client reverts to the fresh lastGoodState.
          await client.query("COMMIT");
          return wipedRejection(locked.snapshot);
        }
        const prev = locked.snapshot;
        // The server no longer issues or matches star/farm outcomes
        // (they are rolled client-side now): a save is validated
        // against the previous snapshot only (shape, rate limit,
        // monotonicity, consistency — see validateSave).
        const verdict = validateSave(prev, body, nowMs);
        if (!verdict.ok) {
          await client.query("ROLLBACK");
          return {
            status: "rejected",
            rule: verdict.rule,
            detail: verdict.detail,
            lastGood: prev,
          };
        }
        await client.query(
          `UPDATE git_saves SET state = $1, saved_at = $2 WHERE player_id = $3`,
          [
            JSON.stringify(body.state),
            new Date(nowMs).toISOString(),
            playerId,
          ]
        );
        await client.query("COMMIT");
        // Telemetry (issue #152): after the commit, best effort. The
        // save is already stored; a snapshot failure cannot undo it.
        await recordMetricsSnapshot(pool, playerId, body.state, nowMs);
        return { status: "ok", state: body.state, savedAtMs: nowMs };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection is already broken; nothing to roll back.
        }
        throw err;
      } finally {
        client.release();
      }
    },

    /**
     * Sell the Company (prestige, Slice 1): claim Equity and reset
     * the company, atomically. `body` is the sale request
     * (`{ playerId, saleId, state, actionsSinceLastSave }`), where
     * `state` is the client's freshest PRE-sale state and `saleId` is
     * the client's idempotency key for this sale.
     *
     * The sale settles production up to the sale from the SENT
     * lifetime LOC (the client may be ahead of the stored snapshot by
     * unsaved progress), so the sent pre-sale state is first
     * validated as an ordinary successor of the stored state (same
     * trust boundary as a normal save, minus the rate limit — a sale
     * right after a save is not a flood). Then the Equity claim is
     * validated (at least one new Equity, Equity books matching the
     * stored ones) and the post-sale state is built by
     * shared.applyPrestigeSale and stored in the same transaction,
     * against the locked row — so two simultaneous sales for one
     * player cannot both claim the same Equity.
     *
     * Idempotency (criterion 5): when the stored state's lastSaleId
     * already equals the request's saleId, the sale was already
     * applied (a retried request whose first response was lost). The
     * stored post-sale state is returned unchanged — no second claim,
     * no second reset. The extra LOC earned between the two attempts
     * is lost with the restore, the same as any unsaved progress lost
     * on reload; exactly-once beats a few seconds of production.
     *
     * Returns one of:
     * - `{ status: "unknown-player" }`
     * - `{ status: "rejected", rule, detail, lastGood }` (lastGood is
     *   the previous snapshot, for the 409 response)
     * - `{ status: "already-applied", state, savedAtMs, sale }`
     * - `{ status: "ok", state, savedAtMs, sale }` (sale is
     *   `{ gainedEquity, lifetimeEquityEarned, founderMultiplierBefore,
     *   founderMultiplierAfter, saleCount }`)
     */
    async applySale(playerId, body, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await lockSaveRow(client, playerId, nowMs);
        if (!locked) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        if (locked.wiped) {
          // Funding Rounds save wipe (issue #170): the row predated
          // the current schema and was just reset. Commit the reset
          // and reject what the client sent: it was built on the old
          // state, so the client reverts to the fresh lastGoodState.
          await client.query("COMMIT");
          return wipedRejection(locked.snapshot);
        }
        const prev = locked.snapshot;
        const prevState = normalizeSaveState(prev.state);
        const sentState = normalizeSaveState(body.state);
        // Idempotency first: a retry of an already-applied sale
        // returns the stored post-sale state without claiming again.
        // The check runs before any validation of the sent state, so
        // a retry that carries a few more seconds of pre-sale progress
        // does not fail on it — that progress is simply superseded by
        // the already-applied sale.
        if (body.saleId && prevState.lastSaleId === body.saleId) {
          await client.query("COMMIT");
          return {
            status: "already-applied",
            // The raw stored state, not the normalized copy: a retry
            // restores exactly what the first attempt stored.
            state: prev.state,
            savedAtMs: prev.savedAtMs,
            sale: {
              gainedEquity: null,
              lifetimeEquityEarned: prevState.lifetimeEquityEarned,
              founderMultiplierBefore: null,
              founderMultiplierAfter: founderMultiplier(
                prevState.lifetimeEquityEarned
              ),
              saleCount: prevState.saleCount,
            },
          };
        }
        // The sent pre-sale state must be a valid successor of the
        // stored state (shape, monotonicity, consistency — the same
        // trust boundary as a normal save). The sale cannot mint
        // lifetime LOC the client could not have saved.
        const verdict = validateSave(prev, body, nowMs, {
          skipRateLimit: true,
        });
        if (!verdict.ok) {
          await client.query("ROLLBACK");
          return {
            status: "rejected",
            rule: verdict.rule,
            detail: verdict.detail,
            lastGood: prev,
          };
        }
        const saleVerdict = validatePrestigeSale(
          prevState,
          sentState,
          body.saleId
        );
        if (!saleVerdict.ok) {
          await client.query("ROLLBACK");
          return {
            status: "rejected",
            rule: saleVerdict.rule,
            detail: saleVerdict.detail,
            lastGood: prev,
          };
        }
        const postState = applyPrestigeSale(sentState, body.saleId);
        await client.query(
          `UPDATE git_saves SET state = $1, saved_at = $2 WHERE player_id = $3`,
          [
            JSON.stringify(postState),
            new Date(nowMs).toISOString(),
            playerId,
          ]
        );
        await client.query("COMMIT");
        // Telemetry (issue #152): every sale records the PRE-sale
        // state (the end of a company's curve), after the commit and
        // best effort.
        await recordMetricsSnapshot(pool, playerId, sentState, nowMs, {
          sale: true,
        });
        return {
          status: "ok",
          state: postState,
          savedAtMs: nowMs,
          sale: {
            gainedEquity: saleVerdict.gainedEquity,
            lifetimeEquityEarned: postState.lifetimeEquityEarned,
            founderMultiplierBefore: founderMultiplier(
              prevState.lifetimeEquityEarned
            ),
            founderMultiplierAfter: founderMultiplier(
              postState.lifetimeEquityEarned
            ),
            saleCount: postState.saleCount,
          },
        };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection is already broken; nothing to roll back.
        }
        throw err;
      } finally {
        client.release();
      }
    },

    /**
     * Permanent store (prestige, Slice 2): buy the next rank of one
     * store track, atomically. `body` is `{ playerId, storeId, rank,
     * state, actionsSinceLastSave }`, where `state` is the client's
     * freshest state and `rank` is the rank being bought (always the
     * next rank after the one owned). Purchases are available ONLY in
     * the post-sale intermission: the stored state must still have
     * the intermission open, and the sent state's intermission must
     * match it.
     *
     * Like the sale, the sent state is first validated as an ordinary
     * successor of the stored state (same trust boundary as a normal
     * save, minus the rate limit — a buy right after a save is not a
     * flood), so unsaved intermission progress (clicks) is preserved
     * instead of being overwritten by the stored snapshot. The
     * purchase is then validated (rank order, funds from the STORED
     * Equity books) and applied to the sent state in the same
     * transaction, against the locked row.
     *
     * Idempotency: a rank that is already owned returns
     * "already-owned" with the stored state and no second charge —
     * a retried purchase whose first response was lost. The client
     * restores the stored state and treats it as success.
     *
     * Returns one of:
     * - `{ status: "unknown-player" }`
     * - `{ status: "rejected", rule, detail, lastGood }`
     * - `{ status: "already-owned", state, savedAtMs, purchase }`
     * - `{ status: "ok", state, savedAtMs, purchase }` (purchase is
     *   `{ storeId, rank, price, equitySpent, availableEquity }`)
     */
    async applyStoreBuy(playerId, body, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await lockSaveRow(client, playerId, nowMs);
        if (!locked) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        if (locked.wiped) {
          // Funding Rounds save wipe (issue #170): the row predated
          // the current schema and was just reset. Commit the reset
          // and reject what the client sent: it was built on the old
          // state, so the client reverts to the fresh lastGoodState.
          await client.query("COMMIT");
          return wipedRejection(locked.snapshot);
        }
        const prev = locked.snapshot;
        const prevState = normalizeSaveState(prev.state);
        const sentState = normalizeSaveState(body.state);
        const buyVerdict = validateStoreBuy(
          prevState,
          sentState,
          body.storeId,
          body.rank
        );
        if (!buyVerdict.ok && buyVerdict.alreadyOwned) {
          await client.query("COMMIT");
          return {
            status: "already-owned",
            state: prev.state,
            savedAtMs: prev.savedAtMs,
            purchase: {
              storeId: body.storeId,
              rank: body.rank,
              price: null,
              equitySpent: prevState.equitySpent,
              availableEquity: availableEquity(
                prevState.lifetimeEquityEarned,
                prevState.equitySpent
              ),
            },
          };
        }
        if (!buyVerdict.ok) {
          await client.query("ROLLBACK");
          return {
            status: "rejected",
            rule: buyVerdict.rule,
            detail: buyVerdict.detail,
            lastGood: prev,
          };
        }
        // The sent state must be a valid successor of the stored
        // state (shape, monotonicity, consistency). The purchase
        // itself is applied below, on top of the sent state — never
        // on the stored snapshot, or unsaved intermission progress
        // would be lost with the restore.
        const verdict = validateSave(prev, body, nowMs, {
          skipRateLimit: true,
        });
        if (!verdict.ok) {
          await client.query("ROLLBACK");
          return {
            status: "rejected",
            rule: verdict.rule,
            detail: verdict.detail,
            lastGood: prev,
          };
        }
        const nextState = {
          ...sentState,
          permanentStoreRanks: {
            ...sentState.permanentStoreRanks,
            [body.storeId]: body.rank,
          },
          equitySpent:
            (sentState.equitySpent ?? 0) + buyVerdict.price,
        };
        await client.query(
          `UPDATE git_saves SET state = $1, saved_at = $2 WHERE player_id = $3`,
          [
            JSON.stringify(nextState),
            new Date(nowMs).toISOString(),
            playerId,
          ]
        );
        await client.query("COMMIT");
        // Telemetry (issue #159): an accepted save, so a snapshot,
        // after the commit and best effort.
        await recordMetricsSnapshot(pool, playerId, nextState, nowMs);
        return {
          status: "ok",
          state: nextState,
          savedAtMs: nowMs,
          purchase: {
            storeId: body.storeId,
            rank: body.rank,
            price: buyVerdict.price,
            equitySpent: nextState.equitySpent,
            availableEquity: availableEquity(
              nextState.lifetimeEquityEarned,
              nextState.equitySpent
            ),
          },
        };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection is already broken; nothing to roll back.
        }
        throw err;
      } finally {
        client.release();
      }
    },

    /**
     * Complete the post-sale intermission (prestige, Slice 2): apply
     * the Starting Capital grant once, from the frozen quote, and
     * clear the intermission. `body` is `{ playerId, state,
     * actionsSinceLastSave }`, the client's freshest state. Like the
     * sale and the store buy, the sent state is first validated as
     * an ordinary successor (minus the rate limit), so unsaved
     * intermission progress is preserved.
     *
     * The grant uses the rank the player ends the intermission with
     * and the frozen R and q from the sale (see
     * shared.completePrestigeIntermission): money becomes max(current
     * money, one base-price Intern, R x q x rank seconds). With no
     * Starting Capital rank, money is unchanged. The max() makes the
     * grant idempotent, and the intermission is cleared in the same
     * transaction — a retried completion finds no intermission and
     * returns "already-completed" with the stored state, never a
     * second grant.
     *
     * Returns one of:
     * - `{ status: "unknown-player" }`
     * - `{ status: "rejected", rule, detail, lastGood }`
     * - `{ status: "already-completed", state, savedAtMs, grant }`
     * - `{ status: "ok", state, savedAtMs, grant }` (grant is
     *   `{ applied, cashCents }`)
     */
    async completeIntermission(playerId, body, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await lockSaveRow(client, playerId, nowMs);
        if (!locked) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        if (locked.wiped) {
          // Funding Rounds save wipe (issue #170): the row predated
          // the current schema and was just reset. Commit the reset
          // and reject what the client sent: it was built on the old
          // state, so the client reverts to the fresh lastGoodState.
          await client.query("COMMIT");
          return wipedRejection(locked.snapshot);
        }
        const prev = locked.snapshot;
        const prevState = normalizeSaveState(prev.state);
        const sentState = normalizeSaveState(body.state);
        const completeVerdict = validateCompleteIntermission(
          prevState,
          sentState
        );
        if (!completeVerdict.ok) {
          await client.query("ROLLBACK");
          return {
            status: "rejected",
            rule: completeVerdict.rule,
            detail: completeVerdict.detail,
            lastGood: prev,
          };
        }
        if (completeVerdict.alreadyCompleted) {
          await client.query("COMMIT");
          return {
            status: "already-completed",
            state: prev.state,
            savedAtMs: prev.savedAtMs,
            grant: { applied: false, cashCents: prevState.money ?? 0 },
          };
        }
        const verdict = validateSave(prev, body, nowMs, {
          skipRateLimit: true,
        });
        if (!verdict.ok) {
          await client.query("ROLLBACK");
          return {
            status: "rejected",
            rule: verdict.rule,
            detail: verdict.detail,
            lastGood: prev,
          };
        }
        const nextState = completePrestigeIntermission(sentState);
        await client.query(
          `UPDATE git_saves SET state = $1, saved_at = $2 WHERE player_id = $3`,
          [
            JSON.stringify(nextState),
            new Date(nowMs).toISOString(),
            playerId,
          ]
        );
        await client.query("COMMIT");
        // Telemetry (issue #159): an accepted save, so a snapshot,
        // after the commit and best effort.
        await recordMetricsSnapshot(pool, playerId, nextState, nowMs);
        return {
          status: "ok",
          state: nextState,
          savedAtMs: nowMs,
          grant: {
            applied:
              Math.max(
                0,
                sentState.permanentStoreRanks?.startingCapital ?? 0
              ) >= 1,
            cashCents: nextState.money ?? 0,
          },
        };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection is already broken; nothing to roll back.
        }
        throw err;
      } finally {
        client.release();
      }
    },

    /**
     * Reset a player's progress (Danger Zone): overwrite their save row
     * with the fresh initial state. The account link (user_id) is
     * untouched — the player keeps the same playerId and the same link;
     * only the progress goes to 0. A normal save can never do this:
     * monotonicity forbids progress going backwards, so the reset has
     * its own path that bypasses validateSave entirely (the state it
     * writes is server-generated, so it is valid by construction). The
     * star/farm timers live in the save state now (nextStarAtMs /
     * lastStarBuyAtMs), so overwriting the state resets them too —
     * there is no separate server-side star/farm state left to clear.
     * One transaction against the locked row; the WHERE player_id = $1
     * means it can only ever touch the requesting player's own row.
     * Returns one of:
     * - `{ status: "ok", state, savedAtMs }`
     * - `{ status: "unknown-player" }`
     */
    async resetPlayer(playerId, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT player_id FROM git_saves WHERE player_id = $1 FOR UPDATE`,
          [playerId]
        );
        if (res.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        const state = initialSaveState();
        await client.query(
          `UPDATE git_saves
           SET state = $1, saved_at = $2, schema_version = $4
           WHERE player_id = $3`,
          [
            JSON.stringify(state),
            new Date(nowMs).toISOString(),
            playerId,
            SAVE_SCHEMA_VERSION,
          ]
        );
        await client.query("COMMIT");
        return { status: "ok", state, savedAtMs: nowMs };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection is already broken; nothing to roll back.
        }
        throw err;
      } finally {
        client.release();
      }
    },

    /**
     * Admin seed (issue #46): overwrite a TEST player's saved state,
     * bypassing save validation — it is setting up a test fixture, so
     * progression, rate-limit, and LOC/money rules do not apply. `state`
     * must already be shape-validated (see validateSeedState in
     * validate.js); the store trusts it. saved_at is set to nowMs, so
     * the next save's window starts at the seed time.
     *
     * GUARDRAIL: the row must be linked to an account whose email is
     * exactly `testEmail` (the test account, see admin.js). A guest row
     * (user_id NULL) or a row linked to any other account is refused —
     * a real player's save can never be seeded through this method,
     * even with a valid admin token. The check and the update run in
     * one transaction against the locked row, so the link cannot change
     * between them. Returns one of:
     * - `{ status: "ok", state, savedAtMs }`
     * - `{ status: "unknown-player" }` (no save row for that playerId)
     * - `{ status: "not-test-player" }` (row exists but is not linked
     *   to the test account)
     */
    async seedTestPlayer(playerId, state, nowMs, testEmail) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT gs.player_id, u.email
           FROM git_saves gs LEFT JOIN "user" u ON u.id = gs.user_id
           WHERE gs.player_id = $1 FOR UPDATE`,
          [playerId]
        );
        if (res.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        if (res.rows[0].email !== testEmail) {
          await client.query("ROLLBACK");
          return { status: "not-test-player" };
        }
        // A seeded state is shape-checked against the current rules,
        // so it carries the current schema version (no wipe on load).
        await client.query(
          `UPDATE git_saves SET state = $1, saved_at = $2, schema_version = $4
           WHERE player_id = $3`,
          [
            JSON.stringify(state),
            new Date(nowMs).toISOString(),
            playerId,
            SAVE_SCHEMA_VERSION,
          ]
        );
        await client.query("COMMIT");
        return { status: "ok", state, savedAtMs: nowMs };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection is already broken; nothing to roll back.
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
