/**
 * The star claim label as a CI badge (issue #212, Slice A of #210), as
 * pure data so the server test suite pins it. Presentation only: the
 * claim, its rewards and its label text are exactly what they were.
 *
 * - kind: which badge skin the claim wears.
 *   - "moon": the To the Moon jackpot (a red star's good outcome).
 *   - "fail": a red star's crash.
 *   - "chain": a Shooting Stars chain step (it carries chainStep).
 *   - "pass": every other gold star claim.
 * - chip: the short prefix in front of the name ("✓ PASS", "✗ FAIL",
 *   "🚀 x25", or the chain step's multiple "x7", "x77", "x777").
 * - name / detail: the label split on its first "! ": the effect name
 *   (the badge title) and what it did (the badge body).
 */
import {
  MOONSHOT_CONFIG,
  shootingStarsChainMultiple,
} from "../../../shared/game-balance.js";

/** The badge skin for a resolved claim. */
export function starBadgeKind(claim) {
  if (claim?.red) return claim.effect === "moonshot" ? "moon" : "fail";
  if (claim?.chainStep) return "chain";
  return "pass";
}

/** The prefix chip text for a resolved claim. */
export function starBadgeChip(claim) {
  switch (starBadgeKind(claim)) {
    case "moon":
      return `🚀 x${MOONSHOT_CONFIG.jackpotMultiplier}`;
    case "fail":
      return "✗ FAIL";
    case "chain":
      return `x${shootingStarsChainMultiple(claim.chainStep)}`;
    default:
      return "✓ PASS";
  }
}

/**
 * Split a star label ("Airdrop! +$33.01K") on its first "! " into the
 * name ("Airdrop!", keeping its "!") and the detail ("+$33.01K"). A
 * label with no detail ("Golden Star!") is all name.
 */
export function splitStarLabel(label) {
  const text = String(label ?? "");
  const at = text.indexOf("! ");
  if (at < 0) return { name: text, detail: "" };
  return { name: text.slice(0, at + 1), detail: text.slice(at + 2) };
}

/**
 * Everything the star label renders, from the claim and its label
 * string. `label` is kept whole for the accessible name.
 */
export function starBadge(claim, label) {
  return {
    label: String(label ?? ""),
    ...splitStarLabel(label),
    kind: starBadgeKind(claim),
    chip: starBadgeChip(claim),
  };
}
