/**
 * Bridge Round card copy (issue #192), as pure functions of the store
 * ranks, so the server test suite can pin it without React. Every cap
 * number is read from the shared helpers, so the copy can never drift
 * from the rule the reducer and the validator enforce.
 *
 * Copy rules: no em dashes or en dashes in player-facing text.
 */
import {
  OPEN_SOURCE_DISPLAY_NAMES,
  bridgeRoundAvailable,
  fundingRoundName,
  fundingRoundRank,
  openSourceLevelCap,
} from "../../../shared/game-balance.js";

/**
 * Whether the Bridge Round card shows closed (issue #226): no bridge is
 * offered at the owned rank, which is IPO, the final round.
 */
export function bridgeRoundClosed(storeRanks = {}) {
  return !bridgeRoundAvailable(storeRanks);
}

/**
 * The closed card's one line (issue #226), null while a bridge is
 * offered. Two facts: the player owns the final round, and the bridge
 * line is complete because there is no next round to rent.
 */
export function bridgeRoundClosedText(storeRanks = {}) {
  if (!bridgeRoundClosed(storeRanks)) return null;
  const round = fundingRoundName(fundingRoundRank(storeRanks));
  return `You own ${round}, the final round. The bridge line is complete: there is no next round left to rent.`;
}

/** The round a Bridge Round rents at these store ranks, or null when none is offered. */
export function bridgeRoundTargetName(storeRanks = {}) {
  if (!bridgeRoundAvailable(storeRanks)) return null;
  return fundingRoundName(fundingRoundRank(storeRanks) + 1);
}

/** "CoffeeScript, Junior Achievement and Senior Moment to v.9.0, ..." at the bridged caps. */
export function bridgeRoundCapsText(storeRanks = {}) {
  const bridged = { bridgeRound: 1 };
  const name = (id) => OPEN_SOURCE_DISPLAY_NAMES[id] ?? id;
  const cap = (id) => `v.${openSourceLevelCap(id, storeRanks, bridged)}.0`;
  return (
    `${name("coffeeScript")}, ${name("juniorAchievement")} and ` +
    `${name("seniorMoment")} to ${cap("seniorMoment")}, ` +
    `${name("scrumMaster")} to ${cap("scrumMaster")}, ` +
    `${name("commitmentIssues")} to ${cap("commitmentIssues")}, ` +
    `${name("shipHappens")} to ${cap("shipHappens")}`
  );
}

/** What buying the bridge does, for the card's next-bonus line (null when none is offered). */
export function bridgeRoundOfferText(storeRanks = {}) {
  const target = bridgeRoundTargetName(storeRanks);
  if (!target) return null;
  return `Rents ${target} caps for this company: ${bridgeRoundCapsText(storeRanks)}`;
}

/** The owned bridge's status line (null when none is offered). */
export function bridgeRoundOwnedText(storeRanks = {}) {
  const target = bridgeRoundTargetName(storeRanks);
  if (!target) return null;
  return `Renting ${target} caps until you sell. Raise ${target} with Equity after a sale and they are yours for free.`;
}

/** The floating text on the buy. */
export function bridgeRoundFloatText(storeRanks = {}) {
  const target = bridgeRoundTargetName(storeRanks);
  return target ? `Bridged to ${target}!` : "";
}
