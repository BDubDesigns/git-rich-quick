/**
 * Tests for the click track (issue #160, re-derived from #151).
 *
 * The invariant (Brandon's, from #151): a player who buys every click
 * upgrade affordable in a few minutes of passive has click output at
 * 10 clicks/s roughly equal to passive LOC/s, at every stage. Before
 * #160 Brandon's live save (533 LOC/s passive, OverReact L9 at 128x, 5
 * Commit Specialists) clicked at 4.80x passive, and the √2 Commitment
 * Issues step let click outrun passive by orders of magnitude.
 *
 * - OverReact: 10 levels, whole click multipliers 2, 3, 4, 5, 7, 10,
 *   14, 20, 28, 40 (about 1.4x per level); costs from L3 on climb in
 *   step with the power.
 * - Commitment Issues: 16 levels since Funding Rounds (issue #170),
 *   2x power each, every cost step at or above 2x (no runaway).
 * - Commit Specialist ($4,000 at 1.1x) is unchanged.
 * - The invariant is pinned twice: by the #160 affordability model in
 *   the early first company (before any round cap binds), and at every
 *   Funding Round's plateau (issue #170), where click at 10 clicks/s
 *   must sit between 0.8x and 1.3x passive. Click doubles per
 *   Commitment Issues level while passive grows 1.4x per track level,
 *   so the round caps are what hold that band.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  BALANCE,
  COMMITMENT_ISSUES_LEVELS,
  bestCentsPerLoc,
  clickBonus,
  doublingMultiplier,
  employeeCost,
  founderMultiplier,
  fundingRoundName,
  locPerClick,
  locPerSecond,
  openSourceLevelCap,
  openSourceLevelCosts,
} from "../../shared/game-balance.js";

const overReactLevels = BALANCE.openSource.overReactFramework.levels;
const ciLevels = BALANCE.openSource.commitmentIssues.levels;
const multiplierAt = (level) => 1 + clickBonus({ overReactFramework: level });

test("OverReact: 10 levels, a smooth climb to 40x, whole multipliers", () => {
  assert.equal(overReactLevels.length, 10);
  const multipliers = Array.from({ length: 10 }, (_, i) => multiplierAt(i + 1));
  assert.deepEqual(multipliers, [2, 3, 4, 5, 7, 10, 14, 20, 28, 40]);
  let previous = 1;
  for (const m of multipliers) {
    assert.ok(Number.isInteger(m), `${m} is whole`);
    assert.ok(m / previous >= 1.25 && m / previous <= 2, `${previous} -> ${m}`);
    previous = m;
  }
  for (const level of overReactLevels) {
    assert.equal(level.bonus.type, "CLICK_BOOST");
    assert.ok(Number.isInteger(level.bonus.value) && level.bonus.value > 0);
  }
});

test("OverReact: costs, with L1 and L2 kept as the cheap bootstrap and the rest in step with the power", () => {
  const costs = overReactLevels.map((l) => l.locCost);
  assert.deepEqual(costs, [100, 500, 4900, 6100, 8500, 12000, 17000, 24000, 34000, 49000]);
  assert.equal(openSourceLevelCosts("overReactFramework", 0, 10), 156_100);
  // From L3 on, each cost step is within 15% of the power step: clicking
  // alone buys each next level in about the same time as the last,
  // never faster and faster.
  for (let i = 3; i < costs.length; i += 1) {
    const costStep = costs[i] / costs[i - 1];
    const powerStep = multiplierAt(i + 1) / multiplierAt(i);
    assert.ok(Math.abs(costStep / powerStep - 1) <= 0.15, `L${i + 1}: cost ${costStep.toFixed(2)} vs power ${powerStep.toFixed(2)}`);
  }
});

test("Commitment Issues: 16 levels, 2x power each, every cost step at least 2x (issue #170)", () => {
  assert.equal(ciLevels.length, 16);
  assert.equal(COMMITMENT_ISSUES_LEVELS.count, 16);
  const costs = ciLevels.map((l) => l.locCost);
  assert.deepEqual(costs, [...COMMITMENT_ISSUES_LEVELS.costs]);
  assert.equal(costs[0], 460_000);
  assert.equal(costs.at(-1), 95_000_000_000);
  for (const level of ciLevels) {
    assert.deepEqual({ ...level.bonus }, { type: "MULTIPLY", value: 2 });
  }
  for (let l = 1; l <= 16; l += 1) {
    assert.equal(
      doublingMultiplier("commitSpecialist", { commitmentIssues: l }) /
        doublingMultiplier("commitSpecialist", { commitmentIssues: l - 1 }),
      2
    );
  }
  // The no-runaway rule: cost never steps slower than the 2x power.
  for (let i = 1; i < costs.length; i += 1) {
    assert.ok(costs[i] / costs[i - 1] >= 2, `L${i + 1} step ${(costs[i] / costs[i - 1]).toFixed(2)}`);
    assert.ok(Number.isSafeInteger(costs[i]));
  }
});

test("Commit Specialist stays $4,000 at 1.1x, +0.2 LOC per click, same unlock", () => {
  const cs = BALANCE.employees.commitSpecialist;
  assert.equal(cs.baseCost, 400000);
  assert.equal(cs.costMultiplier, 1.1);
  assert.equal(cs.clickBonusPerEmployee, 0.2);
  assert.deepEqual(
    cs.unlockConditions.map((c) => ({ ...c })),
    [
      { type: "TOTAL_LOC", target: 25000 },
      { type: "TOTAL_EMPLOYEE_COUNT", target: 20 },
    ]
  );
});

test("Funding Rounds leaves OverReact and Blocker ungated and unchanged", () => {
  assert.equal(openSourceLevelCap("overReactFramework", {}), 10);
  assert.equal(openSourceLevelCap("blocker", {}), 5);
  assert.deepEqual(
    BALANCE.openSource.blocker.levels.map((l) => l.bonus.value),
    [0.5, 1, 1.5, 2, 2.5]
  );
});

// --- The invariant, pinned ---

/** "A few minutes of passive": 3 minutes. */
const T_SECONDS = 180;
/** Cash per Commit Specialist hire, in seconds of production value (B =
 *  P x 60 cents/s), calibrated to Brandon's Nov 18 live save: 5
 *  Specialists at 533 LOC/s. */
