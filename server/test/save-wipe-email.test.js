/**
 * Tests for the save wipe explanation mail (issue #172).
 *
 * When lockSaveRow (server/src/store.js) wipes a row stored under an
 * older schema, the fresh state's inbox holds ONE unread mail saying
 * why: the Funding Rounds rebalance reset every company, not just
 * this one. A brand-new player (a mint) was never reset and gets no
 * such mail. The mail has a fixed trigger key (save-wipe:v2), so it
 * appears once: loading and saving the wiped save again never adds a
 * second copy. The wipe itself is unchanged (pinned in
 * funding-rounds.test.js).
 *
 * Issue #192 (Bridge Rounds, the Ship Happens gate) bumped the schema
 * to 3 with the same mechanism: every row below 3 is wiped and gets the
 * v3 mail (save-wipe:v3), whether it was a v2 row or an older one. The
 * v2 mail stays defined; no live wipe sends it any more.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore, SAVE_SCHEMA_VERSION } from "../src/store.js";
import { createServer } from "../src/server.js";
import {
  EMAIL_CONFIG,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_KEYS,
  OPEN_SOURCE_IDS,
  buildSaveWipeEmail,
  initialSaveState,
  saveWipeEmailTriggerKey,
  wipedSaveState,
} from "../../shared/game-balance.js";
import { addEmail, unreadEmailCount } from "../../client/src/email/email.js";
import {
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";

const T0 = 1_700_000_000_000;
const WIPE_KEY = "save-wipe:v3";

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
    body: JSON.stringify(body),
  });
}

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
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
 * Age a player's row to an older schema. Default: a live v2 row (the
 * deploy case for issue #192), holding Ship Happens above its new
 * Bootstrapped cap, the exact save the wipe exists to replace.
 */
async function ageRow(srv, playerId, version = 2) {
  const old = initialSaveState();
  old.totalLinesOfCode = 353_500_000_000;
  old.linesOfCode = 1_000_000;
  old.openSourceProjects = { ...old.openSourceProjects, shipHappens: 10 };
  await srv.pool.query(
    `UPDATE git_saves SET state = $1, schema_version = $2 WHERE player_id = $3`,
    [JSON.stringify(old), version, playerId]
  );
  return old;
}

function wipeMails(state) {
  return (state.emails ?? []).filter((entry) => entry.triggerKey === WIPE_KEY);
}

// --- The mail itself ---

test("the v3 wipe mail (issue #192): GitNub, fixed key, says what happened in plain terms, no dashes", () => {
  assert.equal(SAVE_SCHEMA_VERSION, 3);
  assert.equal(saveWipeEmailTriggerKey(3), WIPE_KEY);
  const mail = buildSaveWipeEmail(3);
  assert.equal(mail.sender, "GitNub");
  // Plain terms: everyone was reset, it is not a bug, and what changed.
  assert.match(mail.body, /Every save was reset at the same time/);
  assert.match(mail.body, /Not a bug, not your fault, and not just you/);
  assert.match(mail.body, /Bridge Round/);
  assert.match(mail.body, /Ship Happens/);
  assert.match(mail.body, /with Equity after a sale/);
  for (const text of [mail.sender, mail.subject, mail.body]) {
    assert.ok(!text.includes("—"), "no em dash");
    assert.ok(!text.includes("–"), "no en dash");
  }
  assert.ok(mail.subject.length <= EMAIL_CONFIG.maxSubjectLength);
  assert.ok(mail.body.length <= EMAIL_CONFIG.maxBodyLength);
  assert.notEqual(mail.subject, buildSaveWipeEmail(2).subject);
});

test("the v2 wipe mail: GitNub, fixed key, says what happened in plain terms, no em dashes", () => {
  assert.equal(saveWipeEmailTriggerKey(2), "save-wipe:v2");
  const mail = buildSaveWipeEmail(2);
  assert.equal(mail.sender, "GitNub");
  // The three things the issue says it must say.
  assert.match(mail.body, /rebalance/);
  assert.match(mail.body, /Funding Rounds/);
  assert.match(mail.body, /every company was reset, and you are starting fresh/);
  assert.match(mail.body, /every single player was reset/);
  for (const text of [mail.sender, mail.subject, mail.body]) {
    assert.ok(!text.includes("—"), "no em dash");
    assert.ok(!text.includes("–"), "no en dash");
  }
  assert.ok(mail.subject.length <= EMAIL_CONFIG.maxSubjectLength);
  assert.ok(mail.body.length <= EMAIL_CONFIG.maxBodyLength);
});

test("wipedSaveState is the fresh company plus exactly one unread wipe mail", () => {
  const id = "123e4567-e89b-42d3-a456-426614174099";
  const state = wipedSaveState(3, { emailId: id, nowMs: T0 });
  const { emails, ...rest } = state;
  const { emails: freshEmails, ...fresh } = initialSaveState();
  assert.deepEqual(freshEmails, []);
  assert.deepEqual(rest, fresh);
  assert.deepEqual(emails, [
    { id, triggerKey: WIPE_KEY, ...buildSaveWipeEmail(3), createdAtMs: T0, read: false },
  ]);
});

