/**
 * Tests for sortOpenSourceProjectIds (client/src/utils/unlockProgress.js):
 * maxed-out open-source projects sink to the bottom of the GitNub list
 * and projects that still have levels to buy stay higher. Stable: the
 * relative order within each group is unchanged. Locked projects
 * (level 0) are not maxed, so they stay in the higher group.
 *
 * The helper lives in the shared-only unlockProgress module (no
 * react-icons), so the server suite can import it directly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sortOpenSourceProjectIds } from "../../client/src/utils/unlockProgress.js";
import { BALANCE } from "../../shared/game-balance.js";

const IDS = ["overReactFramework", "blocker", "constellation"];

/** Client-shaped state: openSourceProjects maps id -> { level }. */
function stateWithLevels(levels) {
  return {
    openSourceProjects: Object.fromEntries(
      Object.entries(levels).map(([id, level]) => [id, { level }])
    ),
  };
}

test("maxed projects sink to the bottom, stable within each group", () => {
  // OverReact has 5 levels, Blocker 5, Constellation 5 (from BALANCE).
  for (const id of IDS) {
    assert.equal(BALANCE.openSource[id].levels.length, 5, id);
  }

  // Only OverReact maxed: it drops below Blocker and Constellation.
  assert.deepEqual(
    sortOpenSourceProjectIds(
      IDS,
      stateWithLevels({ overReactFramework: 5, blocker: 4, constellation: 5 - 1 })
    ),
    ["blocker", "constellation", "overReactFramework"]
  );

  // OverReact + Constellation maxed: Blocker stays on top, the two
  // maxed keep their original relative order.
  assert.deepEqual(
    sortOpenSourceProjectIds(
      IDS,
      stateWithLevels({ overReactFramework: 5, blocker: 4, constellation: 5 })
    ),
    ["blocker", "overReactFramework", "constellation"]
  );

  // Constellation maxed only: it is already last, order unchanged.
  assert.deepEqual(
    sortOpenSourceProjectIds(
      IDS,
      stateWithLevels({ overReactFramework: 5 - 1, blocker: 4, constellation: 5 })
    ),
    ["overReactFramework", "blocker", "constellation"]
  );

  // None maxed: order unchanged.
  assert.deepEqual(
    sortOpenSourceProjectIds(
      IDS,
      stateWithLevels({ overReactFramework: 4, blocker: 4, constellation: 4 })
    ),
    ["overReactFramework", "blocker", "constellation"]
  );

  // All maxed: order unchanged (stable).
  assert.deepEqual(
    sortOpenSourceProjectIds(
      IDS,
      stateWithLevels({ overReactFramework: 5, blocker: 5, constellation: 5 })
    ),
    ["overReactFramework", "blocker", "constellation"]
  );

  // A locked project (level 0) is not maxed: it stays in the higher group.
  assert.deepEqual(
    sortOpenSourceProjectIds(
      IDS,
      stateWithLevels({ overReactFramework: 5, blocker: 0, constellation: 4 })
    ),
    ["blocker", "constellation", "overReactFramework"]
  );
});
