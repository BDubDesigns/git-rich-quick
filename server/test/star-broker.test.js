/**
 * Tests for StarBroker's save-side trust (the leaderboard kill).
 *
 * Buying a star and rolling its outcome are client-side now — the
 * buy/claim endpoints and their tests are gone. What remains is the
 * save behavior the leaderboard kill established: the server stores
 * what the client sends (it does not police the StarBroker unlock or
 * affordability), and a save from before StarBroker shipped
 * normalizes instead of failing the shape check. Runs against a real
 * store backed by in-memory Postgres (pg-mem), with an injected
 * clock.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { initialSaveState } from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;

async function startTestServer() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = createStore(pool);
  await store.ensureSchema();

  let nowMs = T0;
  const server = createServer(store, { clock: () => nowMs });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    pool,
    store,
    now: () => nowMs,
    advance(ms) {
      nowMs += ms;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

async function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

/** Set a player's stored state directly (test setup, not the save path). */
async function setState(srv, playerId, overrides) {
  const state = initialSaveState();
  for (const [key, value] of Object.entries(overrides)) {
    state[key] =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? { ...state[key], ...value }
        : value;
  }
  // A player who owns Constellation levels necessarily met the
  // TOTAL_LOC >= 500 unlock (L1 costs 1000 LOC), and a player who owns
  // StarBroker levels necessarily met the TOTAL_LOC >= 5000 unlock
  // (L1 costs 10000 LOC) — so the fixture carries a realistic
  // lifetime-LOC base, otherwise the level rule rejects the state on save.
  if (
    (state.openSourceProjects?.constellation ?? 0) > 0 &&
    state.totalLinesOfCode < 1000
  ) {
    state.totalLinesOfCode = 1000;
  }
  if (
    (state.openSourceProjects?.starBroker ?? 0) > 0 &&
    state.totalLinesOfCode < 5000
  ) {
    state.totalLinesOfCode = 5000;
  }
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return state;
}

function zeroActions() {
  return {
    clicks: 0,
    employeesBought: { intern: 0, junior: 0, senior: 0, projectManager: 0, commitSpecialist: 0 },
    projectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    openSourceLevelsBought: {
      overReactFramework: 0,
      blocker: 0,
      constellation: 0,
      starBroker: 0,
    },
  };
}

test("StarBroker unlock: a level below TOTAL_LOC 5000 is accepted; a save without the key normalizes (leaderboard killed: unlocks are trusted)", async () => {
  const srv = await startTestServer();
  try {
    // A player at 1000 lifetime LOC (above Constellation's 500, below
    // StarBroker's 5000) claims StarBroker level 1 — the server stores
    // the claim instead of policing the unlock. The fixture is
    // self-consistent: the level is claimed without deducting its cost,
    // because affordability is not policed anymore either.
    const poor = await mintPlayer(srv.base);
    const poorStored = await setState(srv, poor, {
      openSourceProjects: { constellation: 1, starBroker: 0 },
      unlockedOpenSourceProjects: { constellation: true, starBroker: false },
      employees: { intern: 10 },
      linesOfCode: 1000,
      totalLinesOfCode: 1000,
    });
    srv.advance(11_000);
    const acceptedPoor = await post(srv.base, "/api/save", {
      playerId: poor,
      state: {
        ...poorStored,
        linesOfCode: 1000,
        totalLinesOfCode: 1000,
        openSourceProjects: { ...poorStored.openSourceProjects, starBroker: 1 },
        unlockedOpenSourceProjects: {
          ...poorStored.unlockedOpenSourceProjects,
          starBroker: true,
        },
      },
      actionsSinceLastSave: {
        ...zeroActions(),
        openSourceLevelsBought: {
          ...zeroActions().openSourceLevelsBought,
          starBroker: 1,
        },
      },
    });
    assert.equal(acceptedPoor.status, 200);

    // A player at 5000 lifetime LOC can claim it. (The fixture is
    // self-consistent: 20,000 LOC on hand implies 20,000 lifetime
    // LOC — a player with 20,000 current LOC necessarily has at
    // least that much lifetime LOC.)
    const rich = await mintPlayer(srv.base);
    const richStored = await setState(srv, rich, {
      openSourceProjects: { constellation: 1, starBroker: 0 },
      unlockedOpenSourceProjects: { constellation: true, starBroker: false },
      employees: { intern: 10 },
      linesOfCode: 20000,
      totalLinesOfCode: 20000,
    });
    srv.advance(11_000);
    const accepted = await post(srv.base, "/api/save", {
      playerId: rich,
      state: {
        ...richStored,
        linesOfCode: 20000 - 10000 + 110,
        totalLinesOfCode: 20000 + 110,
        openSourceProjects: { ...richStored.openSourceProjects, starBroker: 1 },
        unlockedOpenSourceProjects: {
          ...richStored.unlockedOpenSourceProjects,
          starBroker: true,
        },
      },
      actionsSinceLastSave: {
        ...zeroActions(),
        openSourceLevelsBought: {
          ...zeroActions().openSourceLevelsBought,
          starBroker: 1,
        },
      },
    });
    assert.equal(accepted.status, 200);

    // A save from before StarBroker shipped (no starBroker key in
    // the open-source maps) normalizes and validates instead of
    // failing the shape check.
    const old = await mintPlayer(srv.base);
    const oldState = initialSaveState();
    delete oldState.openSourceProjects.starBroker;
    delete oldState.unlockedOpenSourceProjects.starBroker;
    await srv.pool.query(
      `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
      [JSON.stringify(oldState), old]
    );
    srv.advance(11_000);
    const oldSaved = await post(srv.base, "/api/save", {
      playerId: old,
      state: { ...oldState, linesOfCode: 0, totalLinesOfCode: 0 },
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(oldSaved.status, 200);
  } finally {
    await srv.stop();
  }
});
