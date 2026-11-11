/**
 * Admin endpoints for Git Rich Quick (issue #46, seed endpoint; issue
 * #45, read-only admin API). The admin surface is for jellybean's
 * autonomous verification and debugging against the live save service.
 * It is token-protected, never in the repo, and audit-logged.
 *
 * GUARDRAIL DISTINCTION (read this before touching either side):
 * - The SEED endpoint is test-player-only: it only ever touches a save
 *   row linked to the ONE test account (email jaybles@qcfailed.com —
 *   see TEST_ACCOUNT_EMAIL below). A real player's save can never be
 *   seeded, even with a valid admin token.
 * - The READ-ONLY endpoints (player, rejected-saves, stats) MAY read a
 *   real player's save — that is their purpose (debugging a specific
 *   player's issue, by explicit playerId). They are still
 *   token-protected and audit-logged, they never modify or delete
 *   anything, and there is no bulk/list-all-players endpoint: a
 *   player's data is only pulled up by explicit playerId, never
 *   browsed.
 *
 * Env: ADMIN_TOKEN (bearer token, set in Coolify; also in jellybean's
 * Secure Vault). When it is unset the admin endpoints answer 501.
 */

import { timingSafeEqual } from "node:crypto";

/** The one test account. See the guardrail note above. */
export const TEST_ACCOUNT_EMAIL = "jaybles@qcfailed.com";

/**
 * Constant-time bearer-token check. `adminToken` is the configured
 * ADMIN_TOKEN (falsy when unconfigured). Returns false for a missing,
 * malformed, or wrong Authorization header — the caller maps that to
 * 401, and a missing configuration to 501.
 */
export function isAdminAuthorized(req, adminToken) {
  if (!adminToken) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  const provided = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(adminToken, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
