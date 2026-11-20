// Freelance project payout readout (issue #176): the text both project
// cards (ProjectCard and LockedFreelanceProjectCard) show for what a
// ship pays and the rate in cents per LOC. Pure, no React, so the
// server test suite pins it directly. Every number comes from
// freelancePayoutQuote in shared/game-balance.js, which is the payout
// logic shipping uses; nothing here is a per-project string.
import { formatMoney } from "../../../shared/formatNumber.js";
import {
  freelancePayoutQuote,
  starEffectName,
} from "../../../shared/game-balance.js";

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
 * - rateNote: where a changed rate came from (" (+5% Client Network)",
 *   " (2x Hype Train)", " (+5% Client Network, 0.5x Derailment)"), or
 *   null when nothing changes it, so a plain card shows the rate alone.
 * - rateTone: "gain" when the rate is above base, "loss" below (a
 *   Derailment), null at base: the note's color.
 *
 * `effects` carries the live star effects ({ activeStarEffects }), so a
 * Hype Train (issue #157) shows on the card while it pays. An unknown
 * project key returns null (the card renders no rate line rather than
 * a wrong one).
 */
export function projectPayoutLines(projectKey, storeRanks = {}, effects = {}) {
  const quote = freelancePayoutQuote(projectKey, storeRanks ?? {}, effects ?? {});
  if (!quote) return null;
  const bonusPercent = Math.round(quote.payoutBonus * 100);
  const notes = [];
  if (bonusPercent > 0) notes.push(`+${bonusPercent}% Client Network`);
  if (quote.hypeMultiplier !== 1) {
    notes.push(
      `${quote.hypeMultiplier}x ${starEffectName("hype", quote.hypeMultiplier > 1)}`
    );
  }
  return {
    payout: formatMoney(quote.payoutCents),
    rate: formatCentsPerLoc(quote.centsPerLoc),
    rateNote: notes.length > 0 ? ` (${notes.join(", ")})` : null,
    rateTone:
      quote.centsPerLoc > quote.baseCentsPerLoc
        ? "gain"
        : quote.centsPerLoc < quote.baseCentsPerLoc
          ? "loss"
          : null,
  };
}
