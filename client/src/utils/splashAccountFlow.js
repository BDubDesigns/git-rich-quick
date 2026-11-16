/**
 * Sign in / create account from the splash screen (issue #140).
 *
 * Framework-free, with every side effect injected, so the server tests
 * can run it without better-auth or a browser. The splash wires in the
 * real functions from authClient.js and save/api.js.
 *
 * While the splash is up, the save engine has already minted a fresh
 * guest save in the background (the splash only shows when there is no
 * stored player id), so there is never a guest save worth migrating.
 *
 * - Sign in, account HAS a linked save: store the linked player id and
 *   ask the caller to reload, so the save engine boots from it (the
 *   same mechanism as Settings' "Load linked save").
 * - Sign in with no linked save, or create account: link the fresh
 *   guest save to the account and start the game.
 * Linking is best effort: if it fails (no guest id yet, server down),
 * the game still starts, and the result says so, so the player can
 * link later in Settings.
 *
 * Returns one of:
 *   { ok: false, error }                 auth failed; stay on the splash
 *   { ok: true, action: "load", playerId } reload into the linked save
 *   { ok: true, action: "start", linked } start; linked is a boolean
 */
export async function runSplashAccountFlow(fields, deps) {
  let auth;
  try {
    auth = await deps.submitAccountForm(fields);
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
  if (!auth || auth.error) {
    return {
      ok: false,
      error: auth?.error?.message ?? "Could not reach the account server.",
    };
  }

  let linkedPlayerId = null;
  try {
    linkedPlayerId = await deps.getLinkedPlayerId();
  } catch {
    linkedPlayerId = null;
  }
  if (linkedPlayerId) {
    if (deps.setStoredPlayerId(linkedPlayerId)) {
      return { ok: true, action: "load", playerId: linkedPlayerId };
    }
    // The browser would not store the id: play on as this guest.
    return { ok: true, action: "start", linked: false };
  }

  const guestPlayerId = deps.getGuestPlayerId();
  if (!guestPlayerId) return { ok: true, action: "start", linked: false };
  try {
    const { status } = await deps.linkSaveToAccount(guestPlayerId);
    return { ok: true, action: "start", linked: status === 200 };
  } catch {
    return { ok: true, action: "start", linked: false };
  }
}
