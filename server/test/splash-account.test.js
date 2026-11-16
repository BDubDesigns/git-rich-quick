/**
 * Tests for sign in / create account from the splash (issue #140):
 * client/src/utils/splashAccountFlow.js, with every side effect
 * injected (no better-auth, no browser).
 *
 * - Sign in, account has a linked save: store that id and reload into it.
 * - Sign in with no linked save, or create account: link the fresh guest
 *   save and start. Linking is best effort; the game still starts.
 * - Auth failure: stay on the splash with the error.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSplashAccountFlow } from "../../client/src/utils/splashAccountFlow.js";

const GUEST = "11111111-1111-4111-8111-111111111111";
const LINKED = "22222222-2222-4222-8222-222222222222";

/** Fake deps that record what the flow did. */
function deps(overrides = {}) {
  const calls = { submitted: null, stored: null, linked: null };
  return {
    calls,
    submitAccountForm: async (fields) => {
      calls.submitted = fields;
      return { data: { user: {} }, error: null };
    },
    getLinkedPlayerId: async () => null,
    getGuestPlayerId: () => GUEST,
    linkSaveToAccount: async (playerId) => {
      calls.linked = playerId;
      return { status: 200, data: { ok: true, playerId } };
    },
    setStoredPlayerId: (playerId) => {
      calls.stored = playerId;
      return true;
    },
    ...overrides,
  };
}

const SIGNIN = { mode: "signin", email: "a@example.test", password: "password123" };
const SIGNUP = { mode: "signup", email: "b@example.test", password: "password123", name: "" };

test("sign in with a linked save: store it and reload into it, no linking", async () => {
  const d = deps({ getLinkedPlayerId: async () => LINKED });
  const result = await runSplashAccountFlow(SIGNIN, d);
  assert.deepEqual(result, { ok: true, action: "load", playerId: LINKED });
  assert.equal(d.calls.stored, LINKED);
  assert.equal(d.calls.linked, null);
  assert.deepEqual(d.calls.submitted, SIGNIN);
});

test("sign in with no linked save: link the fresh guest save and start", async () => {
  const d = deps();
  const result = await runSplashAccountFlow(SIGNIN, d);
  assert.deepEqual(result, { ok: true, action: "start", linked: true });
  assert.equal(d.calls.linked, GUEST);
  assert.equal(d.calls.stored, null);
});

test("create account: link the fresh guest save and start", async () => {
  const d = deps();
  const result = await runSplashAccountFlow(SIGNUP, d);
  assert.deepEqual(result, { ok: true, action: "start", linked: true });
  assert.equal(d.calls.linked, GUEST);
  assert.equal(d.calls.submitted.mode, "signup");
});

test("a failed sign in stays on the splash with the server's message", async () => {
  const d = deps({
    submitAccountForm: async () => ({ data: null, error: { message: "Invalid email or password" } }),
  });
  const result = await runSplashAccountFlow(SIGNIN, d);
  assert.deepEqual(result, { ok: false, error: "Invalid email or password" });
  assert.equal(d.calls.linked, null);
  assert.equal(d.calls.stored, null);
});

test("a network failure during auth is an error, never a crash", async () => {
  const d = deps({
    submitAccountForm: async () => {
      throw new Error("Failed to fetch");
    },
  });
  assert.deepEqual(await runSplashAccountFlow(SIGNIN, d), {
    ok: false,
    error: "Failed to fetch",
  });
});

test("linking is best effort: no guest id, a 409, or a thrown link still starts the game", async () => {
  assert.deepEqual(
    await runSplashAccountFlow(SIGNUP, deps({ getGuestPlayerId: () => null })),
    { ok: true, action: "start", linked: false }
  );
  assert.deepEqual(
    await runSplashAccountFlow(
      SIGNUP,
      deps({ linkSaveToAccount: async () => ({ status: 409, data: { reason: "user-linked" } }) })
    ),
    { ok: true, action: "start", linked: false }
  );
  assert.deepEqual(
    await runSplashAccountFlow(
      SIGNUP,
      deps({
        linkSaveToAccount: async () => {
          throw new Error("down");
        },
      })
    ),
    { ok: true, action: "start", linked: false }
  );
});

test("a browser that will not store the linked id plays on as the guest", async () => {
  const d = deps({
    getLinkedPlayerId: async () => LINKED,
    setStoredPlayerId: () => false,
  });
  assert.deepEqual(await runSplashAccountFlow(SIGNIN, d), {
    ok: true,
    action: "start",
    linked: false,
  });
});

test("the splash keeps guest as the primary action and reuses the shared form", () => {
  const src = (path) =>
    readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
  const splash = src("components/SplashScreen.jsx");
  const settings = src("components/Settings.jsx");
  // The green npm start button comes before the account options.
  assert.ok(splash.indexOf("game-button--success") < splash.indexOf("<AccountForm"));
  // Both screens render the one shared form and the one submit helper.
  assert.match(splash, /<AccountForm/);
  assert.match(settings, /<AccountForm/);
  assert.match(settings, /submitAccountForm\(fields\)/);
  assert.doesNotMatch(settings, /signUp\.email|signIn\.email/);
  for (const text of [splash, src("components/AccountForm.jsx")]) {
    assert.ok(!text.includes("—"));
  }
});
