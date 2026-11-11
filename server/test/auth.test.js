/**
 * Tests for the Better Auth slice (Slice 3, issue #28): sign-up, sign-in,
 * session, and linking a guest playerId to an account. Runs against the
 * same pg-mem pool as the save tests, with the auth tables created by
 * ensureSchema(). The clock is injected like the save tests.
 *
 * Cookie note: Node's fetch does not persist cookies, so these tests
 * capture the session cookie from sign-in's Set-Cookie header and send it
 * back as a Cookie header — the same cookie the browser client uses.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { createAuth } from "../src/auth.js";
import { initialSaveState } from "../../shared/game-balance.js";

const T0 = 1_700_000_000_000;
const TEST_SECRET = "test-secret-for-auth-tests-only";

async function startTestServer() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = createStore(pool);
  await store.ensureSchema();
  const auth = createAuth(pool, {
    baseURL: "http://localhost:3000",
    secret: TEST_SECRET,
    // pg-mem cannot run Better Auth's schema introspection (it uses
    // `current_schemas` and regex operators), so validation is off here.
    // Production keeps it on. The auth operations below still prove the
    // tables work — a missing column fails the request, not the check.
    validateSchema: false,
  });

  let nowMs = T0;
  const server = createServer(store, { clock: () => nowMs, auth });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    advance(ms) {
      nowMs += ms;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

async function post(base, path, body, extraHeaders = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Better Auth requires an Origin header on POST auth requests
      // (CSRF protection) and it must match the baseURL or a trusted
      // origin. Browsers always send Origin; Node's fetch does not, so
      // the tests send it explicitly. Harmless for the save endpoints.
      origin: "http://localhost:3000",
      ...extraHeaders,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** The session cookie from a sign-up/sign-in response, as a Cookie header. */
function sessionCookie(res) {
  const setCookies = res.headers.getSetCookie();
  assert.ok(setCookies.length > 0, "expected a Set-Cookie header");
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

async function signUp(base, email, password = "TestPassword123!", name = "Test Player") {
  const res = await post(base, "/api/auth/sign-up/email", {
    email,
    password,
    name,
  });
  // Only read the body on failure — reading it here would consume it
  // before the caller can call res.json().
  if (res.status !== 200) {
    assert.fail(`sign-up failed: ${await res.text()}`);
  }
  return res;
}

async function signIn(base, email, password = "TestPassword123!") {
  const res = await post(base, "/api/auth/sign-in/email", { email, password });
  if (res.status !== 200) {
    assert.fail(`sign-in failed: ${await res.text()}`);
  }
  return res;
}

async function mintPlayer(base) {
  const res = await post(base, "/api/player", {});
  assert.equal(res.status, 201);
  return (await res.json()).playerId;
}

test("sign-up, sign-in, and get-session round trip", async () => {
  const srv = await startTestServer();
  try {
    const signedUp = await signUp(srv.base, "player@example.com");
    const signedUpBody = await signedUp.json();
    assert.equal(signedUpBody.user.email, "player@example.com");
    assert.equal(signedUpBody.user.name, "Test Player");
    // No verification gate: sign-up returns a session right away.
    assert.ok(signedUpBody.token, "sign-up should return a session token");

    const cookie = sessionCookie(signedUp);
    const session = await fetch(`${srv.base}/api/auth/get-session`, {
      headers: { cookie },
    });
    assert.equal(session.status, 200);
    const sessionBody = await session.json();
    assert.equal(sessionBody.user.email, "player@example.com");

    // Sign out, then the session is gone.
    const signedOut = await post(
      srv.base,
      "/api/auth/sign-out",
      {},
      { cookie }
    );
    assert.equal(signedOut.status, 200);
    const afterSignOut = await fetch(`${srv.base}/api/auth/get-session`, {
      headers: { cookie },
    });
    assert.equal(afterSignOut.status, 200);
    // get-session returns JSON null (not an object) when there is no session.
    const afterSignOutBody = await afterSignOut.json();
    assert.ok(
      afterSignOutBody === null || afterSignOutBody.session === null,
      "session should be gone after sign-out"
    );

    // Sign back in with the same credentials.
    const signedIn = await signIn(srv.base, "player@example.com");
    const signedInBody = await signedIn.json();
    assert.equal(signedInBody.user.email, "player@example.com");
    const cookie2 = sessionCookie(signedIn);
    const session2 = await fetch(`${srv.base}/api/auth/get-session`, {
      headers: { cookie: cookie2 },
    });
    assert.equal(session2.status, 200);
    assert.equal((await session2.json()).user.email, "player@example.com");

    // Wrong password is rejected.
    const wrong = await post(srv.base, "/api/auth/sign-in/email", {
      email: "player@example.com",
      password: "WrongPassword123!",
    });
    assert.equal(wrong.status, 401);
  } finally {
    await srv.stop();
  }
});

test("link a guest save to an account, read it back, load the save", async () => {
  const srv = await startTestServer();
  try {
    const playerId = await mintPlayer(srv.base);
    const signedUp = await signUp(srv.base, "linker@example.com");
    const cookie = sessionCookie(signedUp);

    // Linking without a session is 401.
    const noSession = await post(srv.base, "/api/account/link", { playerId });
    assert.equal(noSession.status, 401);

    // Link the guest playerId to the account.
    const linked = await post(
      srv.base,
      "/api/account/link",
      { playerId },
      { cookie }
    );
    assert.equal(linked.status, 200);
    assert.deepEqual(await linked.json(), { ok: true, playerId });

    // GET /api/account/link returns the linked playerId.
    const got = await fetch(`${srv.base}/api/account/link`, {
      headers: { cookie },
    });
    assert.equal(got.status, 200);
    assert.deepEqual(await got.json(), { playerId });

    // The save still loads by the guest playerId (saves are unchanged).
    srv.advance(60_000);
    const savedState = {
      ...initialSaveState(),
      linesOfCode: 0,
      totalLinesOfCode: 50,
      money: 3000,
      freelanceProjectsCompleted: {
        toDoListApp: 1,
        hobbyWebsite: 0,
        paradigmShiftingBlockchainProject: 0,
      },
    };
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: savedState,
      actionsSinceLastSave: {
        clicks: 50,
        employeesBought: { intern: 0, junior: 0, senior: 0, projectManager: 0, commitSpecialist: 0 },
        projectsCompleted: {
          toDoListApp: 1,
          hobbyWebsite: 0,
          paradigmShiftingBlockchainProject: 0,
        },
        openSourceLevelsBought: { overReactFramework: 0, blocker: 0 },
      },
    });
    assert.equal(saved.status, 200);
    const loaded = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
    assert.equal(loaded.status, 200);
    assert.deepEqual((await loaded.json()).state, savedState);

    // Linking the same playerId to the same account again is a no-op ok.
    const relink = await post(
      srv.base,
      "/api/account/link",
      { playerId },
      { cookie }
    );
    assert.equal(relink.status, 200);

    // Unlink, then the link is gone.
    const unlinked = await post(srv.base, "/api/account/unlink", {}, { cookie });
    assert.equal(unlinked.status, 200);
    assert.deepEqual(await unlinked.json(), { ok: true, playerId });
    const afterUnlink = await fetch(`${srv.base}/api/account/link`, {
      headers: { cookie },
    });
    assert.equal(afterUnlink.status, 404);
    assert.equal((await afterUnlink.json()).error, "not-linked");
  } finally {
    await srv.stop();
  }
});

