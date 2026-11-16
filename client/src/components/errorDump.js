/**
 * Error-report helpers for the ErrorBoundary.
 *
 * Plain JS, no React and no GameContext, so the boundary can use it
 * even when a provider crashes. The dump contains ONLY what a support
 * report needs: the error message, the component stack, the app
 * version, a timestamp, and the player id. It NEVER includes auth
 * tokens, session tokens, passwords, the full save state, or any
 * credential.
 */

import { APP_COMMIT, buildTimeLabel } from "../version.js";

/** The signed-in account name that gets the full error dump.
 *  Brandon's account signs up as "Brandon" (the leaderboard display
 *  name). Any account with this name matches: the dump holds no
 *  secrets, so a match is harmless. The gate only keeps the dump out
 *  of other players' crash screens; it is not a security boundary. */
export const BRANDON_ACCOUNT_NAME = "Brandon";

/** Short player id, same shape as the Settings diagnostics dump:
 *  first 8 chars, an ellipsis, last 4. */
export function shortId(id) {
  if (!id) return "-";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/**
 * Plain-text error report for support (Copy error details). Compact
 * and greppable, same shape as the Settings diagnostics dump. No em
 * dashes in the copy.
 */
export function buildErrorDump({ error, errorInfo, errorAt, playerId }) {
  const message =
    error && typeof error.message === "string" && error.message
      ? error.message
      : String(error ?? "Unknown error");
  const stack =
    errorInfo &&
    typeof errorInfo.componentStack === "string" &&
    errorInfo.componentStack.trim()
      ? errorInfo.componentStack.trim()
      : "(no component stack)";
  const lines = [
    "Git Rich Quick error report",
    `Version ${APP_COMMIT}${buildTimeLabel() ? ` · built ${buildTimeLabel()}` : ""}`,
    `Player ${playerId ? shortId(playerId) : "-"}`,
    `At ${errorAt ?? "unknown"}`,
    `Error: ${message}`,
    "Component stack:",
    stack,
  ];
  return lines.join("\n");
}

/**
 * Copy text to the clipboard. Prefers the async clipboard API; falls
 * back to a hidden textarea + execCommand for contexts without it
 * (older browsers, non-secure contexts). Same pattern as Settings.
 */
export async function copyTextToClipboard(text) {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Decide whether the crash screen shows the error dump, from the
 * Better Auth session. `getSession` is injected (the boundary passes
 * authClient.getSession) so this stays testable without the client.
 *
 * Returns "brandon" when the signed-in account is Brandon's, "other"
 * for any other signed-in account, and "unknown" when there is no
 * session or the check fails. "unknown" shows the dump too: the dump
 * must never be hidden from Brandon because an identity check
 * failed, and a guest has no account to identify anyway.
 */
export async function resolveSessionState(getSession) {
  try {
    const res = await getSession();
    const user = res?.data?.user ?? null;
    if (!user) return "unknown";
    return user.name === BRANDON_ACCOUNT_NAME ? "brandon" : "other";
  } catch {
    return "unknown";
  }
}
