/**
 * Tests for the Hire tab's Default / Cheapest sort (issue #181), built
 * on #180's shared control and ordering helper.
 *
 * - Default is today's Hire order exactly: config order.
 * - Cheapest orders by employeeBulkCost at the selected quantity (the
 *   number each card shows and the hire action charges), ascending,
 *   ties in config order; locked types (0 owned) at base hire cost;
 *   buying raises the cost, so the order changes as counts change.
 * - Both tabs drive the ONE shared SortControl / useSortMode /
 *   sortIdsByCost, each with its own device preference. Projects and
 *   the Farm get no control.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  BALANCE,
  EMPLOYEE_TYPES,
  employeeBulkCost,
  employeeCost,
  employeePurchaseCosts,
} from "../../shared/game-balance.js";
import { sortEmployeeTypes } from "../../client/src/utils/unlockProgress.js";
import {
  SORT_TABS,
  readSortMode,
  setSortMode,
  sortModeStorageKey,
} from "../../client/src/utils/sortModes.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

/** The Hire tab's config order (EMPLOYEE_CONFIGS key order, from source). */
function configOrder() {
  const config = src("context/gameConfig.js");
  const block = config.slice(
    config.indexOf("export const EMPLOYEE_CONFIGS"),
    config.indexOf("});", config.indexOf("export const EMPLOYEE_CONFIGS"))
  );
  return [...block.matchAll(/^ {2}([a-zA-Z]+): \{/gm)].map((m) => m[1]);
}

function stateWithCounts(counts = {}) {
  return {
    employees: Object.fromEntries(
      EMPLOYEE_TYPES.map((type) => [type, { count: counts[type] ?? 0 }])
    ),
  };
}

const QUANTITIES = [1, 5, 10, 25, 100];

// --- The shared cost ---

test("employeeBulkCost: the sum of the next n hires; n = 1 is employeeCost", () => {
  for (const type of EMPLOYEE_TYPES) {
    for (const count of [0, 1, 7, 40]) {
      assert.equal(employeeBulkCost(type, count, 1), employeeCost(type, count));
      for (const n of QUANTITIES) {
        assert.equal(
          employeeBulkCost(type, count, n),
          employeePurchaseCosts(type, count, n).reduce((a, b) => a + b, 0)
        );
      }
    }
    assert.equal(employeeBulkCost(type, 0), BALANCE.employees[type].baseCost);
  }
  assert.equal(employeeBulkCost("notAType", 0, 1), 0);
  assert.equal(employeeBulkCost("intern", undefined, undefined), BALANCE.employees.intern.baseCost);
});

// --- Default ---

test("Default reproduces today's Hire order exactly: config order, whatever the counts", () => {
  const order = configOrder();
  assert.deepEqual([...order].sort(), [...EMPLOYEE_TYPES].sort());
  for (const counts of [{}, { intern: 80 }, { intern: 5, junior: 40, senior: 3 }]) {
    for (const q of QUANTITIES) {
      assert.deepEqual(sortEmployeeTypes(order, stateWithCounts(counts), "default", q), order);
      assert.deepEqual(sortEmployeeTypes(order, stateWithCounts(counts), undefined, q), order);
    }
  }
  // A copy, never the caller's array.
  assert.notEqual(sortEmployeeTypes(order, stateWithCounts(), "default"), order);
});

// --- Cheapest ---

test("Cheapest: a fresh company sorts at base hire cost, ties in config order", () => {
  const order = configOrder();
  assert.deepEqual(sortEmployeeTypes(order, stateWithCounts(), "cheapest"), [
    "intern", // $25
    "junior", // $200
    "senior", // $1,500
    "commitSpecialist", // $4,000
    "projectManager", // $5,000 (tie with Release Manager: config order)
    "releaseManager", // $5,000
  ]);
  assert.equal(BALANCE.employees.projectManager.baseCost, BALANCE.employees.releaseManager.baseCost);
  assert.ok(order.indexOf("projectManager") < order.indexOf("releaseManager"));
});

test("Cheapest re-sorts as counts change: hiring raises the next cost", () => {
  const order = configOrder();
  // 30 interns: next intern is round(2500 * 1.1^30) = 43,621c, above a
  // fresh junior's 20,000 and below a fresh senior's 150,000.
  const state = stateWithCounts({ intern: 30 });
  assert.ok(employeeCost("intern", 30) > employeeCost("junior", 0));
  assert.deepEqual(sortEmployeeTypes(order, state, "cheapest").slice(0, 3), [
    "junior",
    "intern",
    "senior",
  ]);
  // Sweep: whatever the counts, the order is ascending by the card's cost.
  for (const counts of [{ intern: 50, junior: 20 }, { senior: 12, projectManager: 2 }, { releaseManager: 9, commitSpecialist: 1 }]) {
    for (const q of QUANTITIES) {
      const s = stateWithCounts(counts);
      const sorted = sortEmployeeTypes(order, s, "cheapest", q);
      const costs = sorted.map((type) => employeeBulkCost(type, s.employees[type].count, q));
      for (let i = 1; i < costs.length; i += 1) {
        assert.ok(costs[i - 1] <= costs[i], `${sorted[i - 1]} before ${sorted[i]} at x${q}`);
        if (costs[i - 1] === costs[i]) {
          assert.ok(order.indexOf(sorted[i - 1]) < order.indexOf(sorted[i]), "ties in config order");
        }
      }
    }
  }
});

test("Cheapest orders by the selected bulk quantity's total, the number the card shows", () => {
  const order = configOrder();
  // Commit Specialist (1.1x) vs Project Manager (1.2x), both at 0: at
  // x1 the specialist is cheaper ($4,000 vs $5,000); at x100 the
  // steeper manager curve costs far more, so the gap only widens.
  const s = stateWithCounts();
  for (const q of QUANTITIES) {
    const sorted = sortEmployeeTypes(order, s, "cheapest", q);
    assert.ok(sorted.indexOf("commitSpecialist") < sorted.indexOf("projectManager"));
  }
  // A case where quantity flips the order: Senior at 5 owned (1.2x,
  // next $3,732) vs Commit Specialist at 0 (1.1x, $4,000).
  const flip = stateWithCounts({ senior: 5 });
  const x1 = sortEmployeeTypes(order, flip, "cheapest", 1);
  const x100 = sortEmployeeTypes(order, flip, "cheapest", 100);
  assert.ok(employeeBulkCost("senior", 5, 1) < employeeBulkCost("commitSpecialist", 0, 1));
  assert.ok(employeeBulkCost("senior", 5, 100) > employeeBulkCost("commitSpecialist", 0, 100));
  assert.ok(x1.indexOf("senior") < x1.indexOf("commitSpecialist"));
  assert.ok(x100.indexOf("senior") > x100.indexOf("commitSpecialist"));
});

test("Cheapest: locked types (0 owned) sit at their base hire cost", () => {
  const order = configOrder();
  // Interns and juniors bought up; seniors and the rest never hired.
  const s = stateWithCounts({ intern: 60, junior: 25 });
  const sorted = sortEmployeeTypes(order, s, "cheapest");
  const pos = (type) => sorted.indexOf(type);
  // Senior base $1,500 is below 25 juniors' next ($200 * 1.15^25 = $6,583).
  assert.ok(pos("senior") < pos("junior"));
  assert.equal(employeeBulkCost("senior", 0, 1), BALANCE.employees.senior.baseCost);
  // A missing employees entry reads as 0 owned, never NaN.
  assert.deepEqual(sortEmployeeTypes(order, {}, "cheapest"), sortEmployeeTypes(order, stateWithCounts(), "cheapest"));
});

// --- One shared mechanism ---

test("the Hire tab drives the shared SortControl, hook and helper; its own preference", () => {
  const shop = src("components/Shop.jsx");
  assert.match(shop, /import \{ SortControl \} from "\.\/SortControl\.jsx"/);
  assert.match(shop, /<SortControl tab="shop" \/>/);
  assert.match(shop, /useSortMode\("shop"\)/);
  assert.match(shop, /sortEmployeeTypes\(\s*Object\.keys\(EMPLOYEE_CONFIGS\),\s*state,\s*sortMode,\s*quantity\s*\)/);
  assert.match(shop, /employeeTypes\.map\(/);
  // No hand-rolled sort in either tab.
  for (const file of ["Shop.jsx", "OpenSource.jsx"]) {
    assert.ok(!/\.sort\(/.test(src(`components/${file}`)), `${file} has no sort of its own`);
  }
  // Both orderings go through sortIdsByCost.
  const helpers = src("utils/unlockProgress.js");
  assert.match(helpers, /import \{ sortIdsByCost \} from "\.\/sortModes\.js"/);
  assert.equal((helpers.match(/sortIdsByCost\(/g) ?? []).length, 3, "Open Source (2 groups) + Hire");
  // Exactly one sort control component in the codebase.
  const controls = readdirSync(new URL("../../client/src/components/", import.meta.url)).filter((f) =>
    /sort/i.test(f)
  );
  assert.deepEqual(controls, ["SortControl.jsx"]);
  // The card's cost and the reducer's charge use the same shared helper.
  // Merged shape (#181 + #157): the bulk helper also carries the live
  // star effects, so the assertion pins both at once.
  assert.match(
    src("context/gameLogic.js"),
    /return shared\.employeeBulkCost\(employeeType, employee\.count, quantity, \{\s*activeStarEffects: state\.activeStarEffects \?\? \[\],?\s*\}\)/
  );
  assert.match(src("context/GameContext.jsx"), /const totalCost = shared\.employeeBulkCost\(/);
});

test("each tab keeps its own mode", () => {
  assert.deepEqual([...SORT_TABS], ["openSource", "shop"]);
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  setSortMode("shop", "cheapest", storage);
  assert.equal(readSortMode("shop", storage), "cheapest");
  assert.equal(readSortMode("openSource", storage), "default");
  assert.equal(map.get(sortModeStorageKey("shop")), "cheapest");
  assert.equal(map.has(sortModeStorageKey("openSource")), false);
});

test("Projects and the Farm get no sort control (per the issue)", () => {
  for (const file of ["Projects.jsx", "Farm.jsx"]) {
    const text = src(`components/${file}`);
    assert.ok(!text.includes("SortControl"), `${file}: no control`);
    assert.ok(!text.includes("useSortMode"), `${file}: no mode`);
  }
  // The freelance ladder is already ascending by LOC cost, which is
  // why Projects needs no control.
  const locs = Object.values(BALANCE.freelanceProjects).map((p) => p.loc);
  assert.deepEqual(locs, [...locs].sort((a, b) => a - b));
});
