/**
 * The IPO Roadshow card's collapse preference and its copy (issue
 * #266), framework-free so the server tests exercise it with a fake
 * storage, like utils/nightShiftCard.js.
 *
 * - The open/closed choice is a device preference: localStorage under
 *   `grq:roadshowOpen`, never the save. Collapsed is the default (the
 *   Hire cards' pattern, PR #262).
 * - roadshowCardModel turns the shared Roadshow helpers into the
 *   strings and rows the card shows (collapsed row, expanded detail),
 *   so the two views cannot disagree. No gate, price or Equity math
 *   lives here: every number comes from shared/game-balance.js.
 *
 * Copy rules: no em or en dashes.
 */
import {
  ROADSHOW_CONFIG,
  ROADSHOW_MAX_STAGE,
  companyLocEarned,
  fundingRoundRank,
  intermissionOpen,
  roadshowBonusEquity,
  roadshowGateProgress,
  roadshowNextPurchase,
  roadshowPriceCents,
  roadshowStageOf,
  roadshowVisible,
} from "../../../shared/game-balance.js";

/** localStorage key for the card's open/closed choice. */
export const ROADSHOW_OPEN_KEY = "grq:roadshowOpen";

function defaultStorage() {
  try {
    if (
      typeof globalThis.localStorage !== "undefined" &&
      globalThis.localStorage &&
      typeof globalThis.localStorage.getItem === "function"
    ) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage blocked (private mode): fall through to no storage.
  }
  return null;
}

/** Whether the card is open on this device. Missing, junk or blocked
 *  storage reads collapsed (false). */
export function readRoadshowOpen(storage = defaultStorage()) {
  try {
    return storage ? storage.getItem(ROADSHOW_OPEN_KEY) === "1" : false;
  } catch {
    return false;
  }
}

/** Remember the open/closed choice. A throwing storage is ignored. */
export function writeRoadshowOpen(open, storage = defaultStorage()) {
  try {
    storage?.setItem(ROADSHOW_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Quota or private mode: keep the in-memory state only.
  }
}

/** The total bonus the Roadshow pays (100). */
export const ROADSHOW_TOTAL_EQUITY = roadshowBonusEquity(ROADSHOW_MAX_STAGE);

/**
 * Everything the card shows, from the reducer state and the buffed
 * healthy LOC/s (getBaseLocPerSecond, the price basis). Null when the
 * card is hidden (before Series C, or in the post-sale intermission,
 * where the permanent store has the screen).
 *
 * - stage, bonusEquity, chip ("2/6", "6/6 Done", "Closed at IPO")
 * - status: "open" | "done" (all six bought, IPO not yet) | "closed" (IPO owned)
 * - next: the shared next purchase (or null), with shortReason /
 *   blockedReason for the disabled button
 * - rows: one per milestone, { n, name, quip, equity, priceMinutes,
 *   priceCents, gate, state: "bought" | "next" | "later" | "missed" }
 */
export function roadshowCardModel(state, buffedLocPerSec) {
  const ranks = state?.permanentStoreRanks ?? {};
  if (!roadshowVisible(ranks) || intermissionOpen(state)) return null;
  const stage = roadshowStageOf(state?.roadshowStage);
  const runLoc = companyLocEarned(state ?? {});
  const ipoOwned = fundingRoundRank(ranks) > ROADSHOW_CONFIG.fundingRank;
  const next = roadshowNextPurchase({
    stage,
    storeRanks: ranks,
    money: state?.money ?? 0,
    runLoc,
    buffedLocPerSec,
  });
  const status = ipoOwned ? "closed" : stage >= ROADSHOW_MAX_STAGE ? "done" : "open";
  let blockedReason = "";
  let shortReason = "";
  if (next && !next.gate.met) {
    blockedReason = "This company needs more lines of code first.";
    shortReason = "Locked";
  } else if (next && !next.affordable) {
    blockedReason = "Not enough cash yet.";
    shortReason = "Need more cash";
  }
  const chip =
    status === "closed"
      ? "Closed at IPO"
      : status === "done"
        ? `${stage}/${ROADSHOW_MAX_STAGE} Done`
        : `${stage}/${ROADSHOW_MAX_STAGE}`;
  const rows = ROADSHOW_CONFIG.milestones.map((milestone, i) => {
    const n = i + 1;
    let rowState = "later";
    if (n <= stage) rowState = "bought";
    else if (status === "closed") rowState = "missed";
    else if (n === stage + 1) rowState = "next";
    return {
      n,
      id: milestone.id,
      name: milestone.name,
      quip: milestone.quip,
      equity: milestone.equity,
      priceMinutes: milestone.priceMinutes,
      priceCents: roadshowPriceCents(n, buffedLocPerSec),
      gate: roadshowGateProgress(n, runLoc),
      state: rowState,
    };
  });
  return {
    stage,
    maxStage: ROADSHOW_MAX_STAGE,
    bonusEquity: roadshowBonusEquity(stage),
    totalEquity: ROADSHOW_TOTAL_EQUITY,
    status,
    chip,
    next,
    blockedReason,
    shortReason,
    rows,
  };
}
