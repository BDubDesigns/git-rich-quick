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
  FARM_CONFIG,
  FARM_LIGHTING_COLORS,
  LLAMA_TYPES,
  initialSaveState,
  locPerSecond,
  resolveStarClaim,
  rollFarmBreeding,
  rollNextStarAtMs,
  rollStarEffect,
  rollStarGood,
  STAR_CONFIG,
  starBrokerBuyCost,
  starBrokerCooldownSeconds,
} from "../../shared/game-balance.js";
import {
  validateSave,
  matchIssuedStarClaims,
  matchIssuedFarmBreeds,
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
 * Shape-check a farm object sent to POST /api/farm/breed (issue #79
 * feedback). Mirrors the farm shape rules in validate.js's
 * checkStateShape, for a bare farm instead of a full save state.
 * Returns an error string, or null when the farm is well-formed.
 * Whether the llamas are plausible is the save validator's job, not
 * this endpoint's — the breed roll reads the sent farm, and the save
 * re-checks every kid against the issued outcome and the neighbours.
 */
function farmShapeError(farm) {
  if (
    farm === null ||
    typeof farm !== "object" ||
    Array.isArray(farm) ||
    Object.keys(farm).sort().join(",") !== "owned,stalls,unlockedTypes"
  ) {
    return "farm must be an object with owned, stalls, and unlockedTypes";
  }
  if (typeof farm.owned !== "boolean") {
    return "farm.owned must be a boolean";
  }
  if (
    !Array.isArray(farm.stalls) ||
    farm.stalls.length !== FARM_CONFIG.stallCount
  ) {
    return `farm.stalls must be an array of ${FARM_CONFIG.stallCount} stalls`;
  }
  for (const stall of farm.stalls) {
    if (
      stall === null ||
      typeof stall !== "object" ||
      Array.isArray(stall) ||
      Object.keys(stall).sort().join(",") !== "lighting,llama"
    ) {
      return "farm stalls must be objects with llama and lighting";
    }
    if (stall.llama !== null && !LLAMA_TYPES.includes(stall.llama)) {
      return `farm stall has an unknown llama type: ${stall.llama}`;
    }
    if (!FARM_LIGHTING_COLORS.includes(stall.lighting)) {
      return `farm stall has an unknown lighting color: ${stall.lighting}`;
    }
  }
  if (!Array.isArray(farm.unlockedTypes)) {
    return "farm.unlockedTypes must be an array";
  }
  for (const type of farm.unlockedTypes) {
    if (!LLAMA_TYPES.includes(type)) {
      return `farm.unlockedTypes has an unknown llama type: ${type}`;
    }
  }
  if (new Set(farm.unlockedTypes).size !== farm.unlockedTypes.length) {
    return "farm.unlockedTypes must not contain duplicates";
  }
  if (!farm.owned) {
    if (farm.stalls.some((stall) => stall.llama !== null)) {
      return "farm has llamas but is not owned";
    }
    if (farm.unlockedTypes.length > 0) {
      return "farm has unlocked types but is not owned";
    }
  }
  for (const stall of farm.stalls) {
    if (
      stall.llama !== null &&
      !farm.unlockedTypes.includes(stall.llama)
    ) {
      return `farm stall holds a llama type that is not unlocked: ${stall.llama}`;
    }
  }
  return null;
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
      // Bought stars (StarBroker): when the player last bought a star
      // (the buy cooldown runs from it), and when the currently
      // pending bought star was bought (its 30s lifetime runs from
      // it). bought_star_at_ms is NULL when no bought star is pending
      // — it is set on buy and cleared on claim. The natural star
      // timer (next_star_at_ms) is never touched by a buy: the whole
      // point is stacking a bought star with a natural one.
      await pool.query(`
        ALTER TABLE git_saves
          ADD COLUMN IF NOT EXISTS last_star_buy_at_ms BIGINT
      `);
      await pool.query(`
        ALTER TABLE git_saves
          ADD COLUMN IF NOT EXISTS bought_star_at_ms BIGINT
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
      // Server-rolled farm breeding (issue #79 feedback): when the
      // player last called POST /api/farm/breed (the breed cooldown
      // runs from it — one roll per breedingTickSeconds, so the client
      // cannot spam the endpoint to re-roll for a new type).
      await pool.query(`
        ALTER TABLE git_saves
          ADD COLUMN IF NOT EXISTS last_farm_breed_at_ms BIGINT
      `);
      // Server-issued breed outcomes (issue #79 feedback). The server
      // rolls each breeding tick's outcome and records it here; a
      // save's farm breed claim is only valid if its kids match an
      // unconsumed issued outcome (see matchIssuedFarmBreeds in
      // validate.js). An issued outcome is consumed by the accepted
      // save that carries its claim. Orphaned rows (kids rolled but
      // never saved, e.g. the tab closed first) linger harmlessly:
      // they can only ever authorize the exact outcome that was
      // legitimately rolled.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS farm_breed_issues (
          breed_id UUID PRIMARY KEY,
          player_id UUID NOT NULL,
          outcome JSONB NOT NULL,
          issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          consumed_at TIMESTAMPTZ
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS farm_breed_issues_player_unconsumed
          ON farm_breed_issues (player_id) WHERE consumed_at IS NULL
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
     * The next star time for a player, rolling one when none is set, or
     * when the stored time's star window has passed unclaimed (the star
     * despawned after its 30s lifetime and was never clicked). The read
     * and the conditional roll run against the locked row, so two
     * concurrent calls cannot roll twice. Returns null for an unknown
     * player, or `{ nextStarAtMs, constellationLevel, countdownUnlocked,
     * starBrokerLevel, buyCooldownSecondsRemaining, buyCost }`
     * (nextStarAtMs is null at Constellation level 0 — no stars).
     * The buy fields are the StarBroker status the client needs to
     * render the Buy Star button: the player's StarBroker level, how
     * many seconds until another star can be bought (0 when ready,
     * null when the player owns no StarBroker), and the LOC cost of
     * the next buy (30x passive LOC/s, from the stored state).
     */
    async getOrRollNextStarAt(playerId, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT state, next_star_at_ms, last_star_buy_at_ms FROM git_saves WHERE player_id = $1 FOR UPDATE`,
          [playerId]
        );
        if (res.rowCount === 0) {
          await client.query("ROLLBACK");
          return null;
        }
        const state = res.rows[0].state;
        const level = state.openSourceProjects?.constellation ?? 0;
        const starBrokerLevel = state.openSourceProjects?.starBroker ?? 0;
        const buyCooldown = starBrokerCooldownSeconds(starBrokerLevel);
        const buyCost =
          starBrokerLevel < 1
            ? null
            : starBrokerBuyCost(
                locPerSecond(state.employees, state.openSourceProjects)
              );
        let buyCooldownSecondsRemaining = null;
        if (buyCooldown !== null) {
          const lastBuyAtMs = res.rows[0].last_star_buy_at_ms;
          buyCooldownSecondsRemaining =
            lastBuyAtMs === null
              ? 0
              : Math.max(
                  0,
                  Math.ceil(
                    (Number(lastBuyAtMs) + buyCooldown * 1000 - nowMs) / 1000
                  )
                );
        }
        const buyStatus = {
          starBrokerLevel,
          buyCooldownSecondsRemaining,
          buyCost,
        };
        let nextStarAtMs = res.rows[0].next_star_at_ms;
        if (level < 1) {
          await client.query("ROLLBACK");
          return {
            nextStarAtMs: null,
            constellationLevel: level,
            countdownUnlocked: false,
            ...buyStatus,
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
          ...buyStatus,
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
     * - `{ status: "not-due", nextStarAtMs, expired }` (no star is due
     *   yet, or the due star already burned out)
     * A small grace (5s) covers client-timer skew: the client's
     * countdown can fire a hair before the server's spawn time. The
     * same grace applies past the star's 30s lifetime (star fix
     * slice): a star is only claimable inside its lifetime, so a claim
     * long after the star was due is rejected instead of succeeding.
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
        const lifetimeMs = STAR_CONFIG.starLifetimeSeconds * 1000;
        // The star burned out when its 30s lifetime passed (plus the
        // 5s grace): a claim after that is not due anymore, even though
        // the stored next-star time has not been re-rolled yet.
        const expired =
          nextStarAtMs !== null &&
          nowMs > Number(nextStarAtMs) + lifetimeMs + STAR_CLAIM_GRACE_MS;
        if (
          nextStarAtMs === null ||
          nowMs < Number(nextStarAtMs) - STAR_CLAIM_GRACE_MS ||
          expired
        ) {
          await client.query("ROLLBACK");
          return {
            status: "not-due",
            nextStarAtMs:
              nextStarAtMs === null ? null : Number(nextStarAtMs),
            expired,
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
     * Buy a golden star (StarBroker): the player sacrifices 30x their
     * passive LOC/s to summon a star on demand, so they can stack it
     * with a natural star. Validates against the STORED state (the only
     * rates the server trusts), deducts the cost from the stored
     * state's LOC, and records a pending bought star — all in one
     * transaction against the locked player row, so two concurrent buys
     * cannot both pass the cooldown/affordability checks. The natural
     * star timer (next_star_at_ms) is NEVER touched: the whole point is
     * stacking, so the natural schedule continues independently.
     * The outcome is NOT rolled here — it is rolled when the bought
     * star is clicked (see claimBoughtStar), so the issued outcome's
     * 30s validity runs from the click, not the buy, and a bought star
     * the player never clicks simply expires. Returns one of:
     * - `{ status: "ok", cost, linesOfCode, nextBuyAtMs, boughtStarAtMs,
     *    starBrokerLevel, buyCooldownSeconds }` (linesOfCode is the
     *   stored state's LOC after the deduction)
     * - `{ status: "unknown-player" }`
     * - `{ status: "no-star-broker" }` (StarBroker level 0)
     * - `{ status: "no-stars" }` (Constellation level 0 — there is no
     *   star effect pool to roll from)
     * - `{ status: "on-cooldown", nextBuyAtMs, cooldownSecondsRemaining }`
     * - `{ status: "not-enough-loc", cost, linesOfCode }`
     */
    async buyStar(playerId, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT state, last_star_buy_at_ms FROM git_saves WHERE player_id = $1 FOR UPDATE`,
          [playerId]
        );
        if (res.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        const state = res.rows[0].state;
        const starBrokerLevel = state.openSourceProjects?.starBroker ?? 0;
        if (starBrokerLevel < 1) {
          await client.query("ROLLBACK");
          return { status: "no-star-broker" };
        }
        const constellationLevel =
          state.openSourceProjects?.constellation ?? 0;
        if (constellationLevel < 1) {
          await client.query("ROLLBACK");
          return { status: "no-stars" };
        }
        const cooldownSeconds = starBrokerCooldownSeconds(starBrokerLevel);
        const lastBuyAtMs = res.rows[0].last_star_buy_at_ms;
        if (
          lastBuyAtMs !== null &&
          nowMs < Number(lastBuyAtMs) + cooldownSeconds * 1000
        ) {
          const nextBuyAtMs = Number(lastBuyAtMs) + cooldownSeconds * 1000;
          await client.query("ROLLBACK");
          return {
            status: "on-cooldown",
            nextBuyAtMs,
            cooldownSecondsRemaining: Math.ceil(
              (nextBuyAtMs - nowMs) / 1000
            ),
          };
        }
        const cost = starBrokerBuyCost(
          locPerSecond(state.employees, state.openSourceProjects)
        );
        if (state.linesOfCode < cost) {
          await client.query("ROLLBACK");
          return {
            status: "not-enough-loc",
            cost,
            linesOfCode: state.linesOfCode,
          };
        }
        const newState = { ...state, linesOfCode: state.linesOfCode - cost };
        const nextBuyAtMs = nowMs + cooldownSeconds * 1000;
        await client.query(
          `UPDATE git_saves
           SET state = $1, last_star_buy_at_ms = $2, bought_star_at_ms = $3
           WHERE player_id = $4`,
          [
            JSON.stringify(newState),
            nowMs,
            nowMs,
            playerId,
          ]
        );
        await client.query("COMMIT");
        return {
          status: "ok",
          cost,
          linesOfCode: newState.linesOfCode,
          nextBuyAtMs,
          boughtStarAtMs: nowMs,
          starBrokerLevel,
          buyCooldownSeconds: cooldownSeconds,
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
     * Claim a bought golden star (StarBroker): the player clicked the
     * star they bought. The outcome is rolled HERE (at click time, like
     * the natural star), from the stored state, recorded as an issued
     * outcome, and the pending bought star is cleared — all in one
     * transaction against the locked player row, so two concurrent
     * clicks cannot both issue. The natural star timer is never
     * touched. Returns one of:
     * - `{ claim }` (the claim carries its claimId)
     * - `{ status: "unknown-player" }`
     * - `{ status: "no-stars" }` (Constellation level 0)
     * - `{ status: "no-bought-star" }` (no pending bought star — it was
     *   already claimed, or never bought)
     * - `{ status: "not-due", expired: true }` (the bought star burned
     *   out — its 30s lifetime passed unclicked; the pending star is
     *   cleared so it cannot be claimed late)
     * The same 5s grace as the natural claim covers client-timer skew.
     */
    async claimBoughtStar(playerId, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT state, bought_star_at_ms FROM git_saves WHERE player_id = $1 FOR UPDATE`,
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
        const boughtStarAtMs = res.rows[0].bought_star_at_ms;
        if (boughtStarAtMs === null) {
          await client.query("ROLLBACK");
          return { status: "no-bought-star" };
        }
        const STAR_CLAIM_GRACE_MS = 5000;
        const lifetimeMs = STAR_CONFIG.starLifetimeSeconds * 1000;
        if (nowMs > Number(boughtStarAtMs) + lifetimeMs + STAR_CLAIM_GRACE_MS) {
          // Burned out unclicked: clear the pending star so a late
          // claim cannot succeed, and tell the client to re-fetch.
          await client.query(
            `UPDATE git_saves SET bought_star_at_ms = NULL WHERE player_id = $1`,
            [playerId]
          );
          await client.query("COMMIT");
          return { status: "not-due", expired: true };
        }
        // Roll the outcome from the stored state (server-trusted rates),
        // exactly like the natural claim.
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
          `UPDATE git_saves SET bought_star_at_ms = NULL WHERE player_id = $1`,
          [playerId]
        );
        await client.query("COMMIT");
        return { claim: issuedClaim };
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
     * claims are only valid if they match these exactly. Each entry
     * also carries `issuedAtMs` (from star_issues.issued_at), so the
     * validator can expire outcomes issuedOutcomeValidSeconds after
     * issue (star-claim-expiry fix).
     */
    async getIssuedStarClaims(playerId) {
      const res = await pool.query(
        `SELECT claim, issued_at FROM star_issues
         WHERE player_id = $1 AND consumed_at IS NULL
         ORDER BY issued_at ASC`,
        [playerId]
      );
      return res.rows.map((row) => ({
        ...row.claim,
        issuedAtMs: new Date(row.issued_at).getTime(),
      }));
    },

    /**
     * The player's unconsumed server-issued breed outcomes (issue #79
     * feedback), as `{ breedId, kids, issuedAtMs }` (kids is the list of
     * `{ stallIndex, type }` the server rolled). A save's farm breed
     * claims are only valid if their kids match these. Each entry also
     * carries `issuedAtMs` (from farm_breed_issues.issued_at), so the
     * validator can expire outcomes issuedBreedValidSeconds after issue.
     */
    async getIssuedFarmBreeds(playerId) {
      const res = await pool.query(
        `SELECT breed_id, outcome, issued_at FROM farm_breed_issues
         WHERE player_id = $1 AND consumed_at IS NULL
         ORDER BY issued_at ASC`,
        [playerId]
      );
      return res.rows.map((row) => ({
        breedId: row.breed_id,
        kids: row.outcome?.kids ?? [],
        issuedAtMs: new Date(row.issued_at).getTime(),
      }));
    },

    /**
     * Roll one farm breeding tick server-side (issue #79 feedback).
     * The client calls POST /api/farm/breed on the breeding interval
     * with its current farm; the server rolls (using the shared
     * rollFarmBreeding, same mood/lighting odds) and records the
     * outcome as issued, so the save is only valid if the kids match
     * what the server rolled. The client applies exactly the returned
     * kids and reports them in the next save.
     *
     * The roll reads the farm the client sent (which can include llamas
     * bought since the last save — a purchase saves promptly, but the
     * breed tick can fire before the heartbeat lands it). The save
     * validation is the final gate: a kid is only accepted if it
     * matches an issued outcome AND sits between two llamas in the
     * saved state, so a farm the client faked for the roll cannot
     * produce a kid the save will accept without the neighbours
     * actually being there (bought and paid for).
     *
     * One roll per breedingTickSeconds per player (the cooldown runs
     * from last_farm_breed_at_ms, 5s grace for timer jitter): the
     * client cannot spam the endpoint to re-roll for a new type. The
     * cooldown updates on every call, even a no-kid one.
     *
     * Returns one of:
     * - `{ status: "unknown-player" }`
     * - `{ status: "invalid-farm", detail }` (malformed farm)
     * - `{ status: "not-owned" }` (the farm has not been bought)
     * - `{ status: "cooldown", secondsRemaining }`
     * - `{ status: "ok", breedId, kids }` (breedId is null when no kid
     *   was born — nothing to record, nothing to claim)
     */
    async breedFarm(playerId, farm, nowMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT state, last_farm_breed_at_ms FROM git_saves WHERE player_id = $1 FOR UPDATE`,
          [playerId]
        );
        if (res.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "unknown-player" };
        }
        const farmError = farmShapeError(farm);
        if (farmError) {
          await client.query("ROLLBACK");
          return { status: "invalid-farm", detail: farmError };
        }
        if (!farm.owned) {
          await client.query("ROLLBACK");
          return { status: "not-owned" };
        }
        const lastBreedAtMs = res.rows[0].last_farm_breed_at_ms;
        const cooldownMs = FARM_CONFIG.breedingTickSeconds * 1000;
        const BREED_GRACE_MS = 5000;
        if (
          lastBreedAtMs !== null &&
          nowMs < Number(lastBreedAtMs) + cooldownMs - BREED_GRACE_MS
        ) {
          await client.query("ROLLBACK");
          return {
            status: "cooldown",
            secondsRemaining: Math.max(
              0,
              Math.ceil(
                (Number(lastBreedAtMs) + cooldownMs - nowMs) / 1000
              )
            ),
          };
        }
        // Roll the breeding tick server-side from the sent farm.
        const { stalls } = rollFarmBreeding(
          farm.stalls,
          farm.unlockedTypes ?? []
        );
        // Diff the rolled stalls against the sent farm to find which
        // stalls gained a kid and what type. The shared helper returns
        // only the kid types, not their stalls, so the diff is the
        // source of the stall indices.
        const kids = [];
        for (let i = 0; i < stalls.length; i++) {
          if (!farm.stalls[i].llama && stalls[i].llama) {
            kids.push({ stallIndex: i, type: stalls[i].llama });
          }
        }
        // Record the cooldown on every call, even a no-kid one, so the
        // client cannot spam no-kid rolls to fish for a new type.
        await client.query(
          `UPDATE git_saves SET last_farm_breed_at_ms = $1 WHERE player_id = $2`,
          [nowMs, playerId]
        );
        let breedId = null;
        if (kids.length > 0) {
          breedId = randomUUID();
          await client.query(
            `INSERT INTO farm_breed_issues (breed_id, player_id, outcome, issued_at)
             VALUES ($1, $2, $3, $4)`,
            [
              breedId,
              playerId,
              JSON.stringify({ kids }),
              new Date(nowMs).toISOString(),
            ]
          );
        }
        await client.query("COMMIT");
        return { status: "ok", breedId, kids };
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
          `SELECT claim, issued_at FROM star_issues
           WHERE player_id = $1 AND consumed_at IS NULL
           ORDER BY issued_at ASC`,
          [playerId]
        );
        const issuedClaims = issuedRows.rows.map((row) => ({
          ...row.claim,
          issuedAtMs: new Date(row.issued_at).getTime(),
        }));
        // Server-rolled farm breeding (issue #79 feedback): a save's
        // farm breed claims are only valid if their kids match a
        // server-issued, unconsumed breed outcome. Same transaction
        // and same lock as the star claims above.
        const issuedBreedRows = await client.query(
          `SELECT breed_id, outcome, issued_at FROM farm_breed_issues
           WHERE player_id = $1 AND consumed_at IS NULL
           ORDER BY issued_at ASC`,
          [playerId]
        );
        const issuedBreeds = issuedBreedRows.rows.map((row) => ({
          breedId: row.breed_id,
          kids: row.outcome?.kids ?? [],
          issuedAtMs: new Date(row.issued_at).getTime(),
        }));
        const verdict = validateSave(
          prev,
          body,
          nowMs,
          issuedClaims,
          issuedBreeds
        );
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
        const match = matchIssuedStarClaims(sentClaims, issuedClaims, nowMs);
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
        // Consume the issued breed outcomes this save carried, same
        // pattern as the star claims above (one UPDATE per breedId).
        const sentBreeds = body.actionsSinceLastSave?.farmBreedClaims ?? [];
        const breedMatch = matchIssuedFarmBreeds(
          sentBreeds,
          issuedBreeds,
          nowMs
        );
        for (const breedId of breedMatch.breedIds) {
          await client.query(
            `UPDATE farm_breed_issues SET consumed_at = $1
             WHERE breed_id = $2 AND player_id = $3`,
            [new Date(nowMs).toISOString(), breedId, playerId]
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
     * Reset a player's progress (Danger Zone): overwrite their save row
     * with the fresh initial state and clear all server-side star state
     * (next spawn time, bought-star cooldown/pending star) and farm
     * breed state (last breed time), and consume any unconsumed issued
     * star outcomes and farm breed outcomes so a pre-reset claim can
     * never be replayed against the fresh save. The account link
     * (user_id) is untouched — the player keeps the same playerId and
     * the same link; only the progress goes to 0. A normal save can
     * never do this: monotonicity forbids progress going backwards, so
     * the reset has its own path that bypasses validateSave entirely
     * (the state it writes is server-generated, so it is valid by
     * construction). One
     * transaction against the locked row; the WHERE player_id = $1
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
           SET state = $1, saved_at = $2,
               next_star_at_ms = NULL,
               last_star_buy_at_ms = NULL,
               bought_star_at_ms = NULL,
               last_farm_breed_at_ms = NULL
           WHERE player_id = $3`,
          [JSON.stringify(state), new Date(nowMs).toISOString(), playerId]
        );
        await client.query(
          `UPDATE star_issues SET consumed_at = $1
           WHERE player_id = $2 AND consumed_at IS NULL`,
          [new Date(nowMs).toISOString(), playerId]
        );
        await client.query(
          `UPDATE farm_breed_issues SET consumed_at = $1
           WHERE player_id = $2 AND consumed_at IS NULL`,
          [new Date(nowMs).toISOString(), playerId]
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