const TC_SECONDS = 18.5;

/**
 * The stage model the numbers were derived from: at passive P (healthy
 * rates; the Founder, achievement, and Handbook multipliers apply to
 * click and passive alike, so they cancel in the ratio), the player owns
 * every click level costing at most T x P, and every Commit Specialist
 * whose hire costs at most TC x B. Commitment Issues needs 10
 * Specialists. Returns click LOC/s at 10 clicks/s over P.
 */
function stage(P) {
  let specialists = 0;
  while (employeeCost("commitSpecialist", specialists) <= TC_SECONDS * P * bestCentsPerLoc()) {
    specialists += 1;
  }
  const affordable = (levels) => {
    let n = 0;
    while (n < levels.length && levels[n].locCost <= T_SECONDS * P) n += 1;
    return n;
  };
  const overReact = affordable(overReactLevels);
  const commitment = specialists >= 10 ? affordable(ciLevels) : 0;
  const click = locPerClick(
    { overReactFramework: overReact, commitmentIssues: commitment },
    { commitSpecialist: specialists }
  );
  return { specialists, overReact, commitment, ratio: (10 * click) / P };
}

test("the stage model reproduces Brandon's live save: 5 Specialists at 533 LOC/s", () => {
  assert.equal(stage(533).specialists, 5);
  // His save before #160: OverReact L9 at 128x and 5 Specialists clicked
  // floor((1 + 1) x 128) = 256, 2,560 LOC/s at 10 clicks/s: 4.80x.
  assert.equal((10 * Math.floor((1 + 0.2 * 5) * 128)) / 533 > 4.79, true);
});

test("invariant: click at 10 clicks/s roughly matches passive (0.5x to 2x) through the early first company", () => {
  // Up to 200K LOC/s no round cap binds: the Bootstrapped Commitment
  // Issues cap is L6 (43M LOC), which 3 minutes of passive first
  // affords at about 239K LOC/s. Past that, the round plateaus below
  // are the invariant.
  const stages = [20, 50, 100, 200, 533, 1e3, 3e3, 1e4, 3e4, 1e5, 2e5];
  for (const P of stages) {
    const s = stage(P);
    assert.ok(s.commitment <= openSourceLevelCap("commitmentIssues", {}), `P ${P}: CI L${s.commitment}`);
    assert.ok(s.ratio >= 0.5 && s.ratio <= 2, `P ${P}: ratio ${s.ratio.toFixed(2)} (OR L${s.overReact}, CI L${s.commitment}, ${s.specialists} CS)`);
  }
  // And on a fine log grid from 20 LOC/s to 200K, no stage breaks it.
  for (let e = Math.log10(20); e <= Math.log10(2e5); e += 0.05) {
    const s = stage(10 ** e);
    assert.ok(s.ratio >= 0.5 && s.ratio <= 2, `P ${(10 ** e).toPrecision(3)}: ${s.ratio.toFixed(2)}`);
  }
});

