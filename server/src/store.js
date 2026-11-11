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
  initialSaveState,
  locPerSecond,
  resolveStarClaim,
  rollNextStarAtMs,
  rollStarEffect,
  rollStarGood,
  STAR_CONFIG,
} from "../../shared/game-balance.js";
import { validateSave, matchIssuedStarClaims } from "./validate.js";
import {
  displayNameForUser,
  normalizeLeaderboardSort,
} from "./leaderboard.js";

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
      // Server-rolled stars (issue #29): when the next star may spawn,
      // per player (ms since epoch, null until the first roll).
      await pool.query(`
        ALTER TABLE git_saves
          ADD COLUMN IF NOT EXISTS next_star_at_ms BIGINT
      `);
      // Server-issued star outcomes (issue #29). The server rolls each
      // star's outcome and records it here; a save's star claim is only
      // valid if it matches an unconsumed issued outcome exactly (see
      // matchIssuedStarClaims in validate.js). An issued outcome is
      // consumed by the accepted save that carries its claim. Orphaned
      // rows (a reward applied locally but never saved, e.g. the tab
      // closed first) linger harmlessly: they can only ever authorize
      // the exact outcome that was legitimately rolled.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS star_issues (
          claim_id UUID PRIMARY KEY,
          player_id UUID NOT NULL,
          claim JSONB NOT NULL,
          issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          consumed_at TIMESTAMPTZ
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS star_issues_player_unconsumed
          ON star_issues (player_id) WHERE consumed_at IS NULL
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
     * Leaderboard (issue #29): the top `limit` ACCOUNTS only (guests
     * never appear), ranked by `sort` (lifetime | current | cash;
     * unknown values fall back to lifetime). Scores are derived live
     * from the DB on each call — no separate update job; a player's
     * score updates when they save. Only accounts with a linked save
     * and a lifetime LOC above zero appear. Returns entries of
     * `{ rank, displayName, lifetimeLoc, currentLoc, money }` — rank,
     * name, and scores only, never a save or an email.
     */
    async getLeaderboard(sort, limit = 10) {
      const sortKey = normalizeLeaderboardSort(sort);
      const orderBy =
        sortKey === "current"
          ? `(state->>'linesOfCode')::float`
          : sortKey === "cash"
            ? `(state->>'money')::int`
            : `(state->>'totalLinesOfCode')::float`;
      const res = await pool.query(
        `SELECT u.name AS user_name, u.email AS user_email,
                (gs.state->>'totalLinesOfCode')::float AS "lifetimeLoc",
                (gs.state->>'linesOfCode')::float AS "currentLoc",
                (gs.state->>'money')::int AS money
         FROM git_saves gs
         JOIN "user" u ON u.id = gs.user_id
         WHERE gs.user_id IS NOT NULL
           AND (gs.state->>'totalLinesOfCode')::float > 0
         ORDER BY ${orderBy} DESC
         LIMIT $1`,
        [limit]
      );
      return res.rows.map((row, index) => ({
        rank: index + 1,
        displayName: displayNameForUser(row.user_name, row.user_email),
        lifetimeLoc: row.lifetimeLoc,
        currentLoc: row.currentLoc,
        money: row.money,
      }));
    },

    /**
     * The next star time for a player, rolling one when none is set, or
     * when the stored time's star window has passed unclaimed (the star
     * despawned after its 30s lifetime and was never clicked). The read
     * and the conditional roll run against the locked row, so two
     * concurrent calls cannot roll twice. Returns null for an unknown
     * player, or `{ nextStarAtMs, constellationLevel, countdownUnlocked }`
     * (nextStarAtMs is null at Constellation level 0 — no stars).
     */
    async getOrRollNextStarAt(playerId, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT state, next_star_at_ms FROM git_saves WHERE player_id = $1 FOR UPDATE`,
          [playerId]
        );
        if (res.rowCount === 0) {
          await client.query("ROLLBACK");
          return null;
        }
        const state = res.rows[0].state;
        const level = state.openSourceProjects?.constellation ?? 0;
        let nextStarAtMs = res.rows[0].next_star_at_ms;
        if (level < 1) {
          await client.query("ROLLBACK");
          return {
            nextStarAtMs: null,
            constellationLevel: level,
            countdownUnlocked: false,
          };
        }
        const lifetimeMs = STAR_CONFIG.starLifetimeSeconds * 1000;
        if (
          nextStarAtMs === null ||
          nowMs >= Number(nextStarAtMs) + lifetimeMs
        ) {
          nextStarAtMs = rollNextStarAtMs(level, nowMs);
          await client.query(
            `UPDATE git_saves SET next_star_at_ms = $1 WHERE player_id = $2`,
            [nextStarAtMs, playerId]
          );
        }
        await client.query("COMMIT");
        return {
          nextStarAtMs: Number(nextStarAtMs),
          constellationLevel: level,
          countdownUnlocked: level >= STAR_CONFIG.countdownUnlockLevel,
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
     * Claim the due golden star (issue #29): check a star is actually
     * due, roll the outcome from the player's STORED state, record the
     * issued outcome, and roll + store the NEXT spawn time — all in
     * one transaction against the locked player row, so two concurrent
     * claims cannot both issue. The roll uses the stored state's rates
     * (the only rates the server trusts); the client's local state may
     * be ahead, so the reward can be slightly below what the client
     * would have rolled — correct, not a bug. Returns one of:
     * - `{ claim, nextStarAtMs }` (the claim carries its claimId)
     * - `{ status: "unknown-player" }`
     * - `{ status: "no-stars" }` (Constellation level 0)
     * - `{ status: "not-due", nextStarAtMs }` (no star is due yet)
     * A small grace (5s) covers client-timer skew: the client's
     * countdown can fire a hair before the server's spawn time.
     */
    async claimStar(playerId, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT state, next_star_at_ms FROM git_saves WHERE player_id = $1 FOR UPDATE`,
          [playerId]
        );
        if (res.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        const state = res.rows[0].state;
        const level = state.openSourceProjects?.constellation ?? 0;
        if (level < 1) {
          await client.query("ROLLBACK");
          return { status: "no-stars" };
        }
        const nextStarAtMs = res.rows[0].next_star_at_ms;
        const STAR_CLAIM_GRACE_MS = 5000;
        if (
          nextStarAtMs === null ||
          nowMs < Number(nextStarAtMs) - STAR_CLAIM_GRACE_MS
        ) {
          await client.query("ROLLBACK");
          return {
            status: "not-due",
            nextStarAtMs:
              nextStarAtMs === null ? null : Number(nextStarAtMs),
          };
        }
        // Roll the outcome from the stored state (server-trusted rates).
        const effect = rollStarEffect(level);
        const good = effect === "shootingStars" ? true : rollStarGood();
        const claim = resolveStarClaim({
          effect,
          good,
          locPerSecond: locPerSecond(state.employees, state.openSourceProjects),
          money: state.money,
          linesOfCode: state.linesOfCode,
          employeeCounts: state.employees,
        });
        const claimId = randomUUID();
        const issuedClaim = { ...claim, claimId };
        const nextNextStarAtMs = rollNextStarAtMs(level, nowMs);
        await client.query(
          `INSERT INTO star_issues (claim_id, player_id, claim, issued_at)
           VALUES ($1, $2, $3, $4)`,
          [
            claimId,
            playerId,
            JSON.stringify(issuedClaim),
            new Date(nowMs).toISOString(),
          ]
        );
        await client.query(
          `UPDATE git_saves SET next_star_at_ms = $1 WHERE player_id = $2`,
          [nextNextStarAtMs, playerId]
        );
        await client.query("COMMIT");
        return { claim: issuedClaim, nextStarAtMs: nextNextStarAtMs };
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
     * The player's unconsumed server-issued star outcomes (issue #29),
     * as claim objects (each carrying its claimId). A save's star
     * claims are only valid if they match these exactly.
     */
    async getIssuedStarClaims(playerId) {
      const res = await pool.query(
        `SELECT claim FROM star_issues
         WHERE player_id = $1 AND consumed_at IS NULL
         ORDER BY issued_at ASC`,
        [playerId]
      );
      return res.rows.map((row) => row.claim);
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
        // Server-rolled stars (issue #29): a save's star claims are
        // only valid if they match a server-issued, unconsumed outcome.
        // The issued rows are read inside this transaction, against the
        // locked player row, so a claim cannot be consumed twice by two
        // concurrent saves.
        const issuedRows = await client.query(
          `SELECT claim FROM star_issues
           WHERE player_id = $1 AND consumed_at IS NULL
           ORDER BY issued_at ASC`,
          [playerId]
        );
        const issuedClaims = issuedRows.rows.map((row) => row.claim);
        const verdict = validateSave(prev, body, nowMs, issuedClaims);
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
        // Consume the issued outcomes this save carried. validateSave
        // already matched them, so this always succeeds; the matched
        // ids are recomputed here (same pure matcher) to keep
        // validateSave's return shape unchanged.
        const sentClaims = body.actionsSinceLastSave?.starClaims ?? [];
        const match = matchIssuedStarClaims(sentClaims, issuedClaims);
        // One UPDATE per claimId (not `claim_id = ANY($1)`): an array
        // parameter is not portable across drivers, and a silent
        // no-match here would let a consumed outcome be replayed.
        for (const claimId of match.claimIds) {
          await client.query(
            `UPDATE star_issues SET consumed_at = $1
             WHERE claim_id = $2 AND player_id = $3`,
            [new Date(nowMs).toISOString(), claimId, playerId]
          );
        }
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
