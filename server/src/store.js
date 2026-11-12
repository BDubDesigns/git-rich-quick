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
import { initialSaveState } from "../../shared/game-balance.js";
import { validateSave } from "./validate.js";

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
             VALUES ($1, 1, $2, $3, $3)`,
            [playerId, JSON.stringify(state), new Date(nowMs).toISOString()]
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
        const res = await client.query(
          `SELECT player_id, state, saved_at, created_at
           FROM git_saves WHERE player_id = $1 FOR UPDATE`,
          [playerId]
        );
        if (res.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        const prev = rowToSnapshot(res.rows[0]);
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
           SET state = $1, saved_at = $2
           WHERE player_id = $3`,
          [JSON.stringify(state), new Date(nowMs).toISOString(), playerId]
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
        await client.query(
          `UPDATE git_saves SET state = $1, saved_at = $2 WHERE player_id = $3`,
          [
            JSON.stringify(state),
            new Date(nowMs).toISOString(),
            playerId,
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
