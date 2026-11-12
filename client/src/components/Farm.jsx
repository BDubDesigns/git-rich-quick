import { useState } from "react";
import { useGameContext } from "../context/useGameContext.js";
import { SectionLayout } from "./SectionLayout.jsx";
import { Button } from "./Button.jsx";
import {
  FARM_CONFIG,
  FARM_LIGHTING,
  FARM_LIGHTING_COLORS,
  LLAMA_BASE_TYPES,
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
 * Each tile is a barn stall. Click a stall with a llama to cycle its
 * lighting color (the mood); the empty stall's own lighting sets the
 * breeding odds for a kid appearing there. Click an empty stall to
 * select it, then buy a base llama into it — no llamas come free with
 * the barn. An empty stall with two llamas beside it can produce a
 * kid, usually one of the parents' types, sometimes a brand-new type.
 * Llamas have no genders — any two can breed. Breeding is rolled on
 * the client (shared.rollFarmBreeding) every breedingTickSeconds.
 *
 * There is no llama icon in react-icons, so the stalls render the
 * llama emoji. It is a game about llamas; the emoji is the point.
 */
export function Farm() {
  const { state, dispatch } = useGameContext();
  const farm = state.farm ?? { owned: false, stalls: [], unlockedTypes: [] };
  // The empty stall selected for buying a llama (null when none).
  const [selectedStall, setSelectedStall] = useState(null);

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

  const handleStallClick = (stallIndex) => {
    const stall = farm.stalls[stallIndex];
    if (!stall) return;
    if (stall.llama) {
      // A stall with a llama: cycle its lighting (the mood).
      setSelectedStall(null);
      handleCycleLighting(stallIndex);
      return;
    }
    // An empty stall: select it for buying (click again to deselect).
    setSelectedStall((current) =>
      current === stallIndex ? null : stallIndex
    );
  };

  const handleBuyLlama = (type) => {
    if (selectedStall === null) return;
    dispatch({
      type: "BUY_LLAMA",
      payload: { stallIndex: selectedStall, type },
    });
    setSelectedStall(null);
  };

  if (!farm.owned) {
    const canAfford = state.money >= FARM_CONFIG.purchaseCostCents;
    return (
      <SectionLayout sectionId="farm">
        <div className="panel flex flex-col gap-2 p-3">
          <p className="m-0 text-sm">
            Your staff have been dreaming of quitting to start an alpaca
            farm. You let them build it, but you never accepted their
            notice, so they are still employees. The llamas are
            unionizing. The barn has mood lighting. This is fine.
          </p>
          <p className="m-0 text-sm">
            Buy the barn and it arrives empty. No llamas come with it.
            Buy base llamas, move them in, set the lights, and let them
            breed to discover new types. The farm generates no cash yet
            (that is the next slice); for now it generates llamas, which
            is arguably better.
          </p>
          <Button onClick={handleBuyFarm} disabled={!canAfford}>
            Buy the Llama Farm ({formatMoney(FARM_CONFIG.purchaseCostCents)})
          </Button>
          {!canAfford && (
            <p className="m-0 text-sm">
              You need {formatMoney(FARM_CONFIG.purchaseCostCents)}. Ship
              some projects first.
            </p>
          )}
        </div>
      </SectionLayout>
    );
  }

  const eligible = farmEligibleBreedingStalls(farm.stalls);
  const llamaCount = farmLlamaCount(farm.stalls);
  const canAffordLlama = state.money >= FARM_CONFIG.llamaPriceCents;
  const selectedStallState =
    selectedStall !== null ? farm.stalls[selectedStall] : null;
  const selectedStallEmpty =
    selectedStallState !== null && selectedStallState.llama === null;

  return (
    <SectionLayout sectionId="farm">
      <p className="m-0 text-sm">
        {llamaCount} {llamaCount === 1 ? "llama" : "llamas"} in the barn.{" "}
        {llamaCount === 0
          ? "The barn is empty. Buy your first llamas below to start breeding."
          : eligible.length > 0
            ? `${eligible.length} empty ${eligible.length === 1 ? "stall" : "stalls"} can breed right now. A kid appears about every few breeding ticks (one tick every ${FARM_CONFIG.breedingTickSeconds}s).`
            : "No empty stall sits between two llamas right now, so nothing can breed."}{" "}
        Click a llama's stall to cycle its lighting (the mood); click an
        empty stall to buy a llama into it.
      </p>

      {/* Barn stalls: a 3x3 grid. Each stall shows its llama (or Empty)
          and its lighting color as a tint. Clicking a llama's stall
          cycles the mood; clicking an empty stall selects it for
          buying. */}
      <div
        className="grid grid-cols-3 gap-2"
        role="group"
        aria-label="Barn stalls"
      >
        {farm.stalls.map((stall, index) => {
          const lighting = FARM_LIGHTING[stall.lighting] ?? FARM_LIGHTING.warm;
          const isEligible = eligible.includes(index);
          const isSelected = selectedStall === index;
          return (
            <button
              key={index}
              type="button"
              onClick={() => handleStallClick(index)}
              className={`panel stall flex flex-col items-center gap-1 p-2 min-h-[84px] cursor-pointer${
                isSelected
                  ? " stall--selected"
                  : isEligible
                    ? " stall--eligible"
                    : ""
              }`}
              style={{ "--stall-light": lighting.color }}
              title={
                stall.llama
                  ? `${lighting.label}: ${lighting.description} Click to change the lighting.`
                  : `${lighting.label}: ${lighting.description} Click to buy a llama into this stall.`
              }
              aria-label={
                stall.llama
                  ? `Stall ${index + 1}: ${LLAMA_TYPE_NAMES[stall.llama]}, ${lighting.label} lighting`
                  : `Stall ${index + 1}: empty, ${lighting.label} lighting${
                      isEligible ? ", can breed" : ""
                    }${isSelected ? ", selected for buying" : ""}`
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
                {isSelected ? " · selected" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* Buy a llama into the selected empty stall. */}
      {selectedStallEmpty && (
        <div className="panel flex flex-col gap-2 p-3">
          <p className="m-0 text-sm">
            Buy a llama for stall {selectedStall + 1}:{" "}
            {formatMoney(FARM_CONFIG.llamaPriceCents)} each. Only the base
            types are for sale; new types come only from breeding.
          </p>
          <div className="flex gap-2">
            {LLAMA_BASE_TYPES.map((type) => (
              <Button
                key={type}
                onClick={() => handleBuyLlama(type)}
                disabled={!canAffordLlama}
              >
                Buy {LLAMA_TYPE_NAMES[type]} ({" "}
                {formatMoney(FARM_CONFIG.llamaPriceCents)})
              </Button>
            ))}
          </div>
          {!canAffordLlama && (
            <p className="m-0 text-sm">
              You need {formatMoney(FARM_CONFIG.llamaPriceCents)}. Ship
              some projects first.
            </p>
          )}
        </div>
      )}

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
        <p className="m-0 text-sm font-semibold">
          Discovered types ({farm.unlockedTypes.length}/{LLAMA_TYPES.length})
        </p>
        {LLAMA_TYPES.map((type) => {
          const discovered = farm.unlockedTypes.includes(type);
          return (
            <p key={type} className="m-0 text-sm">
              {discovered ? "🦙 " : "· "}
              <strong>{LLAMA_TYPE_NAMES[type]}</strong>
              {discovered ? (
                <>: {LLAMA_TYPE_DESCRIPTIONS[type]}</>
              ) : (
                ", undiscovered. Breed for it."
              )}
            </p>
          );
        })}
      </div>
    </SectionLayout>
  );
}