/**
 * Funding Rounds plateaus (issue #170). Each is the end of a round in
 * the balanced-player simulation run on these exact formulas (active
 * profile, the one the proposal's stage table reports): every gated
 * track at its round cap, OverReact 10, Blocker 5, Ship Happens 10, and
 * the employee counts the simulated player owned when it ran out of
 * upgrades worth buying. `passive` is the healthy rate at a 1x permanent
 * multiplier; the simulated buffed plateaus (Founder, achievements,
 * Handbook in) were about 1.3M, 17.5M, 213M, 1.28B, 5.7B and 22B LOC/s.
 */
const ROUND_PLATEAUS = [
  { intern: 124, junior: 81, senior: 59, projectManager: 53, commitSpecialist: 82, releaseManager: 15 },
  { intern: 153, junior: 101, senior: 74, projectManager: 69, commitSpecialist: 109, releaseManager: 15 },
  { intern: 177, junior: 118, senior: 87, projectManager: 82, commitSpecialist: 133, releaseManager: 15 },
  { intern: 195, junior: 130, senior: 96, projectManager: 91, commitSpecialist: 152, releaseManager: 15 },
  { intern: 210, junior: 140, senior: 104, projectManager: 99, commitSpecialist: 168, releaseManager: 65 },
  { intern: 223, junior: 149, senior: 111, projectManager: 106, commitSpecialist: 183, releaseManager: 109 },
];

/** Every gated track at the cap of `round`, the ungated tracks maxed. */
function plateauLevels(round) {
  const ranks = { fundingRounds: round };
  const levels = { overReactFramework: 10, blocker: 5, shipHappens: 10 };
  for (const id of ["coffeeScript", "juniorAchievement", "seniorMoment", "scrumMaster", "commitmentIssues"]) {
    levels[id] = openSourceLevelCap(id, ranks);
  }
  return levels;
}

test("invariant (issue #170): at every Funding Round's plateau, click at 10 clicks/s is 0.8x to 1.3x passive", () => {
  const ratios = ROUND_PLATEAUS.map((employees, round) => {
    const ranks = { fundingRounds: round };
    const levels = plateauLevels(round);
    const passive = locPerSecond(employees, levels, 1, ranks);
    const click = locPerClick(levels, employees, 1, 1, ranks);
    const ratio = (10 * click) / passive;
    assert.ok(
      ratio >= 0.8 && ratio <= 1.3,
      `${fundingRoundName(round)}: click ${click} x 10 vs passive ${passive} = ${ratio.toFixed(3)}`
    );
    return ratio;
  });
  assert.equal(ratios.length, 6);
  // The permanent multipliers (Founder, achievements, Handbook) apply
  // to click and passive alike, so the band holds at any of them: the
  // Series B plateau at the Founder multiplier it is played at (6.58x
  // at 287 Equity) and a full Handbook reads the same ratio.
  const round = 3;
  const levels = plateauLevels(round);
  const ranks = { fundingRounds: round, engineeringHandbook: 3 };
  const buffed = founderMultiplier(287) * 3.3;
  const ratio =
    (10 * locPerClick(levels, ROUND_PLATEAUS[round], 1, buffed, ranks)) /
    locPerSecond(ROUND_PLATEAUS[round], levels, buffed, ranks);
  assert.ok(Math.abs(ratio - ratios[round]) < 1e-3, `${ratio} vs ${ratios[round]}`);
});

test("invariant (issue #170): the six round plateaus have not moved", () => {
  // Pinned to three places: Bridge Rounds (issue #192) and the Ship
  // Happens gate must leave every existing plateau exactly where it was.
  const ratios = ROUND_PLATEAUS.map((employees, round) => {
    const ranks = { fundingRounds: round };
    const levels = plateauLevels(round);
    return (
      (10 * locPerClick(levels, employees, 1, 1, ranks)) /
      locPerSecond(employees, levels, 1, ranks)
    ).toFixed(3);
  });
  assert.deepEqual(ratios, ["0.919", "0.825", "0.832", "0.930", "1.078", "1.300"]);
});