test("a schema version without a wipe mail wipes silently (reusable per version)", () => {
  assert.equal(buildSaveWipeEmail(1), null);
  assert.equal(buildSaveWipeEmail(99), null);
  assert.deepEqual(
    wipedSaveState(99, { emailId: "123e4567-e89b-42d3-a456-426614174099", nowMs: T0 }),
    initialSaveState()
  );
  // No id, no mail (never a record the shape check would reject).
  assert.deepEqual(wipedSaveState(3, { nowMs: T0 }), initialSaveState());
});

// --- Through the server ---

test("a freshly minted save does not get the wipe mail", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const loaded = await loadState(srv.base, playerId);
  assert.deepEqual(loaded.emails, []);
  assert.deepEqual(loaded, initialSaveState());
});

test("a progress reset (Danger Zone) does not get the wipe mail either", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  srv.advance(2000);
  const res = await post(srv.base, "/api/save/reset", { playerId });
  assert.equal(res.status, 200);
  assert.deepEqual((await loadState(srv.base, playerId)).emails, []);
});

test("a wiped save's fresh state holds the explanation mail, unread, on first load", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  await ageRow(srv, playerId);
  const loaded = await loadState(srv.base, playerId);
  assert.equal(loaded.totalLinesOfCode, 0, "still wiped to a fresh company");
  assert.equal(loaded.emails.length, 1);
  const [mail] = loaded.emails;
  assert.equal(mail.triggerKey, WIPE_KEY);
  assert.equal(mail.read, false);
  assert.equal(mail.sender, "GitNub");
  assert.equal(mail.subject, buildSaveWipeEmail(3).subject);
  assert.equal(mail.createdAtMs, T0);
  // The client sees it as one unread mail in the inbox.
  const client = saveStateToGameFields(loaded);
  assert.equal(unreadEmailCount(client.emails), 1);
  // Wholesale: the over-cap Ship Happens level is gone with the rest.
  assert.equal(loaded.openSourceProjects.shipHappens, 0);
});

test("a row older than v2 is wiped to v3 too, with the v3 mail only (one mail, not two)", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  await ageRow(srv, playerId, 1);
  const loaded = await loadState(srv.base, playerId);
  assert.equal(loaded.totalLinesOfCode, 0);
  assert.deepEqual(
    loaded.emails.map((entry) => entry.triggerKey),
    [WIPE_KEY]
  );
});

test("the wipe mail appears once: repeated loads and saves never duplicate it", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  await ageRow(srv, playerId);
  const first = await loadState(srv.base, playerId);
  const id = wipeMails(first)[0].id;
  // Load again and again: the row is current now, so no second wipe.
  for (let i = 0; i < 3; i += 1) {
    const again = await loadState(srv.base, playerId);
    assert.equal(wipeMails(again).length, 1);
    assert.equal(wipeMails(again)[0].id, id);
  }
  // Save the loaded state back (the client's heartbeat), several
  // times, through the client's own serializer: still one mail.
  let saveState = stateToSaveState(saveStateToGameFields(first));
  for (let i = 0; i < 3; i += 1) {
    srv.advance(2000);
    const res = await post(srv.base, "/api/save", {
      playerId,
      state: saveState,
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const loaded = await loadState(srv.base, playerId);
    assert.equal(wipeMails(loaded).length, 1);
    assert.equal(wipeMails(loaded)[0].id, id);
    saveState = loaded;
  }
  // The client inbox dedupes by trigger key too: re-filing the same
  // mail is a no-op.
  const refiled = addEmail(saveState.emails, buildSaveWipeEmail(3), WIPE_KEY, T0);
  assert.equal(refiled.added, null);
  assert.equal(wipeMails({ emails: refiled.emails }).length, 1);
  // Opening it (read: true) is an ordinary save.
  srv.advance(2000);
  const read = {
    ...saveState,
    emails: saveState.emails.map((entry) => ({ ...entry, read: true })),
  };
  const res = await post(srv.base, "/api/save", {
    playerId,
    state: read,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 200);
  const after = await loadState(srv.base, playerId);
  assert.equal(wipeMails(after).length, 1);
  assert.equal(wipeMails(after)[0].read, true);
});

test("a write that triggers the wipe hands back the fresh state with the mail, and it is not re-sent", async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());
  const playerId = await mintPlayer(srv.base);
  const old = await ageRow(srv, playerId);
  srv.advance(2000);
  const res = await post(srv.base, "/api/save", {
    playerId,
    state: old,
    actionsSinceLastSave: zeroActions(),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.rule, "WIPE");
  // The 409's fresh state (what the client restores) carries the mail.
  const reverted = wipeMails(body.lastGoodState.state);
  assert.equal(reverted.length, 1);
  assert.equal(reverted[0].read, false);
  // And the stored row is that same state: same mail, same id.
  const loaded = await loadState(srv.base, playerId);
  assert.equal(wipeMails(loaded).length, 1);
  assert.equal(wipeMails(loaded)[0].id, reverted[0].id);
});
