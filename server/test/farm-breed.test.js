/**
 * Tests for POST /api/farm/breed (issue #79 feedback): the breeding
 * roll happens on the SERVER, not the client. Runs against a real
 * store backed by in-memory Postgres (pg-mem), with an injected
 * clock. Player states are set by updating the save row directly —
 * these tests are about the breed endpoint, not the save path —
 * except the end-to-end test, which saves through the real /api/save
 * endpoint.
 *
 * Key behaviors: the server rolls from the sent farm (same
 * mood/lighting odds), records the outcome as issued, and returns the
 * kids; one roll per breedingTickSeconds (cooldown), so the client
 * cannot spam the endpoint to re-roll for a new type; a save only
 * accepts kids that match an issued outcome, and an issued outcome
 * is consumed by the accepted save that carries it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  FARM_CONFIG,
  LLAMA_BASE_TYPES,
  emptyFarmState,
  initialSaveState,
} from "../../shared/game-balance.js";

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
    body: typeof body === "string" ? body : JSON.stringify(body),
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
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return state;
}

/** A stocked barn: 5 bought llamas in a checkerboard, red lights on the empty stalls. */
function stockedFarm() {
  const placed = {
    0: "classic",
    2: "drama",
    4: "classic",
    6: "drama",
    8: "classic",
  };
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => ({
      llama: placed[i] ?? null,
      // Red on the empty stalls: 30% kid chance, the fastest way to
      // see a kid in a test (4 eligible stalls -> ~76% per tick).
      lighting: placed[i] ? "warm" : "red",
    })),
    unlockedTypes: [...LLAMA_BASE_TYPES],
  };
}

function zeroActions() {
  return {
    clicks: 0,
    employeesBought: {
      intern: 0,
      junior: 0,
      senior: 0,
      projectManager: 0,
      commitSpecialist: 0,
    },
    projectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
      aiPoweredDashboard: 0,
      nftMarketplace: 0,
      metaverseRealEstate: 0,
      quantumToDoList: 0,
    },
    openSourceLevelsBought: {
      overReactFramework: 0,
      blocker: 0,
      constellation: 0,
      starBroker: 0,
    },
    starClaims: [],
    farmBreedClaims: [],
  };
}

test("breed with an unknown player is 404", async () => {
  const srv = await startTestServer();
  try {
    const res = await post(srv.base, "/api/farm/breed", {
      playerId: "123e4567-e89b-42d3-a456-426614174000",
      farm: emptyFarmState(),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "unknown-player");
  } finally {
    await srv.stop();
  }
});

test("breed with a malformed body is 400", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    // No farm in the body.
    const res = await post(srv.base, "/api/farm/breed", { playerId });
    assert.equal(res.status, 400);
    // A farm with an unknown llama type.
    const badFarm = stockedFarm();
    badFarm.stalls[0] = { llama: "notAType", lighting: "warm" };
    const res2 = await post(srv.base, "/api/farm/breed", {
      playerId,
      farm: badFarm,
    });
    assert.equal(res2.status, 400);
  } finally {
    await srv.stop();
  }
});

test("breed with an unbought farm is 409 farm-not-owned", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const res = await post(srv.base, "/api/farm/breed", {
      playerId,
      farm: emptyFarmState(),
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "farm-not-owned");
  } finally {
    await srv.stop();
  }
});

test("breed rolls server-side and the cooldown blocks a second immediate roll", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const farm = stockedFarm();
    const res = await post(srv.base, "/api/farm/breed", {
      playerId,
      farm,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    // breedId is null when no kid was born; a UUID when one was.
    assert.ok(data.breedId === null || typeof data.breedId === "string");
    assert.ok(Array.isArray(data.kids));
    for (const kid of data.kids) {
      assert.ok(Number.isInteger(kid.stallIndex));
      assert.ok(typeof kid.type === "string");
    }
    // A second roll immediately after is a 409 cooldown.
    const res2 = await post(srv.base, "/api/farm/breed", {
      playerId,
      farm,
    });
    assert.equal(res2.status, 409);
    const data2 = await res2.json();
    assert.equal(data2.error, "farm-breed-cooldown");
    assert.ok(data2.secondsRemaining > 0);
    // After the breeding interval passes, a roll succeeds again.
    srv.advance(FARM_CONFIG.breedingTickSeconds * 1000);
    const res3 = await post(srv.base, "/api/farm/breed", {
      playerId,
      farm,
    });
    assert.equal(res3.status, 200);
  } finally {
    await srv.stop();
  }
});

