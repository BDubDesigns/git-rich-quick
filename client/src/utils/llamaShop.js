/**
 * The farm shop's buy rule (issues #129 and #203), as a pure function
 * so the server test suite pins it without React. The reducer's
 * BUY_LLAMA calls it.
 *
 * A buy needs: the farm owned, a real stall index, an empty stall, a
 * type the shop sells (shared llamaShopTypes: the base types plus every
 * bred type this farm has discovered), and the cash for the type's
 * llamaBuyPriceCents at the player's buffed LOC/s. Prices come only
 * from the shared helper; nothing here changes them. The bought llama
 * stores its sell value on the stall (issue #244): half of the price
 * actually paid, never recomputed.
 */
import {
  FARM_CONFIG,
  boughtLlamaSellCents,
  llamaBuyPriceCents,
  llamaShopTypes,
} from "../../../shared/game-balance.js";

/**
 * Apply a buy. Returns `{ farm, money, price }` (the new farm with the
 * llama placed and the type unlocked, the money after paying) or null
 * when the buy is not allowed, in which case nothing changes.
 */
export function applyLlamaBuy({ farm, money, stallIndex, type, buffedLocPerSec }) {
  if (!farm?.owned) return null;
  if (
    typeof stallIndex !== "number" ||
    stallIndex < 0 ||
    stallIndex >= FARM_CONFIG.stallCount ||
    !llamaShopTypes(farm.unlockedTypes).includes(type)
  ) {
    return null;
  }
  const stall = farm.stalls?.[stallIndex];
  if (!stall || stall.llama !== null) return null;
  // The price is seconds of S at the player's buffed LOC/s, priced at
  // the moment of purchase.
  const price = llamaBuyPriceCents(type, buffedLocPerSec);
  if (!(price > 0) || money < price) return null;
  const sellCents = boughtLlamaSellCents(price);
  const stalls = farm.stalls.map((entry, i) =>
    i === stallIndex ? { ...entry, llama: type, sellCents } : entry
  );
  const unlockedTypes = (farm.unlockedTypes ?? []).includes(type)
    ? [...(farm.unlockedTypes ?? [])]
    : [...(farm.unlockedTypes ?? []), type];
  return { farm: { ...farm, stalls, unlockedTypes }, money: money - price, price };
}
