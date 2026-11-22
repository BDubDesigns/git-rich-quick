/**
 * Tests for the store-only intermission (issue #188).
 *
 * Brandon, Nov 19: "It let me get LOC before starting new game. It
 * should bring up the store to spend stuff on and nothing else in the
 * future." His company 2 started with 4 LOC clicked in the intermission.
 *
 * - Client: while the intermission is open the reducer refuses every
 *   game action (context/intermissionGate.js), the tick does not run,
 *   clicks are not counted, and App renders only the store screen.
 * - Server: the company-progress fields are pinned to the stored
 *   post-sale values on save, store buy and completion
 *   (pinIntermissionProgress), and a sale cannot start mid-intermission.
 *   Nothing is rejected that was accepted before, so the rate limit on
 *   saves and the rate-limit-free buy and complete endpoints behave
 *   exactly as they did.
 * - Completion still builds the new company from the frozen sale quote:
 *   the Starting Capital grant, the Night Shift Contract level, the
 *   ranks, and nothing else.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  BALANCE,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  INTERMISSION_FROZEN_FIELDS,
  OPEN_SOURCE_IDS,
  initialSaveState,
  intermissionOpen,
  pinIntermissionProgress,
  startingCapitalGrantCents,
} from "../../shared/game-balance.js";
import {
  INTERMISSION_ALLOWED_ACTIONS,
  isActionBlockedDuringIntermission,
} from "../../client/src/context/intermissionGate.js";
import { withClientBuild } from "./helpers/client-build.js";

const T0 = 1_700_000_000_000;
const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

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
    body: JSON.stringify(withClientBuild(path, body)),
  });
}

async function loadState(base, playerId) {
  const res = await fetch(`${base}/api/load?playerId=${playerId}`);
  assert.equal(res.status, 200);
  return (await res.json()).state;
}

function zeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function zeroActions() {
  return {
    clicks: 0,
    employeesBought: zeroCounts(EMPLOYEE_TYPES),
    projectsCompleted: zeroCounts(FREELANCE_PROJECT_KEYS),
    autoShips: zeroCounts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: zeroCounts(OPEN_SOURCE_IDS),
  };
}

/**
 * A player who just sold: a real company (so the frozen quote is a
 * real number), sold through the endpoint. Returns the post-sale state
 * with the intermission open.
 */
