/**
 * Stale-client guard (test helper): the save server refuses a
 * state-writing request without a `clientBuild` (rule STALE_CLIENT,
 * see server/src/validate.js clientBuildError). Tests that post saves
 * straight to the HTTP API run their bodies through withClientBuild so
 * they identify as a current client, the same as the real client does.
 *
 * Not a test file itself (the suite runs test/*.test.js).
 */

/** The build id test requests carry. Any non-empty string is accepted. */
export const TEST_CLIENT_BUILD = "test-build";

/** Endpoints that write state and so require a clientBuild. */
const STATE_WRITE_PATHS = new Set([
  "/api/save",
  "/api/save/sell",
  "/api/save/store/buy",
  "/api/save/intermission/complete",
]);

/**
 * `body` with `clientBuild: TEST_CLIENT_BUILD` added, for a
 * state-writing path. A body that already names clientBuild (even as
 * undefined, to test a missing one) is left alone, as is any non-object
 * body (a raw string for a bad-JSON test) and any other path.
 */
export function withClientBuild(path, body) {
  if (
    !STATE_WRITE_PATHS.has(path) ||
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.prototype.hasOwnProperty.call(body, "clientBuild")
  ) {
    return body;
  }
  return { ...body, clientBuild: TEST_CLIENT_BUILD };
}
