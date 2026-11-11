import { useGameContext } from "../context/useGameContext.js";
import { SectionLayout } from "./SectionLayout.jsx";
import { Button } from "./Button.jsx";
import {
  FARM_CONFIG,
  FARM_LIGHTING,
  FARM_LIGHTING_COLORS,
  LLAMA_TYPES,
  LLAMA_TYPE_DESCRIPTIONS,
  LLAMA_TYPE_NAMES,
  farmEligibleBreedingStalls,
  farmLlamaCount,
} from "../../../shared/game-balance.js";
import { formatMoney } from "../../../shared/formatNumber.js";

/**
 * Llama Farm tab (issue #79). A business you buy with pure money, and
 * a breeding mini-game. No soil — the farm uses MOOD and STALLS.
 *
 * Each tile is a barn stall. Click a stall to cycle its lighting color
 * (the mood); the empty stall's own lighting sets the breeding odds for
 * a kid appearing there. An empty stall with two llamas beside it can
 * produce a kid, usually one of the parents' types, sometimes a
 * brand-new type. Llamas have no genders — any two can breed.
 *
 * There is no llama icon in react-icons, so the stalls render the
 * llama emoji. It is a game about llamas; the emoji is the point.
 */
export function Farm() {
  const { state, dispatch } = useGameContext();
  const farm = state.farm ?? { owned: false, stalls: [], unlockedTypes: [] };

  const handleBuyFarm = () => {
    dispatch({ type: "BUY_FARM" });
  };

  const handleCycleLighting = (stallIndex) => {
    const stall = farm.stalls[stallIndex];
    if (!stall) return;
    const current = FARM_LIGHTING_COLORS.indexOf(stall.lighting);
    const next =
      FARM_LIGHTING_COLORS[
        (current + 1) % FARM_LIGHTING_COLORS.length
      ];
    dispatch({
      type: "SET_STALL_LIGHTING",
      payload: { stallIndex, lighting: next },
    });
  };

  if (!farm.owned) {
    const canAfford = state.money >= FARM_CONFIG.purchaseCostCents;
    return (
      <SectionLayout sectionId="farm">
        <div className="flex flex-col gap-2 p-3 border border-[#3a3a3a] rounded bg-[#1e1e1e]">
          <p className="m-0">
            Your staff have been dreaming of quitting to start an alpaca
            farm. You let them build it — but you never accepted their
            notice, so they are still employees. The llamas are
            unionizing. The barn has mood lighting. This is fine.
          </p>
          <p className="m-0">
            Buy the barn and 5 llamas move in — 3 Classics, 2 Dramas.
            Set the lights, let them breed, and discover new types. The
            farm generates no cash yet (that is the next slice); for now
            it generates llamas, which is arguably better.
          </p>
          <Button onClick={handleBuyFarm} disabled={!canAfford}>
            Buy the Llama Farm — {formatMoney(FARM_CONFIG.purchaseCostCents)}
          </Button>
          {!canAfford && (
            <p className="m-0 text-sm">
              You need {formatMoney(FARM_CONFIG.purchaseCostCents)} — ship
              some projects first.
            </p>
          )}
        </div>
      </SectionLayout>
    );
  }

  const eligible = farmEligibleBreedingStalls(farm.stalls);
  const llamaCount = farmLlamaCount(farm.stalls);

  return (
    <SectionLayout sectionId="farm">
      <p className="m-0 text-sm">
        {llamaCount} {llamaCount === 1 ? "llama" : "llamas"} in the barn.{" "}
        {eligible.length > 0
          ? `${eligible.length} empty ${eligible.length === 1 ? "stall" : "stalls"} can breed right now — a kid appears about every few breeding ticks.`
          : "No empty stall sits between two llamas right now, so nothing can breed."}{" "}
        Click a stall to cycle its lighting (the mood).
      </p>

      {/* Barn stalls: a 3x3 grid. Each stall shows its llama (or Empty)
          and its lighting color as a tint. Clicking cycles the mood. */}
      <div
        className="grid grid-cols-3 gap-2"
        role="group"
        aria-label="Barn stalls"
      >
        {farm.stalls.map((stall, index) => {
          const lighting = FARM_LIGHTING[stall.lighting] ?? FARM_LIGHTING.warm;
          const isEligible = eligible.includes(index);
          return (
            <button
              key={index}
              type="button"
              onClick={() => handleCycleLighting(index)}
              className="flex flex-col items-center gap-1 p-2 border rounded min-h-[84px] cursor-pointer"
              style={{
                backgroundColor: `${lighting.color}22`,
                borderColor: isEligible ? lighting.color : "#3a3a3a",
                borderWidth: isEligible ? 2 : 1,
              }}
              title={`${lighting.label}: ${lighting.description} Click to change the lighting.`}
              aria-label={
                stall.llama
                  ? `Stall ${index + 1}: ${LLAMA_TYPE_NAMES[stall.llama]}, ${lighting.label} lighting`
                  : `Stall ${index + 1}: empty, ${lighting.label} lighting${
                      isEligible ? ", can breed" : ""
                    }`
              }
            >
              <span className="text-2xl" aria-hidden="true">
                {stall.llama ? "🦙" : "·"}
              </span>
              <span className="text-sm text-center">
                {stall.llama ? LLAMA_TYPE_NAMES[stall.llama] : "Empty stall"}
              </span>
              <span className="text-xs" style={{ color: lighting.color }}>
                {lighting.label}
                {isEligible ? " · can breed" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lighting legend: what each mood does. */}
      <div className="flex flex-col gap-1 text-sm">
        <p className="m-0 font-semibold">Mood lighting</p>
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
      </div>

      {/* Discovered types: the collection. */}
      <div className="flex flex-col gap-1">
        <p className="m-0 font-semibold">
          Discovered types ({farm.unlockedTypes.length}/{LLAMA_TYPES.length})
        </p>
        {LLAMA_TYPES.map((type) => {
          const discovered = farm.unlockedTypes.includes(type);
          return (
            <p key={type} className="m-0 text-sm">
              {discovered ? "🦙 " : "· "}
              <strong>{LLAMA_TYPE_NAMES[type]}</strong>
              {discovered ? (
                <> — {LLAMA_TYPE_DESCRIPTIONS[type]}</>
              ) : (
                " — undiscovered. Breed for it."
              )}
            </p>
          );
        })}
      </div>
    </SectionLayout>
  );
}
