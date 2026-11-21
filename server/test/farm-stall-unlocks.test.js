/**
 * Closed stalls (issue #241).
 *
 * Brandon, Nov 21, 2026: the barn opens 5 stalls in a plus shape (the
 * centre and its four sides, FARM_CONFIG.starterStalls). The four
 * corners start closed and are opened one at a time, the player's
 * choice of corner, for cash: LLAMA_ECONOMY.stallOpenSeconds (60 / 90 /
 * 135 / 200 seconds of S for the 1st / 2nd / 3rd / 4th one opened). The
 * price follows how many are open, not which corner. A closed stall
 * holds no llama, takes no buy, move or kid, and does not exist for
 * breeding. Stall openings reset with the rest of the farm on a sale;
 * discovered types still persist (#237).
 *
 * Saves: each stall gains `open` (boolean). No schema bump, no wipe:
 * a save from before this with an owned barn keeps all 9 stalls open,
 * through normalizeSaveState, the client loader and the real server.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createStore, SAVE_SCHEMA_VERSION } from "../src/store.js";
import { createServer } from "../src/server.js";
import { validateSave, validateSeedState } from "../src/validate.js";
import {
  EMPLOYEE_TYPES,
  FARM_CONFIG,
  FREELANCE_PROJECT_KEYS,
  LLAMA_ECONOMY,
  OPEN_SOURCE_IDS,
  applyFarmBirths,
  applyFarmStallOpen,
  applyPrestigeSale,
  cashBasisCentsPerSecond,
  emptyFarmState,
  equityThresholdLoc,
  farmEligibleBreedingStalls,
  farmIsStarterStall,
  farmOpenStallCount,
  farmSellAllPreview,
  farmSellableStalls,
  farmStallIsOpen,
  farmStallNeighbours,
  farmStallOpenPriceCents,
  farmStallsOpenedCount,
  formatEstimateDuration,
  initialFarmState,
  initialSaveState,
  moveFarmLlama,
  normalizeSaveState,
  rollFarmBreeding,
  rollFarmKid,
} from "../../shared/game-balance.js";
import { formatMoney } from "../../shared/formatNumber.js";
import { applyLlamaBuy } from "../../client/src/utils/llamaShop.js";
import {
  breedingGuideSections,
  closedStallsGuideLine,
} from "../../client/src/utils/breedingGuide.js";
import {
  bigActionFields,
  bigActionIncreased,
  saveStateToGameFields,
  stateToSaveState,
} from "../../client/src/save/serialize.js";

const T0 = 1_700_000_000_000;
const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
const SAMPLED_P = [0, 1_000, 9_210_000, 4_870_000_000];
const CORNERS = [0, 2, 6, 8];
const PLUS = [1, 3, 4, 5, 7];

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const farmCard = src("components/Farm.jsx");
const context = src("context/GameContext.jsx");

function zeroActions() {
  const counts = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
  return {
    clicks: 0,
    employeesBought: counts(EMPLOYEE_TYPES),
    projectsCompleted: counts(FREELANCE_PROJECT_KEYS),
    autoShips: counts(FREELANCE_PROJECT_KEYS),
    openSourceLevelsBought: counts(OPEN_SOURCE_IDS),
  };
}

function save(prevState, newState) {
  return validateSave(
    { state: prevState, savedAtMs: T0 },
    { playerId: PLAYER_ID, state: newState, actionsSinceLastSave: zeroActions() },
    T0 + 60_000
  );
}

/** A save with 10 seniors, so the barn is unlocked. */
function saveAt() {
  const base = initialSaveState();
  return { ...base, employees: { ...base.employees, senior: 10 } };
}

/**
 * An owned barn. `placed` maps a stall index to a type; `open` lists the
 * open stalls (default: the starter stalls). With `legacy`, stalls have
 * no `open` key at all: the shape every save written before this has.
 */
function barnFarm(placed, { open = PLUS, legacy = false } = {}) {
  return {
    owned: true,
    stalls: Array.from({ length: FARM_CONFIG.stallCount }, (_, i) => {
      const stall = { llama: placed[i] ?? null, lighting: "warm", locked: false };
      if (!legacy) stall.open = open.includes(i);
      return stall;
    }),
    unlockedTypes: [...new Set(Object.values(placed))],
    unseenBirths: 0,
  };
}

