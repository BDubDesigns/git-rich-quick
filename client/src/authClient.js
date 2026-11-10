/**
 * Better Auth client (Slice 3, issue #28) + the custom account-link
 * endpoints. Optional accounts only — guests stay the default identity
 * (anonymous UUID in localStorage, see save/api.js).
 *
 * Same-origin sessions (Slice 3, issue #28): the client calls the API
 * through its own origin — in production and on Vercel previews the
 * rewrite in vercel.json proxies /api/* to grq-save.qcfailed.com, and
 * in local dev the Vite dev-server proxy forwards /api/* to the local
 * backend. So the session cookie is FIRST-party (set for the page's own
 * domain), which Safari accepts — the old cross-site setup (client on
 * vercel.app, API on qcfailed.com) was blocked by Safari's
 * third-party-cookie blocking and left Safari players as guests.
 * `credentials: "include"` is kept: it is the default for same-origin
 * fetch anyway, and it is required if the client is ever pointed
 * directly at the backend (cross-origin) instead of through the proxy.
 * Pointing VITE_SAVE_API_URL directly at the backend (bypassing the
 * proxy) still works, but then the cookie is cross-site again and
 * Safari will not persist it.
 *
 * The link endpoints are custom (not Better Auth's): they attach the
 * guest playerId to the signed-in account so a save survives clearing
 * browser data or switching devices. v1 links to ONE guest playerId;
 * there is no cross-platform save beyond that.
 */

import { createAuthClient } from "better-auth/react";
import { SAVE_API_URL, PLAYER_ID_KEY } from "./save/api.js";

export const authClient = createAuthClient({
  baseURL: SAVE_API_URL,
  fetchOptions: {
    // Send the cross-site session cookie (see header comment).
    credentials: "include",
  },
});

export const { signUp, signIn, signOut, useSession } = authClient;

async function accountRequest(path, { method = "GET", body } = {}) {
  const res = await fetch(`${SAVE_API_URL}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { status: res.status, data };
}

/**
 * Link the current guest playerId to the signed-in account.
 * Returns `{ status, data }` — 200 `{ ok: true, playerId }`,
 * 401 (not signed in), 404 (unknown playerId),
 * 409 `{ reason: "player-linked" | "user-linked" }`.
 */
export async function linkSaveToAccount(playerId) {
  return accountRequest("/api/account/link", {
    method: "POST",
    body: { playerId },
  });
}

/** The playerId linked to the signed-in account, or null if none. */
export async function getLinkedPlayerId() {
  const { status, data } = await accountRequest("/api/account/link");
  if (status === 200) return data.playerId;
  return null;
}

/** Remove the link between the account and its guest save. */
export async function unlinkSaveFromAccount() {
  return accountRequest("/api/account/unlink", { method: "POST", body: {} });
}

/** The guest playerId this browser is currently playing as, or null. */
export function currentGuestPlayerId() {
  try {
    return localStorage.getItem(PLAYER_ID_KEY);
  } catch {
    return null;
  }
}
