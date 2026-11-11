/**
 * Regression tests for the PR #64 star-claim regression (Brandon, Nov 10 ~7:33 PM):
 * "every time I click a star now it just disappears no email and
 * apparently no buff or debuff I can see."
 *
 * Models a veteran L5 player (Brandon: 1.31M lifetime LOC, 51 employees,
 * Constellation v5.0) and walks the full live flow: fetch next star,
 * advance to the due time, claim, apply the claim the way the client
 * reducer would, then save with the claim — at several save delays.
 * Also probes the claim window itself (click at +0s / +10s / +29s /
 * +31s / +36s after the star becomes due).
 *
 * Run: node --test repro-star-claim.mjs  (from server/)
 * Or:  node repro-star-claim.mjs        (prints a summary, exit 1 on failure)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  STAR_CONFIG,
  initialSaveState,
  locPerSecond,
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
  return {
    base: `http://127.0.0.1:${port}`,
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

/** Brandon-like veteran state: L5 Constellation, 1.31M lifetime LOC. */
async function setVeteranState(srv, playerId) {
  const state = initialSaveState();
  state.totalLinesOfCode = 1_310_000;
  state.linesOfCode = 1_310_000;
  state.money = 316_000; // $3.16K in cents
  state.employees = { intern: 20, junior: 20, senior: 11 };
  state.openSourceProjects = {
    overReactFramework: 5,
    blocker: 4,
    constellation: 5,
  };
  state.unlockedEmployees = { intern: true, junior: true, senior: true };
  state.unlockedOpenSourceProjects = {
    overReactFramework: true,
    blocker: true,
    constellation: true,
  };
  // 205 total projects, 60 Hobby Websites — meets the Blockchain unlock
  // (200 total AND 50 Hobby), so the latch below is legitimate.
  state.freelanceProjectsCompleted = {
    toDoListApp: 120,
    hobbyWebsite: 60,
    paradigmShiftingBlockchainProject: 25,
  };
  state.unlockedFreelanceProjects = {
    toDoListApp: true,
    hobbyWebsite: true,
    paradigmShiftingBlockchainProject: true,
  };
  await srv.pool.query(
    `UPDATE git_saves SET state = $1 WHERE player_id = $2`,
    [JSON.stringify(state), playerId]
  );
  return state;
}

function zeroActions() {
  return {
    clicks: 0,
    employeesBought: { intern: 0, junior: 0, senior: 0 },
    projectsCompleted: {
      toDoListApp: 0,
      hobbyWebsite: 0,
      paradigmShiftingBlockchainProject: 0,
    },
    openSourceLevelsBought: {
      overReactFramework: 0,
      blocker: 0,
      constellation: 0,
    },
    starClaims: [],
  };
}

/**
 * Apply a claim the way the client reducer (APPLY_STAR_REWARD) does:
 * instant LOC/money deltas, plus a timed buff when the claim carries
 * a multiplier. `claimMs` is the server time of the claim (the buff's
 * expiry is anchored to it, the way the client anchors to Date.now()).
 */
function applyClaimToState(stored, claim, claimMs, passiveLoc) {
  return {
    ...stored,
    linesOfCode: Math.max(0, stored.linesOfCode + passiveLoc + claim.locDelta),
    totalLinesOfCode:
      stored.totalLinesOfCode +
      passiveLoc +
      Math.max(0, claim.locDelta),
    money: Math.max(0, stored.money + claim.moneyDelta),
    activeStarEffects:
      claim.multiplier !== null
        ? [
            {
              effect: claim.effect,
              multiplier: claim.multiplier,
              expiresAtMs: claimMs + claim.durationSeconds * 1000,
              employeeType: claim.employeeType,
            },
          ]
        : [],
  };
}

test("veteran L5: claim at due time + immediate save succeeds", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const stored = await setVeteranState(srv, playerId);
    const next = await (
      await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
    ).json();
    assert.ok(next.nextStarAtMs > T0, "a star is scheduled");
    assert.equal(next.constellationLevel, 5);
    srv.advance(next.nextStarAtMs - srv.now());
    const claimMs = srv.now();

    const claimed = await post(srv.base, "/api/star/claim", { playerId });
    const claimedText = await claimed.text();
    assert.equal(claimed.status, 200, claimedText);
    const claim = JSON.parse(claimedText).claim;

    const newState = applyClaimToState(stored, claim, claimMs, 0);
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: newState,
      actionsSinceLastSave: { ...zeroActions(), starClaims: [claim] },
    });
    assert.equal(saved.status, 200, await saved.text());
  } finally {
    await srv.stop();
  }
});

test("veteran L5: claim window — click offset after the star is due", async () => {
  const srv = await startTestServer();
  try {
    for (const offsetSeconds of [0, 10, 29, 31, 36]) {
      const playerId = await mintPlayer(srv.base);
      await setVeteranState(srv, playerId);
      const next = await (
        await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
      ).json();
      srv.advance(
        next.nextStarAtMs - srv.now() + offsetSeconds * 1000
      );
      const claimed = await post(srv.base, "/api/star/claim", { playerId });
      const claimedText = await claimed.text();
      // Inside the 30s lifetime (+5s grace): 200. Past it: 409.
      const expected = offsetSeconds <= 35 ? 200 : 409;
      assert.equal(
        claimed.status,
        expected,
        `click at +${offsetSeconds}s after due: expected ${expected}, got ${claimed.status} (${claimedText})`
      );
    }
  } finally {
    await srv.stop();
  }
});

test("veteran L5: claim + save delayed 10s / 20s / 35s / 40s", async () => {
  const srv = await startTestServer();
  try {
    for (const saveDelaySeconds of [10, 20, 35, 40]) {
      const playerId = await mintPlayer(srv.base);
      const stored = await setVeteranState(srv, playerId);
      const next = await (
        await fetch(`${srv.base}/api/star/next?playerId=${playerId}`)
      ).json();
      srv.advance(next.nextStarAtMs - srv.now());
      const claimMs = srv.now();
      const claimed = await post(srv.base, "/api/star/claim", { playerId });
      const claimedText = await claimed.text();
      assert.equal(claimed.status, 200, claimedText);
      const claim = JSON.parse(claimedText).claim;

      // The save arrives saveDelaySeconds after the claim.
      srv.advance(saveDelaySeconds * 1000);
      const passive = Math.floor(
        locPerSecond(stored.employees, stored.openSourceProjects) *
          saveDelaySeconds
      );
      const newState = applyClaimToState(stored, claim, claimMs, passive);
      const saved = await post(srv.base, "/api/save", {
        playerId,
        state: newState,
        actionsSinceLastSave: { ...zeroActions(), starClaims: [claim] },
      });
      // The issued outcome expires 30s after issue (+5s grace): a save
      // within 35s succeeds, past it the save is a STAR rejection and
      // the client reverts — the buff/email vanish.
      const expected = saveDelaySeconds <= 35 ? 200 : 409;
      assert.equal(
        saved.status,
        expected,
        `save ${saveDelaySeconds}s after claim: expected ${expected}, got ${saved.status} (${await saved.text()})`
      );
    }
  } finally {
    await srv.stop();
  }
});
