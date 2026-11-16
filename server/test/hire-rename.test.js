/**
 * Tests for the Shop to Hire rename (issue #130): the bottom-nav label
 * reads "Hire" while the tab id stays "shop" (a display-label change
 * only, no identifier churn), and no player-facing tab or section name
 * says "Shop".
 *
 * gameConfig.js imports react-icons, which the server test environment
 * does not install, so these read the source text instead of importing
 * it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameConfig = readFileSync(
  new URL("../../client/src/context/gameConfig.js", import.meta.url),
  "utf8"
);

test("the bottom-nav tab is labeled Hire and keeps the id shop", () => {
  assert.match(
    gameConfig,
    /\{ id: "shop", label: "Hire", Icon: FaPeopleGroup \}/
  );
});

test("no nav label or section display name says Shop", () => {
  const labels = [...gameConfig.matchAll(/label: "([^"]*)"/g)];
  const names = [...gameConfig.matchAll(/displayName: "([^"]*)"/g)];
  assert.ok(labels.length >= 6 && names.length >= 6);
  for (const match of [...labels, ...names]) {
    assert.ok(!/shop/i.test(match[1]), match[1]);
  }
});
