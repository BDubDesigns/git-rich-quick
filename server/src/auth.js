/**
 * Better Auth instance for Git Rich Quick (Slice 3, issue #28).
 *
 * Email + password, optional accounts. Guests stay the default identity
 * (anonymous UUID); an account only links to a guest playerId so a save
 * survives clearing browser data or switching devices.
 *
 * Decisions (Brandon, Nov 9):
 * - Email verification does NOT gate signup. There is no trading, so
 *   multiple accounts give no in-game advantage. Email is only the
 *   recovery path (password reset), sent via Zoho when that is wired.
 *   `requireEmailVerification: false` and no verification email is sent
 *   in v1 (no email provider configured yet).
 * - Raw `pg` Pool as the database (Better Auth's built-in Kysely
 *   adapter). No Drizzle, no Prisma, no extra ORM — the server is plain
 *   Node + pg, and the Pool is shared with the save store.
 * - Cross-origin sessions: the client is on vercel.app, the API on
 *   grq-save.qcfailed.com (different sites). In production the session
 *   cookie is `SameSite=None; Secure` and the client sends
 *   `credentials: "include"`. In local dev (http) it falls back to
 *   `SameSite=Lax` without Secure, which works same-site on localhost.
 *   Caveat: browsers that block third-party cookies (Safari by default)
 *   will not persist the cross-site session; the guest fallback still
 *   works there. A same-origin proxy (issue #30, Cloudflare) is the
 *   long-term fix.
 *
 * Env: BETTER_AUTH_SECRET (required in production), BETTER_AUTH_URL
 * (public API URL, e.g. https://grq-save.qcfailed.com). In dev both fall
 * back to local defaults with a warning — never ship a default secret.
 */

import { betterAuth } from "better-auth";

const DEV_SECRET = "grq-dev-secret-do-not-use-in-production";
const DEV_BASE_URL = "http://localhost:3000";

/** Client origins allowed to use auth. Wildcards cover Vercel previews. */
export function defaultTrustedOrigins() {
  return [
    "https://gitrichquick.vercel.app",
    "https://*.vercel.app",
    "http://localhost:5173",
    "http://localhost:4173",
  ];
}

function isHttps(url) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function createAuth(
  pool,
  {
    baseURL = process.env.BETTER_AUTH_URL ?? DEV_BASE_URL,
    secret = process.env.BETTER_AUTH_SECRET ?? DEV_SECRET,
    trustedOrigins = defaultTrustedOrigins(),
    // Better Auth validates the auth tables against the live database on
    // first use (and per request). Real Postgres supports the
    // introspection it needs; pg-mem (used by the tests) does not
    // (`current_schemas`, regex operators), so the tests pass false.
    // Keep it true everywhere else — it catches real schema drift.
    validateSchema = true,
  } = {}
) {
  const secure = isHttps(baseURL);
  if (secret === DEV_SECRET) {
    console.warn(
      "[auth] BETTER_AUTH_SECRET is not set; using a dev-only default. Set a real secret in production."
    );
  }
  return betterAuth({
    database: pool,
    secret,
    baseURL,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      // No verification gate (Brandon, Nov 9): signup links the save
      // right away; email is only the password-reset safety net.
      requireEmailVerification: false,
    },
    advanced: {
      database: { validateSchema },
      defaultCookieAttributes: secure
        ? { sameSite: "none", secure: true }
        : { sameSite: "lax", secure: false },
    },
  });
}