/** Open every listed stall in order through the pure purchase. */
function openInOrder(farm, indices, p = 1_000) {
  let current = farm;
  for (const index of indices) {
    current = applyFarmStallOpen({ farm: current, money: 1e18, stallIndex: index, buffedLocPerSec: p }).farm;
  }
  return current;
}

// --- The tuning knob ---

test("the starter stalls are a plus: the centre and its four sides; the rest are the corners", () => {
  assert.equal(FARM_CONFIG.stallCount, 9);
  assert.equal(FARM_CONFIG.gridCols, 3);
  assert.deepEqual([...FARM_CONFIG.starterStalls], PLUS);
  // Row-major grid: 4 is the centre, and its orthogonal neighbours are the sides.
  assert.deepEqual([4, ...farmStallNeighbours(4)].sort(), PLUS);
  const closed = Array.from({ length: 9 }, (_, i) => i).filter((i) => !farmIsStarterStall(i));
  assert.deepEqual(closed, CORNERS);
  for (const corner of CORNERS) assert.equal(farmStallNeighbours(corner).length, 2, `corner ${corner}`);
});

test("stallOpenSeconds is one rising entry per closed stall: 60 / 90 / 135 / 200", () => {
  assert.deepEqual([...LLAMA_ECONOMY.stallOpenSeconds], [60, 90, 135, 200]);
  assert.equal(
    LLAMA_ECONOMY.stallOpenSeconds.length,
    FARM_CONFIG.stallCount - FARM_CONFIG.starterStalls.length
  );
  for (let i = 1; i < LLAMA_ECONOMY.stallOpenSeconds.length; i++) {
    assert.ok(LLAMA_ECONOMY.stallOpenSeconds[i] > LLAMA_ECONOMY.stallOpenSeconds[i - 1]);
  }
  assert.ok(Object.isFrozen(LLAMA_ECONOMY.stallOpenSeconds));
  // The barn price is untouched.
  assert.equal(LLAMA_ECONOMY.barnSeconds, 60);
});

// --- A fresh barn, and the sale reset ---

test("a fresh barn opens the plus shape; an unbought farm shows the same shape", () => {
  for (const farm of [initialFarmState(), emptyFarmState(), initialFarmState(["quantum"])]) {
    assert.deepEqual(
      farm.stalls.map((s) => s.open),
      [false, true, false, true, true, true, false, true, false]
    );
    assert.equal(farmOpenStallCount(farm.stalls), 5);
    assert.equal(farmStallsOpenedCount(farm.stalls), 0);
  }
});

test("a sale closes the corners again and keeps the discovered types", () => {
  const pre = initialSaveState();
  pre.totalLinesOfCode = equityThresholdLoc(2);
  pre.farm = openInOrder(barnFarm({ 0: "classic", 4: "quantum" }, { open: PLUS }), [0, 2, 6, 8]);
  pre.farm.unlockedTypes = ["classic", "quantum"];
  assert.equal(farmOpenStallCount(pre.farm.stalls), 9);
  const post = applyPrestigeSale(pre, randomUUID());
  assert.equal(post.farm.owned, false);
  assert.deepEqual(post.farm.stalls.map((s) => s.open), emptyFarmState().stalls.map((s) => s.open));
  assert.deepEqual(post.farm.unlockedTypes, ["classic", "quantum"]);
  // A barn re-bought after the sale starts at the plus shape again.
  const rebought = initialFarmState(post.farm.unlockedTypes);
  assert.equal(farmOpenStallCount(rebought.stalls), 5);
  assert.equal(farmStallOpenPriceCents(rebought.stalls, 1_000), Math.round(60 * cashBasisCentsPerSecond(1_000)));
});

// --- The price ---

test("the next stall costs stallOpenSeconds[opened so far] x S, whichever corner it is", () => {
  for (const p of SAMPLED_P) {
    let farm = initialFarmState();
    for (let n = 0; n < CORNERS.length; n++) {
      const expected = Math.round(LLAMA_ECONOMY.stallOpenSeconds[n] * cashBasisCentsPerSecond(p));
      assert.equal(farmStallOpenPriceCents(farm.stalls, p), expected, `P=${p}, n=${n}`);
      farm = openInOrder(farm, [CORNERS[n]], p);
    }
    assert.equal(farmStallOpenPriceCents(farm.stalls, p), null, "nothing left to open");
  }
  // The price follows the count, not the corner: any one corner open prices the 2nd the same.
  const seconds = LLAMA_ECONOMY.stallOpenSeconds[1];
  for (const corner of CORNERS) {
    const farm = openInOrder(initialFarmState(), [corner]);
    assert.equal(farmStallOpenPriceCents(farm.stalls, 1_000), Math.round(seconds * cashBasisCentsPerSecond(1_000)));
  }
  // A legacy barn (all 9 open) has nothing to sell.
  assert.equal(farmStallOpenPriceCents(barnFarm({}, { legacy: true }).stalls, 1_000), null);
});