async function soldPlayer(srv) {
  const minted = await post(srv.base, "/api/player", {});
  const { playerId } = await minted.json();
  const pre = initialSaveState();
  pre.linesOfCode = 50_000_000;
  pre.totalLinesOfCode = 270_000_000; // 3 Equity
  pre.money = 1_000_000;
  pre.employees = { ...pre.employees, intern: 200, junior: 100, senior: 40 };
  await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [
    JSON.stringify(pre),
    playerId,
  ]);
  srv.advance(2000);
  const res = await post(srv.base, "/api/save/sell", {
    playerId,
    saleId: randomUUID(),
    state: pre,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  const sold = await res.json();
  assert.ok(intermissionOpen(sold.state));
  return { playerId, post: sold.state, saleId: sold.state.lastSaleId };
}

/** What a modified client claims to have earned during the intermission. */
function withAccrual(state) {
  return {
    ...state,
    linesOfCode: state.linesOfCode + 4,
    totalLinesOfCode: state.totalLinesOfCode + 4,
    money: state.money + 500,
    employees: { ...state.employees, intern: 3 },
    achievements: {
      ...state.achievements,
      clicks: (state.achievements?.clicks ?? 0) + 4,
      hires: { ...state.achievements?.hires, intern: (state.achievements?.hires?.intern ?? 0) + 3 },
    },
  };
}

function assertCompanyUnchanged(state, post, message) {
  assert.equal(state.linesOfCode, post.linesOfCode, message);
  assert.equal(state.totalLinesOfCode, post.totalLinesOfCode, message);
  assert.equal(state.money, post.money, message);
  assert.deepEqual(state.employees, post.employees, message);
  assert.deepEqual(state.achievements, post.achievements, message);
}

// --- The client gate ---

test("client gate: every game action is inert while the intermission is open", () => {
  const actionTypes = [
    ...src("context/GameContext.jsx").matchAll(/^ {4}case "([A-Z_]+)":/gm),
  ].map((m) => m[1]);
  assert.ok(actionTypes.length > 30, `found ${actionTypes.length} action types`);
  for (const type of ["WRITE_CODE", "GAME_TICK", "BUY_EMPLOYEE", "COMPLETE_PROJECT", "CONTRIBUTE_TO_PROJECT", "BUY_STAR", "APPLY_STAR_REWARD", "BUY_FARM", "BUY_LLAMA", "BUY_NIGHT_SHIFT_LEVEL", "ACTIVATE_SUBTRACTERALL", "SET_RELEASE_MANAGER_ASSIGNMENT"]) {
    assert.ok(actionTypes.includes(type), type);
  }
  const open = { prestigeIntermission: { saleId: randomUUID(), frozenHealthyPassiveLocPerSec: 1, frozenBestPayoutPerLocCents: 60 } };
  for (const type of actionTypes) {
    const allowed = INTERMISSION_ALLOWED_ACTIONS.includes(type);
    assert.equal(isActionBlockedDuringIntermission(open, { type }), !allowed, type);
    // With no intermission, nothing is blocked.
    assert.equal(isActionBlockedDuringIntermission({ prestigeIntermission: null }, { type }), false, type);
  }
  // Only adopting a server state and view preferences run (issue #174
  // added the two pane actions: layout mode and the pane picker).
  assert.deepEqual([...INTERMISSION_ALLOWED_ACTIONS], ["RESTORE_SAVE", "TOGGLE_SECTION_DESC_VISIBILITY", "SET_LAYOUT_MODE", "CHOOSE_PANE_SECTION"]);
  assert.equal(isActionBlockedDuringIntermission(open, { type: "SOMETHING_NEW" }), true);
});

test("client wiring: the reducer gates first, clicks are not counted, the tick skips, App shows the store only", () => {
  const context = src("context/GameContext.jsx");
  assert.match(
    context,
    /function gameReducer\(state, action\) \{\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*if \(isActionBlockedDuringIntermission\(state, action\)\) \{\s*return state;/
  );
  assert.match(context, /if \(action\.type === "WRITE_CODE" && !blocked\) \{\s*saveSyncRef\.current\.recordClick\(\);/);
  const app = src("App.jsx");
  assert.match(app, /if \(stateRef\.current\.prestigeIntermission\) return;/);
  assert.match(app, /if \(state\.prestigeIntermission\) \{\s*return <IntermissionScreen \/>;\s*\}/);
  // The store screen comes before the game layout, so no game UI renders.
  assert.ok(app.indexOf("<IntermissionScreen />") < app.indexOf("<GameLayout>"));
  const screen = src("components/IntermissionScreen.jsx");
  assert.match(screen, /<PermanentStore \/>/);
  for (const banned of ["NavBar", "ClickButton", "Footer", "GoldenStar", "StatBox", "<Header"]) {
    assert.ok(!screen.includes(banned), `no ${banned} on the intermission screen`);
  }
  assert.ok(!screen.includes("—") && !screen.includes("–"));
});

// --- The shared pin ---

test("pinIntermissionProgress: pins every frozen field to the stored value, only while open", () => {
  const stored = initialSaveState();
  stored.prestigeIntermission = { saleId: randomUUID(), frozenHealthyPassiveLocPerSec: 10, frozenBestPayoutPerLocCents: 60 };
  const sent = withAccrual(stored);
  sent.emails = [{ marker: true }];
  sent.overtimeReskin = true;
  const pinned = pinIntermissionProgress(stored, sent);
  for (const field of INTERMISSION_FROZEN_FIELDS) {
    assert.deepEqual(pinned[field], stored[field], field);
  }
  // Presentation fields are the client's.
  assert.deepEqual(pinned.emails, [{ marker: true }]);
  assert.equal(pinned.overtimeReskin, true);
  // A copy, never the stored object itself.
  assert.notEqual(pinned.employees, stored.employees);
  // No intermission, no pin.
  const closed = { ...stored, prestigeIntermission: null };
  assert.equal(pinIntermissionProgress(closed, sent), sent);
  // Every field the sale resets is frozen, plus the lifetime records.
  for (const field of ["linesOfCode", "money", "employees", "openSourceProjects", "farm", "totalLinesOfCode", "achievements"]) {
    assert.ok(INTERMISSION_FROZEN_FIELDS.includes(field), field);
  }
});

// --- Through the server ---

test("a save during the intermission changes no LOC, money, employees or achievements", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const { playerId, post: postSale } = await soldPlayer(srv);
  srv.advance(2000);
  const res = await post(srv.base, "/api/save", {
    playerId,
    state: withAccrual(postSale),
    actionsSinceLastSave: { ...zeroActions(), clicks: 4 },
  });
  assert.equal(res.status, 200);
  assertCompanyUnchanged((await res.json()).state, postSale, "response");
  assertCompanyUnchanged(await loadState(srv.base, playerId), postSale, "stored");
});

test("a store buy during the intermission changes no LOC, money, employees or achievements", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const { playerId, post: postSale } = await soldPlayer(srv);
  const res = await post(srv.base, "/api/save/store/buy", {
    playerId,
    storeId: "startingCapital",
    rank: 1,
    state: withAccrual(postSale),
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  const bought = (await res.json()).state;
  assert.equal(bought.permanentStoreRanks.startingCapital, 1);
  assertCompanyUnchanged(bought, postSale, "response");
  assertCompanyUnchanged(await loadState(srv.base, playerId), postSale, "stored");
});

test("completion grants exactly the frozen quote, and intermission accrual never carries into the new company", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const { playerId, post: postSale } = await soldPlayer(srv);
  // Buy Starting Capital 1 and the Night Shift Contract in the intermission.
  let state = postSale;
  for (const storeId of ["startingCapital", "nightShiftContract"]) {
    const res = await post(srv.base, "/api/save/store/buy", {
      playerId,
      storeId,
      rank: 1,
      state,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(res.status, 200, storeId);
    state = (await res.json()).state;
  }
  const { frozenHealthyPassiveLocPerSec: R, frozenBestPayoutPerLocCents: q } = postSale.prestigeIntermission;
  const expectedGrant = startingCapitalGrantCents(postSale.money, R, q, 1);
  // A real quote, above the one-Intern floor, so "exactly" means something.
  assert.ok(expectedGrant > BALANCE.employees.intern.baseCost, `grant ${expectedGrant}`);

  const res = await post(srv.base, "/api/save/intermission/complete", {
    playerId,
    state: withAccrual(state),
    actionsSinceLastSave: { ...zeroActions(), clicks: 4 },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const started = body.state;
  assert.equal(started.prestigeIntermission, null);
  assert.equal(started.money, expectedGrant);
  assert.equal(body.grant.cashCents, expectedGrant);
  assert.equal(started.linesOfCode, postSale.linesOfCode);
  assert.equal(started.totalLinesOfCode, postSale.totalLinesOfCode);
  assert.deepEqual(started.employees, postSale.employees);
  assert.deepEqual(started.achievements, postSale.achievements);
  assert.equal(started.nightShiftLevel, 1);
  assert.deepEqual(started.permanentStoreRanks, state.permanentStoreRanks);
  assert.deepEqual(await loadState(srv.base, playerId), started);

  // The new company is a normal company again: progress saves now.
  srv.advance(2000);
  const grown = { ...started, linesOfCode: 4, totalLinesOfCode: started.totalLinesOfCode + 4 };
  const saved = await post(srv.base, "/api/save", {
    playerId,
    state: grown,
    actionsSinceLastSave: { ...zeroActions(), clicks: 4 },
  });
  assert.equal(saved.status, 200);
  assert.equal((await loadState(srv.base, playerId)).linesOfCode, 4);
});

test("a sale cannot start during the intermission, but a retried sale is still already-applied", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const { playerId, post: postSale, saleId } = await soldPlayer(srv);
  // Enough intermission "LOC" for a fourth Equity: still refused.
  const greedy = { ...postSale, linesOfCode: 1e9, totalLinesOfCode: 6.4e8 };
  const res = await post(srv.base, "/api/save/sell", {
    playerId,
    saleId: randomUUID(),
    state: greedy,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.rule, "PRESTIGE");
  assert.match(body.detail, /intermission is open/);
  assertCompanyUnchanged(await loadState(srv.base, playerId), postSale, "stored");
  // The retry of the sale that opened this intermission is still exact.
  const retry = await post(srv.base, "/api/save/sell", {
    playerId,
    saleId,
    state: postSale,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).alreadyApplied, true);
});

test("anti-flood unchanged: intermission saves keep the 1s rate limit, buy and complete keep skipping it", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const { playerId, post: postSale } = await soldPlayer(srv);
  // A save 0s after the sale is a rate-limit 429, as before.
  const tooSoon = await post(srv.base, "/api/save", {
    playerId,
    state: postSale,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(tooSoon.status, 429);
  // A buy and a completion right after the sale are not floods.
  const buy = await post(srv.base, "/api/save/store/buy", {
    playerId,
    storeId: "startingCapital",
    rank: 1,
    state: postSale,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(buy.status, 200);
  const complete = await post(srv.base, "/api/save/intermission/complete", {
    playerId,
    state: (await buy.json()).state,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(complete.status, 200);
});
