/**
 * Tests for getVerticalScrollAffordances
 * (client/src/utils/scrollAffordances.js): the pure rule behind the
 * up/down arrows on a scrollable tab/pane — ported from RuneSpace
 * (components/ui/scroll-affordances.ts, issue #345).
 *
 * The rule reads real overflow, never the mere possibility of
 * scrolling: an edge counts only when content genuinely hides beyond
 * it, and a scroller counts as "at" an edge within the 8px epsilon,
 * so subpixel scroll positions never flicker an arrow.
 *
 * The helper lives in the shared-only scrollAffordances module (no
 * react-icons), so the server suite can import it directly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  getVerticalScrollAffordances,
  sameVerticalScrollAffordances,
  NO_VERTICAL_SCROLL_AFFORDANCES,
  SCROLL_AFFORDANCE_EDGE_EPSILON,
} from "../../client/src/utils/scrollAffordances.js";

test("epsilon is 8px", () => {
  assert.equal(SCROLL_AFFORDANCE_EDGE_EPSILON, 8);
});

test("content that fits shows neither arrow", () => {
  assert.deepEqual(
    getVerticalScrollAffordances({
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 600,
    }),
    { top: false, bottom: false },
  );
  assert.deepEqual(
    getVerticalScrollAffordances({
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 400,
    }),
    { top: false, bottom: false },
  );
});

test("at the top with more below shows only the bottom arrow", () => {
  assert.deepEqual(
    getVerticalScrollAffordances({
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 1200,
    }),
    { top: false, bottom: true },
  );
});

test("at the bottom shows only the top arrow", () => {
  assert.deepEqual(
    getVerticalScrollAffordances({
      scrollTop: 600,
      clientHeight: 600,
      scrollHeight: 1200,
    }),
    { top: true, bottom: false },
  );
});

test("in the middle shows both arrows", () => {
  assert.deepEqual(
    getVerticalScrollAffordances({
      scrollTop: 300,
      clientHeight: 600,
      scrollHeight: 1200,
    }),
    { top: true, bottom: true },
  );
});

test("within the epsilon of an edge, that edge counts as reached", () => {
  // 5px scrolled: still "at" the top, no flicker.
  assert.deepEqual(
    getVerticalScrollAffordances({
      scrollTop: 5,
      clientHeight: 600,
      scrollHeight: 1200,
    }),
    { top: false, bottom: true },
  );
  // 5px of content left below: still "at" the bottom.
  assert.deepEqual(
    getVerticalScrollAffordances({
      scrollTop: 595,
      clientHeight: 600,
      scrollHeight: 1200,
    }),
    { top: true, bottom: false },
  );
  // Exactly at the epsilon: the edge has been left.
  assert.deepEqual(
    getVerticalScrollAffordances({
      scrollTop: 9,
      clientHeight: 600,
      scrollHeight: 1200,
    }),
    { top: true, bottom: true },
  );
});

test("sameVerticalScrollAffordances compares both edges", () => {
  assert.equal(
    sameVerticalScrollAffordances(
      { top: false, bottom: true },
      { top: false, bottom: true },
    ),
    true,
  );
  assert.equal(
    sameVerticalScrollAffordances(
      { top: false, bottom: true },
      { top: true, bottom: true },
    ),
    false,
  );
  assert.equal(
    sameVerticalScrollAffordances(
      NO_VERTICAL_SCROLL_AFFORDANCES,
      { top: false, bottom: false },
    ),
    true,
  );
});