test("breed with no eligible stalls returns no kids", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    // An owned but empty barn: no llamas, so no stall can breed.
    const farm = {
      owned: true,
      stalls: Array.from({ length: FARM_CONFIG.stallCount }, () => ({
        llama: null,
        lighting: "warm",
      })),
      unlockedTypes: [],
    };
    const res = await post(srv.base, "/api/farm/breed", {
      playerId,
      farm,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.breedId, null);
    assert.deepEqual(data.kids, []);
  } finally {
    await srv.stop();
  }
});

test("end-to-end: a server-rolled kid saves, and the same claim cannot be replayed", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    // The stored state: an owned stocked farm with money. The breed
    // endpoint rolls from the farm the client sends, so send the same
    // stocked farm.
    const farm = stockedFarm();
    await setState(srv, playerId, { money: 75000, farm });
    // Roll until a kid is born (red lights, 4 eligible stalls, ~76%
    // per tick). Advance the clock past the cooldown between rolls.
    let breed = null;
    for (let attempt = 0; attempt < 10 && !breed; attempt++) {
      const res = await post(srv.base, "/api/farm/breed", {
        playerId,
        farm,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      if (data.kids.length > 0) breed = data;
      srv.advance(FARM_CONFIG.breedingTickSeconds * 1000);
    }
    assert.ok(breed, "expected a kid within 10 breed ticks");
    // Apply the kids to the farm and save with the claim. The stored
    // state is still the stocked farm (before the kids) — that is the
    // save's prev; the new state carries the kids + claim.
    const nextFarm = {
      ...farm,
      stalls: farm.stalls.map((stall) => ({ ...stall })),
      unlockedTypes: [...farm.unlockedTypes],
    };
    for (const kid of breed.kids) {
      nextFarm.stalls[kid.stallIndex] = {
        ...nextFarm.stalls[kid.stallIndex],
        llama: kid.type,
      };
      if (!nextFarm.unlockedTypes.includes(kid.type)) {
        nextFarm.unlockedTypes.push(kid.type);
      }
    }
    const actions = zeroActions();
    actions.farmBreedClaims = [
      { breedId: breed.breedId, kids: breed.kids },
    ];
    // Rebuild the "before" state: the stocked farm as stored.
    const beforeState = await (async () => {
      const res = await fetch(
        `${srv.base}/api/load?playerId=${playerId}`
      );
      return (await res.json()).state;
    })();
    // The stored state is the stocked farm (set above); the new state
    // is the same state with the kids applied. Build the save body
    // from the loaded state so the money and the rest match.
    const newState = { ...beforeState, farm: nextFarm };
    const saveRes = await post(srv.base, "/api/save", {
      playerId,
      state: newState,
      actionsSinceLastSave: actions,
    });
    // The save may hit the 10s rate limit if the clock has not moved
    // past it — the breed loop advanced it by minutes, so it is clear.
    assert.equal(saveRes.status, 200, await saveRes.text());
    // The kid is now in the loaded state.
    const loaded = await (async () => {
      const res = await fetch(
        `${srv.base}/api/load?playerId=${playerId}`
      );
      return (await res.json()).state;
    })();
    for (const kid of breed.kids) {
      assert.equal(loaded.farm.stalls[kid.stallIndex].llama, kid.type);
    }
    // Replaying the same claim in a second save is rejected: the
    // outcome was consumed by the accepted save.
    srv.advance(11_000);
    const replayRes = await post(srv.base, "/api/save", {
      playerId,
      state: newState,
      actionsSinceLastSave: actions,
    });
    assert.equal(replayRes.status, 409);
    const replayBody = await replayRes.json();
    assert.equal(replayBody.rule, "FARM");
  } finally {
    await srv.stop();
  }
});
