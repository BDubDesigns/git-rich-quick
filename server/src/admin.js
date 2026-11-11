/**
 * Admin endpoints for Git Rich Quick (issue #46, seed endpoint; the same
 * bearer-token auth serves the read-only admin API, issue #45, next).
 *
 * The admin surface is for jellybean's autonomous verification against
 * the live save service. It is token-protected, never in the repo, and
 * test-player-only: no admin endpoint can read or modify a real player's
 * save.
 *
 * TEST-PLAYER GUARDRAIL (issue #46, Brandon Nov 10): there is ONE test
 * player, the jellybean account, email jaybles@qcfailed.com. The seed
 * endpoint only ever touches a save row linked to that account. The
 * email is a hardcoded constant on purpose — widening it to another
 * account must be a deliberate code change with review, never an env
 * var someone sets by accident. A save that is not linked to the test
 * account (a guest, or any other account) is not a test player and can
 * never be seeded.
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
