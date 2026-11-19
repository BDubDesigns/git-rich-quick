// Freelance project payout readout (issue #176): the text both project
// cards (ProjectCard and LockedFreelanceProjectCard) show for what a
// ship pays and the rate in cents per LOC. Pure, no React, so the
// server test suite pins it directly. Every number comes from
// freelancePayoutQuote in shared/game-balance.js, which is the payout
// logic shipping uses; nothing here is a per-project string.
import { formatMoney } from "../../../shared/formatNumber.js";
import { freelancePayoutQuote } from "../../../shared/game-balance.js";

/**
 * A rate in cents per LOC as card text: "60¢/LOC", "50.4¢/LOC",
 * "30.45¢/LOC". Up to two decimals, trailing zeros dropped, so whole
 * rates read clean and Client Network fractions stay exact. A missing
 * or non-finite rate reads "0¢/LOC", never "NaN".
 */
export function formatCentsPerLoc(centsPerLoc) {
  const rate = Number.isFinite(centsPerLoc) && centsPerLoc > 0 ? centsPerLoc : 0;
  const text = rate.toFixed(2).replace(/\.?0+$/, "");
  return `${text}¢/LOC`;
}

/**
 * The card lines for one project at the player's Client Network rank:
 *
 * - payout: one ship's payout as money ("$31.50"), what actually lands.
 * - rate: the effective rate ("63¢/LOC").
 * - rateNote: where a boosted rate came from (" (+5% Client Network)"),
 *   or null with no ranks, so an unboosted card shows the rate alone.
 *
 * An unknown project key returns null (the card renders no rate line
 * rather than a wrong one).
 */
export function projectPayoutLines(projectKey, storeRanks = {}) {
  const quote = freelancePayoutQuote(projectKey, storeRanks ?? {});
  if (!quote) return null;
  const bonusPercent = Math.round(quote.payoutBonus * 100);
  return {
    payout: formatMoney(quote.payoutCents),
    rate: formatCentsPerLoc(quote.centsPerLoc),
    rateNote: bonusPercent > 0 ? ` (+${bonusPercent}% Client Network)` : null,
  };
}
