/**
 * New-version check for the stale-client guard.
 *
 * Every build writes `version.json` (`{ "buildId": "..." }`) next to
 * index.html, carrying the same id the bundle was built with
 * (__BUILD_ID__, see client/vite.config.js). Before a save the engine
 * fetches it (throttled, see SaveSync.checkForNewVersion); an id that
 * differs from the running bundle's means a newer version is deployed,
 * so this tab stops saving and asks the player to reload, instead of
 * writing its older idea of the game over the server copy.
 *
 * Plain JS (no React), so the engine stays testable in Node.
 */

/** Where the deployed build id lives, relative to the page origin. */
export const VERSION_JSON_PATH = "/version.json";

/** The version fetch gives up after this long (counts as "unknown"). */
const VERSION_FETCH_TIMEOUT_MS = 5_000;

/**
 * The deployed build id, or null when it cannot be told: offline, a
 * timeout, a 404, or a body that is not `{ buildId: "<non-empty>" }`
 * (`vite dev` answers an unknown path with index.html). Null means
 * "save normally", so local dev and offline play keep working. Never
 * throws.
 */
export async function fetchDeployedBuildId(
  url = VERSION_JSON_PATH,
  fetchFn = globalThis.fetch
) {
  try {
    const res = await fetchFn(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(VERSION_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data?.buildId;
    return typeof id === "string" && id.trim() !== "" ? id : null;
  } catch {
    return null;
  }
}

/**
 * The default deployed-build lookup for SaveSync: version.json from the
 * page origin in a browser, none in Node (tests and scripts have no
 * page to compare against, so they always save).
 */
export function defaultFetchDeployedBuild() {
  if (typeof window === "undefined" || typeof globalThis.fetch !== "function") {
    return null;
  }
  return () => fetchDeployedBuildId(VERSION_JSON_PATH);
}