/**
 * Bridge Rounds (issue #192): a company at `round` that owns its Bridge
 * Round, every gated track at the BRIDGED cap (the next round's), on the
 * pinned headcount of the round it actually owns. The levels come from
 * openSourceLevelCap with the bridge owned, the same helper the game
 * enforces, so this is the state a bridged player can really reach.
 */
function bridgedPlateauLevels(round) {
  const ranks = { fundingRounds: round };
  const owned = { bridgeRound: 1 };
  const levels = { overReactFramework: 10, blocker: 5, shipHappens: 10, bridgeRound: 1 };
  for (const id of ["coffeeScript", "juniorAchievement", "seniorMoment", "scrumMaster", "commitmentIssues"]) {
    levels[id] = openSourceLevelCap(id, ranks, owned);
  }
  return levels;
}

test("invariant (issue #192): the three bridged plateaus sit at 0.970 / 0.934 / 0.988, inside 0.8x to 1.3x", () => {
  const expected = [0.970, 0.934, 0.988];
  [0, 1, 2].forEach((round) => {
    const ranks = { fundingRounds: round };
    const levels = bridgedPlateauLevels(round);
    // The bridged levels are the next round's caps, exactly.
    assert.deepEqual(
      { ...levels, bridgeRound: undefined },
      { ...plateauLevels(round + 1), bridgeRound: undefined },
      `${fundingRoundName(round)} + bridge = ${fundingRoundName(round + 1)} caps`
    );
    const employees = ROUND_PLATEAUS[round];
    const passive = locPerSecond(employees, levels, 1, ranks);
    const click = locPerClick(levels, employees, 1, 1, ranks);
    const ratio = (10 * click) / passive;
    assert.ok(
      ratio >= 0.8 && ratio <= 1.3,
      `${fundingRoundName(round)} + bridge: ${ratio.toFixed(3)}`
    );
    assert.equal(ratio.toFixed(3), expected[round].toFixed(3), `${fundingRoundName(round)} + bridge`);
  });
});

test("invariant (issue #192): no Series C bridge, because Series C plus a bridge would leave the band", () => {
  // The bridge stops at Series A: from Series B on, owning one lifts nothing.
  for (const round of [3, 4]) {
    assert.deepEqual(
      bridgedPlateauLevels(round),
      { ...plateauLevels(round), bridgeRound: 1 }
    );
  }
  // Why: Series C headcount at IPO caps reads 1.358, out of band.
  const employees = ROUND_PLATEAUS[4];
  const levels = plateauLevels(5);
  const ratio = (10 * locPerClick(levels, employees)) / locPerSecond(employees, levels);
  assert.equal(ratio.toFixed(3), "1.358");
  assert.ok(ratio > 1.3);
});

test("invariant (issue #170): without the round caps, click would run away from passive", () => {
  // The caps are what hold the band: the Series A plateau with
  // Commitment Issues at L16 instead of its round cap (L10) clicks far
  // above passive.
  const employees = ROUND_PLATEAUS[2];
  const levels = { ...plateauLevels(2), commitmentIssues: 16 };
  const ratio =
    (10 * locPerClick(levels, employees)) / locPerSecond(employees, levels);
  assert.ok(ratio > 10, ratio.toFixed(1));
});

test("invariant: Brandon's stage now clicks at about 1.5x passive, not 4.8x", () => {
  const s = stage(533);
  assert.equal(s.overReact, 10);
  assert.equal(s.commitment, 0);
  assert.ok(s.ratio <= 1.6, s.ratio.toFixed(2));
});

test("a full click build: 25 Commit Specialists, OverReact 10, Commitment Issues 16; no NaN", () => {
  // floor((1 + 0.2 x 25 x 2^16) x 40)
  assert.equal(
    locPerClick({ overReactFramework: 10, commitmentIssues: 16 }, { commitSpecialist: 25 }),
    Math.floor((1 + 0.2 * 25 * 2 ** 16) * 40 + 1e-9)
  );
  assert.equal(locPerClick({}, {}), 1);
  assert.equal(locPerClick({ overReactFramework: 10 }, undefined), 40);
  assert.equal(locPerClick({ overReactFramework: 10 }, { commitSpecialist: Number.NaN }), 40);
});
