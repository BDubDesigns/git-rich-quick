/**
 * Tests for the freelance project payout rate (issue #176).
 *
 * Every project card shows the rate in cents per LOC: the EFFECTIVE
 * rate, one ship's payout (base reward times the Client Network
 * multiplier, rounded to whole cents, exactly what shipping pays)
 * divided by the project's LOC cost. Both the unlocked ProjectCard
 * and the locked teaser card show it. The numbers come from
 * freelancePayoutQuote in shared/game-balance.js, never from a
 * per-project string. The Projects section description explains the
 * system in the game's voice, with no em dashes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BALANCE,
  FREELANCE_PROJECT_KEYS,
  PRESTIGE_STORE_CONFIG,
  clientNetworkPayoutMultiplier,
  freelancePayoutQuote,
  freelanceShipPayoutCents,
  releaseManagerShippingEconomics,
  RELEASE_MANAGER_CONFIG,
  releaseManagerShipsPerInterval,
} from "../../shared/game-balance.js";
import {
  formatCentsPerLoc,
  projectPayoutLines,
} from "../../client/src/utils/projectPayout.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

// The issue's table: the base rate per project, in cents per LOC.
const BASE_RATES = {
  toDoListApp: 60,
  hobbyWebsite: 48,
  paradigmShiftingBlockchainProject: 40,
  aiPoweredDashboard: 34,
  nftMarketplace: 29,
  metaverseRealEstate: 25,
  quantumToDoList: 21,
};

// --- The rate computation ---

test("base rate per project: reward / LOC, matching the issue's table", () => {
  assert.deepEqual(Object.keys(BASE_RATES), [...FREELANCE_PROJECT_KEYS]);
  for (const key of FREELANCE_PROJECT_KEYS) {
    const { loc, reward } = BALANCE.freelanceProjects[key];
    const quote = freelancePayoutQuote(key, {});
    assert.equal(quote.loc, loc, key);
    assert.equal(quote.payoutCents, reward, key);
    assert.equal(quote.centsPerLoc, reward / loc, key);
    assert.equal(quote.centsPerLoc, BASE_RATES[key], key);
    assert.equal(quote.baseCentsPerLoc, BASE_RATES[key], key);
    assert.equal(quote.payoutBonus, 0, key);
  }
});

test("the rate falls up the ladder while the payout per ship rises", () => {
  const quotes = FREELANCE_PROJECT_KEYS.map((key) => freelancePayoutQuote(key));
  for (let i = 1; i < quotes.length; i += 1) {
    assert.ok(quotes[i].centsPerLoc < quotes[i - 1].centsPerLoc);
    assert.ok(quotes[i].payoutCents > quotes[i - 1].payoutCents);
  }
});

test("effective rate with Client Network ranks: the rounded ship payout / LOC", () => {
  const bonuses = PRESTIGE_STORE_CONFIG.clientNetwork.rankPayoutBonus;
  for (let rank = 1; rank <= bonuses.length; rank += 1) {
    const ranks = { clientNetwork: rank };
    for (const key of FREELANCE_PROJECT_KEYS) {
      const { loc, reward } = BALANCE.freelanceProjects[key];
      const payout = Math.round(reward * (1 + bonuses[rank - 1]));
      const quote = freelancePayoutQuote(key, ranks);
      assert.equal(quote.payoutCents, payout, `${key} rank ${rank}`);
      assert.equal(freelanceShipPayoutCents(key, ranks), payout);
      assert.equal(quote.centsPerLoc, payout / loc, `${key} rank ${rank}`);
      assert.equal(quote.baseCentsPerLoc, reward / loc);
      assert.equal(quote.payoutBonus, bonuses[rank - 1]);
    }
  }
  // Pinned examples: +5% and +15%.
  assert.equal(freelancePayoutQuote("toDoListApp", { clientNetwork: 1 }).centsPerLoc, 63);
  assert.equal(freelancePayoutQuote("toDoListApp", { clientNetwork: 3 }).centsPerLoc, 69);
  assert.equal(freelancePayoutQuote("hobbyWebsite", { clientNetwork: 1 }).centsPerLoc, 50.4);
  assert.equal(freelancePayoutQuote("quantumToDoList", { clientNetwork: 2 }).centsPerLoc, 23.1);
});

test("rank past the max clamps like the multiplier; bad input is safe", () => {
  assert.deepEqual(
    freelancePayoutQuote("toDoListApp", { clientNetwork: 99 }),
    freelancePayoutQuote("toDoListApp", { clientNetwork: 3 })
  );
  assert.deepEqual(freelancePayoutQuote("toDoListApp", null), freelancePayoutQuote("toDoListApp"));
  assert.equal(freelancePayoutQuote("notAProject"), null);
  assert.equal(freelanceShipPayoutCents("notAProject", { clientNetwork: 1 }), 0);
});

test("the card number is what shipping pays: auto-ship cash uses the same payout", () => {
  const ranks = { clientNetwork: 2 };
  const unlockedProjects = Object.fromEntries(FREELANCE_PROJECT_KEYS.map((k) => [k, true]));
  const assignments = Object.fromEntries(FREELANCE_PROJECT_KEYS.map((k) => [k, 1]));
  const econ = releaseManagerShippingEconomics({
    assignments,
    managersOwned: FREELANCE_PROJECT_KEYS.length,
    unlockedProjects,
    permanentStoreRanks: ranks,
  });
  const shipsPerSecond =
    releaseManagerShipsPerInterval({}) / RELEASE_MANAGER_CONFIG.shipIntervalSeconds;
  for (const key of FREELANCE_PROJECT_KEYS) {
    assert.equal(
      econ.perProject[key].cashPerSecond,
      shipsPerSecond * freelancePayoutQuote(key, ranks).payoutCents
    );
  }
  assert.equal(clientNetworkPayoutMultiplier(ranks), 1.1);
});

test("the reducer's manual and auto ship both pay freelanceShipPayoutCents", () => {
  const context = src("context/GameContext.jsx");
  assert.equal((context.match(/shared\.freelanceShipPayoutCents\(/g) ?? []).length, 2);
  assert.ok(!/project\.reward\s*\*/.test(context), "no hand-rolled payout math left");
});

