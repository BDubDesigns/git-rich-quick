import { InfoDialog } from "./InfoDialog.jsx";
import {
  FARM_LIGHTING,
  FARM_LIGHTING_COLORS,
  LLAMA_ECONOMY,
} from "../../../shared/game-balance.js";

/**
 * The Farm's Mood lighting legend as a popup (Brandon, Nov 21: "Mood
 * lighting and herd book should be popups also like how breeding
 * works"). What each light does, its odds, and the Mama boost, in the
 * same InfoDialog shell as the breeding guide. The dots are the same
 * light dots the stall tiles show (PR #259), and every number is read
 * from FARM_LIGHTING and LLAMA_ECONOMY.
 */
export function MoodLightingGuide({ open, onClose }) {
  return (
    <InfoDialog
      open={open}
      onClose={onClose}
      titleId="mood-lighting-title"
      title="Mood lighting"
    >
      <div className="flex flex-col gap-1">
        {FARM_LIGHTING_COLORS.map((colorId) => {
          const lighting = FARM_LIGHTING[colorId];
          return (
            <p key={colorId} className="m-0">
              <span style={{ color: lighting.color }}>●</span>{" "}
              <strong>{lighting.label}:</strong> {lighting.description}{" "}
              <span className="text-xs">
                (kid {Math.round(lighting.kidChance * 100)}% per tick, new
                type {Math.round(lighting.newTypeChance * 100)}% of kids)
              </span>
            </p>
          );
        })}
        <p className="m-0">
          <strong>Mama Llama:</strong> an empty stall beside a Mama rolls
          kids {LLAMA_ECONOMY.mamaKidChanceMultiplier}x as often (up to{" "}
          {Math.round(LLAMA_ECONOMY.maxKidChance * 100)}% per tick). Her
          kids take the other parent's type. Breed fast, sell the kids.
        </p>
      </div>
    </InfoDialog>
  );
}
