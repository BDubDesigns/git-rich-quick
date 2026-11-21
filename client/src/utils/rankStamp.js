/**
 * Rank stamp (issue #217, Slice 5 of the #210 game-feel pass): what a
 * permanent store purchase stamps on its track's panel, as pure data so
 * the server test suite pins it. Presentation only: the purchase is
 * the existing buyStoreRank, untouched.
 *
 * After a successful buy, the bought track's panel gets:
 * - its rank line bumped in gold (the Slice 2 stat bump);
 * - a gold border flash with a fading glow, 450ms;
 * - Funding Rounds only: a ROUND CLOSED chip (a small Slice 3 stamp)
 *   for 1.2s.
 * One stamp at a time: a new purchase replaces it (restart, no stack).
 */

/** The copy (no dashes). */
export const ROUND_CLOSED_TEXT = "ROUND CLOSED";

/** The flash and the bump, ms; the Funding Rounds chip, ms (RankStamp.css). */
export const RANK_STAMP_MS = 450;
export const ROUND_CLOSED_MS = 1200;

/** The stamp for a successful purchase of `storeId` (seq numbers the purchases). */
export function rankStampFor(storeId, prev) {
  return {
    storeId,
    key: (prev?.key ?? 0) + 1,
    roundClosed: storeId === "fundingRounds",
  };
}

/** Whether the stamp is on this track's panel. */
export function rankStampOn(stamp, storeId) {
  return Boolean(stamp) && stamp.storeId === storeId;
}
