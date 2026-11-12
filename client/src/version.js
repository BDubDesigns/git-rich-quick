/**
 * Build-time version info, injected by Vite (see client/vite.config.js).
 *
 * __APP_COMMIT__ is the short git commit of the deployed build
 * (VERCEL_GIT_COMMIT_SHA on Vercel, GITHUB_SHA in CI, "dev" locally);
 * __APP_BUILD_TIME__ is the build timestamp (ISO). Shown in Settings so
 * a player can confirm which code they are running — e.g. whether a
 * fix has actually reached them, or their browser is holding an old
 * cached bundle. The `typeof` guard keeps this safe if the defines are
 * ever absent (a build that does not set them) — the version reads
 * "dev" instead of throwing.
 */

/* global __APP_COMMIT__ __APP_BUILD_TIME__ */

export const APP_COMMIT =
  typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "dev";
export const APP_BUILD_TIME =
  typeof __APP_BUILD_TIME__ !== "undefined" ? __APP_BUILD_TIME__ : null;

/**
 * Short human-readable build time in the browser's local timezone
 * (e.g. "Nov 11, 6:24 PM"), or null when no build time is available.
 */
export function buildTimeLabel() {
  if (!APP_BUILD_TIME) return null;
  const d = new Date(APP_BUILD_TIME);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