test("link conflicts: one player to one account, one account to one player", async () => {
  const srv = await startTestServer();
  try {
    const playerA = await mintPlayer(srv.base);
    const playerB = await mintPlayer(srv.base);
    const cookie1 = sessionCookie(await signUp(srv.base, "one@example.com"));
    const cookie2 = sessionCookie(await signUp(srv.base, "two@example.com"));

    // User 1 links player A.
    const linkA = await post(
      srv.base,
      "/api/account/link",
      { playerId: playerA },
      { cookie: cookie1 }
    );
    assert.equal(linkA.status, 200);

    // User 2 cannot link the same player A (already linked to user 1).
    const conflictPlayer = await post(
      srv.base,
      "/api/account/link",
      { playerId: playerA },
      { cookie: cookie2 }
    );
    assert.equal(conflictPlayer.status, 409);
    assert.equal((await conflictPlayer.json()).reason, "player-linked");

    // User 1 cannot link a second player B (already linked to A).
    const conflictUser = await post(
      srv.base,
      "/api/account/link",
      { playerId: playerB },
      { cookie: cookie1 }
    );
    assert.equal(conflictUser.status, 409);
    assert.equal((await conflictUser.json()).reason, "user-linked");

    // Linking an unknown playerId is 404.
    const unknown = await post(
      srv.base,
      "/api/account/link",
      { playerId: "123e4567-e89b-42d3-a456-426614174000" },
      { cookie: cookie2 }
    );
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, "unknown-player");

    // A malformed playerId is 400.
    const bad = await post(
      srv.base,
      "/api/account/link",
      { playerId: "nope" },
      { cookie: cookie2 }
    );
    assert.equal(bad.status, 400);
  } finally {
    await srv.stop();
  }
});

test("guests still work with no account at all", async () => {
  const srv = await startTestServer();
  try {
    // No session anywhere: mint, save, and load all work as before.
    const playerId = await mintPlayer(srv.base);
    const loaded = await fetch(`${srv.base}/api/load?playerId=${playerId}`);
    assert.equal(loaded.status, 200);
    assert.deepEqual((await loaded.json()).state, initialSaveState());

    // But the account endpoints need a session.
    const getLink = await fetch(`${srv.base}/api/account/link`);
    assert.equal(getLink.status, 401);
    const unlink = await post(srv.base, "/api/account/unlink", {});
    assert.equal(unlink.status, 401);
  } finally {
    await srv.stop();
  }
});
