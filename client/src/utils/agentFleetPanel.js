/**
 * Agent Fleet, slices 2 and 3 (issue #267): the Review panel's and the
 * Coding Agent card's text, as plain data. Every number comes from the
 * shared AGENT_FLEET_CONFIG helpers; the components only render this.
 *
 * Framework-free (no React) so the server tests can pin the copy.
 * Copy rules: no em or en dashes.
 */
import {
  AGENT_FLEET_CONFIG,
  agentFleetOf,
  agentFleetStatus,
  agentFleetStatusText,
  agentHireBulkPriceCents,
  agentPrCardLines,
  agentPrPayoutLoc,
  agentTokenBillCents,
  agentTopPullRequest,
  refactorSprintBlocker,
  refactorSprintDebtAfter,
  refactorSprintPriceCents,
  techDebtDragPercent,
} from "../../../shared/game-balance.js";
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { reviewQueueHeader } from "./workMode.js";

/** "30%": debt as the bar's label (one decimal at most). */
export function techDebtLabel(debt) {
  return `${formatNumber(agentFleetOf({ debt }).debt)}%`;
}

/** The Write code mode's compact line, or null with no debt. */
export function writeModeDebtLine(fleet) {
  const debt = agentFleetOf(fleet).debt;
  if (!(debt > 0)) return null;
  return `Tech debt ${techDebtLabel(debt)}: every commit pays it down`;
}

/** Seconds until the next PR with the queue open, or null when paused or idle. */
export function secondsToNextPr(fleet) {
  const current = agentFleetOf(fleet);
  if (current.agents === 0) return null;
  const remaining = AGENT_FLEET_CONFIG.prIntervalSeconds - current.progress;
  return Math.max(1, Math.ceil(remaining / current.agents));
}

/**
 * The whole Review panel model for a state-like object: { agentFleet,
 * money } plus P (the buffed healthy LOC/s, never the live rate).
 */
export function reviewPanelModel({ agentFleet, money }, buffedLocPerSec) {
  const fleet = agentFleetOf(agentFleet);
  const status = agentFleetStatus(fleet, money, buffedLocPerSec);
  const pr = agentTopPullRequest(fleet);
  const sprintPrice = refactorSprintPriceCents(buffedLocPerSec);
  const sprintBlocker = refactorSprintBlocker(fleet, money, buffedLocPerSec);
  const billCents = agentTokenBillCents(fleet.agents, buffedLocPerSec);
  return {
    header: reviewQueueHeader(fleet.queue.length),
    agents: fleet.agents,
    open: fleet.queue.length,
    debt: fleet.debt,
    debtLabel: `Tech debt ${techDebtLabel(fleet.debt)}`,
    dragLabel: `-${formatNumber(techDebtDragPercent(fleet.debt))}% production`,
    debtHigh: fleet.debt >= AGENT_FLEET_CONFIG.debtMailThreshold,
    status,
    statusText: agentFleetStatusText(status),
    // The token bill while agents work; paused agents bill nothing.
    billLabel:
      fleet.agents === 0
        ? null
        : status === "working"
          ? `Token bill ${formatMoney(billCents)}/s`
          : `Token bill paused (${formatMoney(billCents)}/s)`,
    nextPrSeconds: status === "working" ? secondsToNextPr(fleet) : null,
    pr: pr
      ? {
          ...pr,
          lines: agentPrCardLines(pr),
          payoutLabel: `+${formatNumber(agentPrPayoutLoc(buffedLocPerSec))}`,
        }
      : null,
    sprint: {
      label: `Refactor Sprint (${formatMoney(sprintPrice)})`,
      priceCents: sprintPrice,
      disabled: sprintBlocker !== null,
      reason: sprintBlocker,
      debtAfter: refactorSprintDebtAfter(fleet.debt),
    },
  };
}

/** The Coding Agent card's numbers at the selected bulk quantity. */
export function codingAgentCardModel({ agentFleet, money }, buffedLocPerSec, quantity = 1) {
  const fleet = agentFleetOf(agentFleet);
  const priceCents = agentHireBulkPriceCents(fleet.agents, quantity, buffedLocPerSec);
  const perAgent = agentTokenBillCents(1, buffedLocPerSec);
  const fleetBill = agentTokenBillCents(fleet.agents, buffedLocPerSec);
  return {
    owned: fleet.agents,
    priceCents,
    canAfford: Number(money) >= priceCents,
    hireLabel: quantity > 1 ? `Hire x${quantity}` : "Hire",
    costLine: `x${formatNumber(AGENT_FLEET_CONFIG.hireCostMultiplier)} per hire`,
    prLine: `1 PR per ${AGENT_FLEET_CONFIG.prIntervalSeconds}s per agent, no LOC/s`,
    payoutLine: `${formatNumber(agentPrPayoutLoc(buffedLocPerSec))} LOC per approved PR`,
    billLine: `${formatMoney(perAgent)}/s per agent in tokens`,
    billSuffix: fleet.agents > 0 ? ` (${formatMoney(fleetBill)}/s for the fleet)` : "",
  };
}