test("price example at P = 9.21M LOC/s", () => {
  const p = 9_210_000;
  const prices = [0, 2, 6, 8].reduce(
    (acc, corner) => {
      acc.list.push(farmStallOpenPriceCents(acc.farm.stalls, p));
      acc.farm = openInOrder(acc.farm, [corner], p);
      return acc;
    },
    { farm: initialFarmState(), list: [] }
  ).list;
  assert.deepEqual(prices, [11_604_600_000, 17_406_900_000, 26_110_350_000, 38_682_000_000]);
  assert.deepEqual(prices.map(formatMoney), ["$116.05M", "$174.07M", "$261.1M", "$386.82M"]);
  // The 1st corner costs the same as the barn (both 60 seconds of S).
  assert.equal(prices[0], Math.round(LLAMA_ECONOMY.barnSeconds * cashBasisCentsPerSecond(p)));
});

// --- Opening a stall (pure) ---

test("applyFarmStallOpen opens the chosen corner and charges the current price", () => {
  const p = 1_000;
  const farm = initialFarmState();
  const price = farmStallOpenPriceCents(farm.stalls, p);
  const opened = applyFarmStallOpen({ farm, money: price, stallIndex: 6, buffedLocPerSec: p });
  assert.equal(opened.price, price);
  assert.equal(opened.money, 0);
  assert.equal(opened.farm.stalls[6].open, true);
  assert.deepEqual(opened.farm.stalls[6], { llama: null, lighting: "warm", locked: false, open: true });
  // Only that stall changed, and the input is not mutated.
  opened.farm.stalls.forEach((stall, i) => {
    if (i !== 6) assert.deepEqual(stall, farm.stalls[i]);
  });
  assert.equal(farm.stalls[6].open, false);
  // The next corner costs more.
  assert.ok(farmStallOpenPriceCents(opened.farm.stalls, p) > price);
});

test("applyFarmStallOpen refuses: unowned barn, bad index, an open stall, too little money", () => {
  const p = 1_000;
  const farm = initialFarmState();
  const price = farmStallOpenPriceCents(farm.stalls, p);
  assert.equal(applyFarmStallOpen({ farm, money: price - 1, stallIndex: 0, buffedLocPerSec: p }), null);
  for (const open of PLUS) {
    assert.equal(applyFarmStallOpen({ farm, money: 1e18, stallIndex: open, buffedLocPerSec: p }), null, `stall ${open}`);
  }
  for (const bad of [-1, 9, 1.5, "0", null, undefined]) {
    assert.equal(applyFarmStallOpen({ farm, money: 1e18, stallIndex: bad, buffedLocPerSec: p }), null, String(bad));
  }
  assert.equal(applyFarmStallOpen({ farm: emptyFarmState(), money: 1e18, stallIndex: 0, buffedLocPerSec: p }), null);
  assert.equal(applyFarmStallOpen({ farm: null, money: 1e18, stallIndex: 0, buffedLocPerSec: p }), null);
  const twice = openInOrder(farm, [0]);
  assert.equal(applyFarmStallOpen({ farm: twice, money: 1e18, stallIndex: 0, buffedLocPerSec: p }), null);
});