// --- The card text ---

test("formatCentsPerLoc: whole rates read clean, fractions stay exact, never NaN", () => {
  assert.equal(formatCentsPerLoc(60), "60¢/LOC");
  assert.equal(formatCentsPerLoc(50.4), "50.4¢/LOC");
  assert.equal(formatCentsPerLoc(30.45), "30.45¢/LOC");
  assert.equal(formatCentsPerLoc(100), "100¢/LOC");
  assert.equal(formatCentsPerLoc(NaN), "0¢/LOC");
  assert.equal(formatCentsPerLoc(undefined), "0¢/LOC");
});

test("projectPayoutLines: base cards show the rate alone, boosted cards say why", () => {
  assert.deepEqual(projectPayoutLines("toDoListApp", {}), {
    payout: "$30.00",
    rate: "60¢/LOC",
    rateNote: null,
  });
  assert.deepEqual(projectPayoutLines("toDoListApp", { clientNetwork: 1 }), {
    payout: "$31.50",
    rate: "63¢/LOC",
    rateNote: " (+5% Client Network)",
  });
  assert.equal(projectPayoutLines("hobbyWebsite", { clientNetwork: 1 }).rate, "50.4¢/LOC");
  for (const key of FREELANCE_PROJECT_KEYS) {
    assert.equal(projectPayoutLines(key).rate, `${BASE_RATES[key]}¢/LOC`);
    for (const text of Object.values(projectPayoutLines(key, { clientNetwork: 3 }))) {
      assert.ok(!text.includes("—"), "no em dash");
    }
  }
  assert.equal(projectPayoutLines("notAProject"), null);
});

// --- Both card types render a rate (source checks: the components import React) ---

test("both the unlocked card and the locked teaser render the rate line", () => {
  const rateLine = src("components/ProjectRateLine.jsx");
  assert.match(rateLine, /tag="@rate"/);
  assert.match(rateLine, /value=\{payout\.rate\}/);
  assert.match(rateLine, /suffix=\{payout\.rateNote/);
  for (const file of ["ProjectCard.jsx", "LockedFreelanceProjectCard.jsx"]) {
    const card = src(`components/${file}`);
    assert.match(card, /import \{ ProjectRateLine \} from "\.\/ProjectRateLine\.jsx"/, file);
    assert.match(card, /<ProjectRateLine payout=\{payout\} \/>/, file);
    // The payout line shows what a ship actually pays.
    assert.match(card, /value=\{payoutText\}/, file);
    assert.match(card, /<Panel/, file);
    // Derived, not hardcoded.
    assert.ok(!card.includes("¢"), `${file}: no hardcoded rate text`);
  }
  assert.match(src("components/ProjectCard.jsx"), /floatText=\{`\+\$\{payoutText\}`\}/);
  // The Projects tab hands both card types the readout, at the
  // player's Client Network rank.
  const projects = src("components/Projects.jsx");
  assert.match(projects, /projectPayoutLines\(\s*projectKey,\s*state\.permanentStoreRanks/);
  assert.equal((projects.match(/payout=\{payout\}/g) ?? []).length, 2);
});

// --- The Projects description ---

test("the Projects description explains the system, in voice, with no em dashes", async () => {
  const config = src("context/gameConfig.js");
  const block = config.slice(config.indexOf("  projects: {"), config.indexOf("  openSource: {"));
  const match = block.match(/description:\s*"([^"]+)"/);
  assert.ok(match, "projects has a description");
  const text = match[1];
  assert.ok(!text.includes("Convert LOC to Money"), "the stub is gone");
  assert.ok(!text.includes("—") && !text.includes("–"), "no em or en dash");
  assert.match(text, /LOC becomes money/);
  assert.match(text, /spends its LOC and pays out/);
  assert.match(text, /best rate per LOC/);
  assert.match(text, /more per ship/);
  assert.match(text, /Ship enough of the small stuff and bigger clients/);
  assert.match(text, /Release Managers, then assign them on a project's card to ship it automatically/);
});
