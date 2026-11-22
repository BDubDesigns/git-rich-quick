import { InfoDialog } from "./InfoDialog.jsx";
import { herdBookHiddenHint } from "../utils/breedingGuide.js";
import {
  llamaShopTypes,
  LLAMA_ECONOMY,
  LLAMA_TYPES,
  LLAMA_TYPE_DESCRIPTIONS,
  LLAMA_TYPE_NAMES,
  formatEstimateDuration,
  llamaBuyPriceCents,
  llamaSellPriceCents,
} from "../../../shared/game-balance.js";
import { formatMoney } from "../../../shared/formatNumber.js";

/**
 * The Farm's herd book as a popup (Brandon, Nov 21: "Mood lighting and
 * herd book should be popups also like how breeding works"). Every
 * kind, its price as time, and its value, in the same InfoDialog shell
 * as the breeding guide. Prices are time at the player's buffed LOC/s
 * (pricingRate), the same rate the stalls and the shop use.
 */
export function HerdBook({ open, onClose, unlockedTypes, pricingRate }) {
  return (
    <InfoDialog
      open={open}
      onClose={onClose}
      titleId="herd-book-title"
      title={`Herd book (${unlockedTypes.length}/${LLAMA_TYPES.length} discovered)`}
    >
      <div className="flex flex-col gap-1">
        {LLAMA_TYPES.map((type) => {
          const discovered = unlockedTypes.includes(type);
          const forSale = llamaShopTypes(unlockedTypes).includes(type);
          // Issue #238: an undiscovered bred type (not in the shop yet)
          // reads ??? so its name stays a surprise. Brandon, Nov 21: it
          // hides its prices too, and shows only ??? and the hint.
          if (!forSale) {
            return (
              <p key={type} className="m-0 text-sm">
                {"· "}
                <strong>??? (undiscovered)</strong>. Breed one to find it.
              </p>
            );
          }
          return (
            <p key={type} className="m-0 text-sm">
              {discovered ? "🦙 " : "· "}
              <strong>{LLAMA_TYPE_NAMES[type]}</strong>{" "}
              <span className="text-xs text-gray-400">
                (buy{" "}
                {formatMoney(llamaBuyPriceCents(type, pricingRate))},{" "}
                {formatEstimateDuration(LLAMA_ECONOMY.typeSeconds[type])} of
                shipping; sells for{" "}
                {formatMoney(llamaSellPriceCents(type, pricingRate))})
              </span>
              {discovered ? (
                <>: {LLAMA_TYPE_DESCRIPTIONS[type]}</>
              ) : (
                ", in the shop. Buy one to meet it."
              )}
            </p>
          );
        })}
        {LLAMA_TYPES.some((type) => !llamaShopTypes(unlockedTypes).includes(type)) && (
          <p className="m-0 text-xs text-gray-400">{herdBookHiddenHint()}</p>
        )}
      </div>
    </InfoDialog>
  );
}
