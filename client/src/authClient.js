/**
 * Better Auth client (Slice 3, issue #28) + the custom account-link
 * endpoints. Optional accounts only — guests stay the default identity
 * (anonymous UUID in localStorage, see save/api.js).
 *
 * Cross-origin sessions: the client is on vercel.app, the API on
 * grq-save.qcfailed.com (different sites), so every auth request sends
 * `credentials: "include"` and the session cookie is `SameSite=None;
 * Secure` in production. Where the browser blocks third-party cookies
 * (Safari by default), the session will not persist and the player
 * simply stays a guest — sign-in still succeeds, the link just does
 * not stick. A same-origin proxy (issue #30, Cloudflare) is the
 * long-term fix.
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