test("OPEN_FARM_STALL goes through the shared purchase at the buffed P", () => {
  const body = context.slice(
    context.indexOf('case "OPEN_FARM_STALL": {'),
    context.indexOf('case "BUY_LLAMA": {')
  );
  assert.match(body, /shared\.applyFarmStallOpen\(\{/);
  assert.match(body, /buffedLocPerSec: getBaseLocPerSecond\(state\),/);
  assert.match(body, /if \(!opened\) return state;/);
  assert.match(body, /money: opened\.money, farm: opened\.farm/);
});

// --- A closed stall: no buy, no move, no kid, no lighting, no breeding ---

test("a closed stall cannot be bought into or moved into", () => {
  const farm = { ...barnFarm({ 1: "classic" }), unlockedTypes: ["classic"] };
  for (const corner of CORNERS) {
    assert.equal(
      applyLlamaBuy({ farm, money: 1e18, stallIndex: corner, type: "classic", buffedLocPerSec: 1_000 }),
      null,
      `buy into ${corner}`
    );
    assert.equal(moveFarmLlama(farm, 1, corner), null, `move into ${corner}`);
  }
  // Once opened, both work.
  const opened = openInOrder(farm, [0]);
  assert.ok(applyLlamaBuy({ farm: opened, money: 1e18, stallIndex: 0, type: "classic", buffedLocPerSec: 1_000 }));
  assert.equal(moveFarmLlama(opened, 1, 0).stalls[0].llama, "classic");
});

test("a closed stall never gets a kid and is never a nest", () => {
  // Corner 0 sits between stalls 1 and 3: two llamas beside it.
  const farm = barnFarm({ 1: "classic", 3: "drama" });
  assert.ok(!farmEligibleBreedingStalls(farm.stalls).includes(0));
  // Stall 4 (open, also between 1 and 3) is the nest instead.
  assert.ok(farmEligibleBreedingStalls(farm.stalls).includes(4));
  assert.equal(rollFarmKid(0, farm.stalls, farm.unlockedTypes, () => 0), null);
  // A sure-fire roll places kids only in open stalls.
  const roll = rollFarmBreeding(farm.stalls, farm.unlockedTypes, () => 0);
  assert.equal(roll.stalls[0].llama, null);
  // A kid sent to a closed stall (a stale roll) is not placed and not counted.
  const born = applyFarmBirths(farm, [{ stallIndex: 0, type: "classic" }, { stallIndex: 4, type: "classic" }]);
  assert.equal(born.stalls[0].llama, null);
  assert.equal(born.stalls[4].llama, "classic");
  assert.equal(born.unseenBirths, 1);
  // Opened, the corner breeds like any stall.
  assert.ok(farmEligibleBreedingStalls(openInOrder(farm, [0]).stalls).includes(0));
});

test("a closed stall is not a neighbour, even if it somehow holds a llama", () => {
  // Tampered: a llama in closed corner 0. Stall 1 has neighbours 0, 2, 4;
  // with only 4 holding a real llama, 1 cannot breed.
  const farm = barnFarm({ 0: "classic", 4: "classic" });
  assert.ok(!farmStallIsOpen(farm.stalls[0]));
  assert.ok(!farmEligibleBreedingStalls(farm.stalls).includes(1));
  assert.equal(rollFarmKid(1, farm.stalls, farm.unlockedTypes, () => 0), null);
  // The same layout with corner 0 open does breed into 1.
  const open = barnFarm({ 0: "classic", 4: "classic" }, { open: [0, ...PLUS] });
  assert.ok(farmEligibleBreedingStalls(open.stalls).includes(1));
});

test("the countdown's 'nothing can breed yet' reads the closed-aware eligibility", () => {
  // Only the corner could breed here, so the barn reports nothing eligible.
  const farm = barnFarm({ 1: "classic", 3: "drama", 4: "mama", 5: "classic", 7: "classic" });
  assert.deepEqual(farmEligibleBreedingStalls(farm.stalls), []);
  assert.match(farmCard, /const eligible = farmEligibleBreedingStalls\(farm\.stalls\);/);
  assert.match(farmCard, /\{eligible\.length === 0 \? " \(nothing can breed yet\)" : ""\}/);
});

test("Sell All and its preview skip closed stalls (they hold no llamas)", () => {
  const farm = barnFarm({ 1: "classic", 4: "drama" });
  assert.deepEqual(farmSellableStalls(farm.stalls), [1, 4]);
  assert.equal(farmSellAllPreview(farm.stalls, 1_000).count, 2);
  // Selling a llama out of a stall keeps the stall open.
  const context2 = context.slice(context.indexOf('case "SELL_LLAMA": {'), context.indexOf('case "SELL_UNLOCKED_LLAMAS": {'));
  assert.match(context2, /\{ \.\.\.entry, llama: null, locked: false \}/);
});

test("a closed stall has no lighting control in the reducer", () => {
  const body = context.slice(
    context.indexOf('case "SET_STALL_LIGHTING": {'),
    context.indexOf('case "OPEN_FARM_STALL": {')
  );
  assert.match(body, /!shared\.farmStallIsOpen\(farm\.stalls\[stallIndex\]\)/);
});

// --- Saves: no bump, no wipe, old barns keep all 9 ---

test("no schema bump: SAVE_SCHEMA_VERSION stays 3", () => {
  assert.equal(SAVE_SCHEMA_VERSION, 3);
});

test("an old save with an owned barn keeps all 9 stalls open and every llama in place", () => {
  const layout = { 0: "mama", 2: "classic", 4: "drama", 6: "ai", 8: "classic" };
  const old = { ...saveAt(), farm: barnFarm(layout, { legacy: true }) };
  const normalized = normalizeSaveState(old);
  assert.ok(normalized.farm.stalls.every((s) => s.open === true));
  assert.deepEqual(normalized.farm.stalls.map((s) => s.llama), old.farm.stalls.map((s) => s.llama));
  // Not mutated, idempotent, and the same as a save written all open.
  assert.ok(old.farm.stalls.every((s) => !("open" in s)));
  assert.deepEqual(normalizeSaveState(normalized), normalized);
  assert.deepEqual(normalized, normalizeSaveState({ ...saveAt(), farm: barnFarm(layout, { open: [0, 1, 2, 3, 4, 5, 6, 7, 8] }) }));
  // The client loader agrees, and its save writes the same stalls.
  const client = saveStateToGameFields(old);
  assert.deepEqual(client.farm.stalls, normalized.farm.stalls);
  assert.deepEqual(stateToSaveState(client).farm.stalls, normalized.farm.stalls);
  assert.equal(validateSeedState(old).ok, true);
  // Nothing is left to open.
  assert.equal(farmStallOpenPriceCents(normalized.farm.stalls, 1_000), null);
});

test("an old save with no barn gets the plus shape, like a fresh one", () => {
  const old = initialSaveState();
  old.farm = { ...emptyFarmState(), stalls: emptyFarmState().stalls.map(({ llama, lighting }) => ({ llama, lighting })) };
  const normalized = normalizeSaveState(old);
  assert.deepEqual(normalized.farm.stalls, emptyFarmState().stalls);
  assert.deepEqual(saveStateToGameFields(old).farm.stalls, emptyFarmState().stalls);
  assert.equal(validateSeedState(old).ok, true);
});

test("a new save's closed stalls survive normalize, the client load and the client save", () => {
  const fresh = { ...saveAt(), farm: openInOrder(barnFarm({ 4: "classic" }), [6]) };
  const normalized = normalizeSaveState(fresh);
  assert.deepEqual(normalized.farm.stalls.map((s) => s.open), [false, true, false, true, true, true, true, true, false]);
  assert.deepEqual(normalizeSaveState(normalized), normalized);
  const client = saveStateToGameFields(fresh);
  assert.deepEqual(client.farm.stalls, normalized.farm.stalls);
  assert.deepEqual(stateToSaveState(client).farm.stalls, normalized.farm.stalls);
  assert.equal(validateSeedState(fresh).ok, true);
});

test("the validator rejects a bad open flag, a llama in a closed stall, and a closed starter stall", () => {
  const notBool = barnFarm({});
  notBool.stalls[0].open = "yes";
  assert.equal(normalizeSaveState({ ...saveAt(), farm: notBool }).farm.stalls[0].open, "yes");
  assert.match(validateSeedState({ ...saveAt(), farm: notBool }).detail, /open must be a boolean/);
  const llamaInClosed = barnFarm({ 0: "classic" });
  assert.match(validateSeedState({ ...saveAt(), farm: llamaInClosed }).detail, /closed but holds a llama/);
  const closedStarter = barnFarm({}, { open: [1, 3, 5, 7] });
  assert.match(validateSeedState({ ...saveAt(), farm: closedStarter }).detail, /starter stall is closed/);
});

test("the validator: opening a stall is accepted, closing one again is not", () => {
  const plus = { ...saveAt(), farm: barnFarm({ 4: "classic" }) };
  const oneOpen = { ...saveAt(), farm: openInOrder(plus.farm, [2]) };
  assert.equal(save(plus, oneOpen).ok, true);
  const back = save(oneOpen, plus);
  assert.equal(back.ok, false);
  assert.equal(back.rule, "MONOTONIC");
  assert.match(back.detail, /farm stall 2 closed again/);
  // Buying the barn (unowned to the plus shape) is accepted.
  assert.equal(save({ ...saveAt(), farm: emptyFarmState() }, plus).ok, true);
});

test("the validator tolerates a stale client that sends no open key", () => {
  const plus = { ...saveAt(), farm: barnFarm({ 4: "classic" }) };
  const stale = { ...saveAt(), farm: barnFarm({ 4: "classic" }, { legacy: true }) };
  // Known limit (see the PR): a stale client's save reads as an old save, so all 9 open.
  assert.equal(save(plus, stale).ok, true);
  assert.equal(save(stale, stale).ok, true);
  assert.equal(save(stale, plus).ok, false, "a full barn cannot close back to the plus");
});

test("opening a stall is a big action, so it saves promptly", () => {
  const before = bigActionFields(stateToSaveState(saveStateToGameFields({ ...saveAt(), farm: barnFarm({}) })));
  const after = bigActionFields(stateToSaveState(saveStateToGameFields({ ...saveAt(), farm: openInOrder(barnFarm({}), [8]) })));
  assert.equal(after.farmOpenStalls, before.farmOpenStalls + 1);
  assert.equal(bigActionIncreased(before, after), true);
});

// --- The Farm card ---

test("a closed tile shows a door and 'Open $X', not the llama lock; its aria-label says closed", () => {
  assert.match(farmCard, /<FaDoorClosed className="text-lg text-gray-400" aria-hidden="true" \/>/);
  // Compact tile (Brandon, Nov 21): the door plus the price; "closed" lives in the aria-label.
  assert.match(farmCard, /tabular-nums">\s*Open \{formatMoney\(stallOpenCents\)\}/);
  assert.doesNotMatch(farmCard, /Closed stall|Open for \{formatMoney/);
  assert.match(farmCard, /, open it for \$\{formatMoney\(stallOpenCents\)\}/);
  assert.match(farmCard, /`Stall \$\{index \+ 1\}: closed\$\{/);
  // The price on the tile is the shared price at the same buffed P the reducer charges.
  assert.match(farmCard, /const stallOpenCents = farmStallOpenPriceCents\(farm\.stalls, pricingRate\);/);
  // A closed stall is never a move target.
  assert.match(farmCard, /const isMoveTarget = moving && !stall\.llama && !isClosed;/);
  // Move is disabled once every OPEN stall is full.
  assert.match(farmCard, /disabled=\{llamaCount >= openStallCount\}/);
});

test("the chip of a closed stall has an Open button, disabled with a reason when you cannot afford it", () => {
  const start = farmCard.indexOf("{selectedClosed ? (");
  const chip = farmCard.slice(start, farmCard.indexOf(") : selectedLlama ? (", start));
  assert.match(chip, /onClick=\{handleOpenStall\}/);
  assert.match(chip, /disabled=\{!canAffordStall\}/);
  assert.match(chip, /Open this stall \(\{formatMoney\(stallOpenCents \?\? 0\)\}\)/);
  assert.match(chip, /You need \{formatMoney\(stallOpenCents \?\? 0\)\}\. You have\{" "\}/);
  assert.match(farmCard, /dispatch\(\{ type: "OPEN_FARM_STALL", payload: \{ stallIndex: selectedStall \} \}\);/);
  // Distinct from the llama lock: no "Unlock" or "locked" wording here.
  assert.doesNotMatch(chip, /[Uu]nlock|[Ll]ocked/);
  assert.doesNotMatch(chip, /animate-|transition/);
  assert.match(farmCard, /const canAffordStall = stallOpenCents !== null && state\.money >= stallOpenCents;/);
});

test("zero em or en dashes in the Farm card and the guide", () => {
  assert.doesNotMatch(farmCard, /[–—]/);
  assert.doesNotMatch(src("utils/breedingGuide.js"), /[–—]/);
});

// --- The breeding guide ---

test("the guide's closed-stall line reads its numbers from the constants", () => {
  const line = closedStallsGuideLine();
  assert.ok(breedingGuideSections()[0].lines.includes(line));
  assert.match(line, new RegExp(`opens ${FARM_CONFIG.starterStalls.length} stalls`));
  assert.match(line, new RegExp(`The ${FARM_CONFIG.stallCount - FARM_CONFIG.starterStalls.length} corners start closed`));
  for (const seconds of LLAMA_ECONOMY.stallOpenSeconds) {
    assert.ok(line.includes(formatEstimateDuration(seconds)), `${seconds}s`);
  }
  assert.equal(
    line,
    "The barn opens 5 stalls. The 4 corners start closed: a closed stall holds no llama and is not a neighbour. Tap one to open it. Each costs more than the last: 1m, 1m 30s, 2m 15s, then 3m 20s of shipping income."
  );
  // Diagonals, not corners, are what never count as neighbours.
  assert.ok(breedingGuideSections()[0].lines.some((l) => /Diagonals do not count\./.test(l)));
});

// --- End to end: an old full barn stays full; a new barn's corners persist ---

async function startTestServer() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = createStore(pool);
  await store.ensureSchema();
  let nowMs = T0;
  const server = createServer(store, { clock: () => nowMs });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    pool,
    advance: (ms) => {
      nowMs += ms;
    },
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

async function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("end to end: an old full barn loads all open; a new barn's corners save, reload, and never close", async () => {
  const srv = await startTestServer();
  try {
    const minted = await post(srv.base, "/api/player", {});
    assert.equal(minted.status, 201);
    const { playerId } = await minted.json();
    const full = { 0: "mama", 1: "classic", 2: "classic", 3: "drama", 4: "classic", 5: "classic", 6: "drama", 7: "classic", 8: "classic" };
    const old = { ...saveAt(), farm: barnFarm(full, { legacy: true }) };
    await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [JSON.stringify(old), playerId]);

    const loaded = await (await fetch(`${srv.base}/api/load?playerId=${playerId}`)).json();
    const client = saveStateToGameFields(loaded.state);
    assert.ok(client.farm.stalls.every((s) => s.open === true));
    assert.deepEqual(client.farm.stalls.map((s) => s.llama), Object.values(full));

    // The client saves the full barn back: accepted, all 9 still open.
    srv.advance(60_000);
    const saved = await post(srv.base, "/api/save", {
      playerId,
      state: stateToSaveState({ ...loaded.state, ...client }),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved.status, 200, await saved.clone().text());

    // A second player: a fresh barn with one corner opened.
    const minted2 = await post(srv.base, "/api/player", {});
    const { playerId: id2 } = await minted2.json();
    const fresh = { ...saveAt(), farm: openInOrder(initialFarmState(), [2]) };
    await srv.pool.query(`UPDATE git_saves SET state = $1 WHERE player_id = $2`, [JSON.stringify(fresh), id2]);
    const loaded2 = await (await fetch(`${srv.base}/api/load?playerId=${id2}`)).json();
    const client2 = saveStateToGameFields(loaded2.state);
    assert.deepEqual(client2.farm.stalls.map((s) => s.open), [false, true, true, true, true, true, false, true, false]);
    // Opening one more saves and reloads.
    const two = openInOrder(client2.farm, [8]);
    srv.advance(60_000);
    const saved2 = await post(srv.base, "/api/save", {
      playerId: id2,
      state: stateToSaveState({ ...loaded2.state, ...client2, farm: two }),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(saved2.status, 200, await saved2.clone().text());
    const reloaded = saveStateToGameFields((await (await fetch(`${srv.base}/api/load?playerId=${id2}`)).json()).state);
    assert.equal(reloaded.farm.stalls[8].open, true);
    assert.equal(reloaded.farm.stalls[0].open, false);
    // Closing it again is refused.
    srv.advance(60_000);
    const closing = await post(srv.base, "/api/save", {
      playerId: id2,
      state: stateToSaveState({ ...loaded2.state, ...client2 }),
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(closing.status, 409);
    // A stale cached client (no open key) still saves.
    srv.advance(60_000);
    const staleStalls = reloaded.farm.stalls.map((stall) => {
      const copy = { ...stall };
      delete copy.open;
      return copy;
    });
    const stale = await post(srv.base, "/api/save", {
      playerId: id2,
      state: { ...loaded2.state, farm: { ...reloaded.farm, stalls: staleStalls } },
      actionsSinceLastSave: zeroActions(),
    });
    assert.equal(stale.status, 200, await stale.clone().text());
  } finally {
    await srv.stop();
  }
});
