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
  };
}
