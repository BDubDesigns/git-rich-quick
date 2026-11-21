import { Fragment, useEffect, useRef, useState } from "react";
import { useGameContext } from "../context/useGameContext.js";
import {
  getBaseLocPerSecond,
  getUnlockProgressForFarm,
  isFarmUnlockMet,
} from "../context/gameLogic.js";
import { formatCondition } from "../utils/formatCondition.js";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";
import { ProgressBar } from "./ProgressBar.jsx";
import { SectionLayout } from "./SectionLayout.jsx";
import { Button } from "./Button.jsx";
import { useBirthPops } from "../hooks/useLlamaBirths.js";
import { stallBirth } from "../utils/llamaBirths.js";
import {
  stallChipAfterIndex,
  stallFocusScrollDelta,
} from "../utils/stallFocus.js";
import "./LlamaBirth.css";
import { Panel } from "./Panel.jsx";
import { HighlightAnchor } from "./HighlightAnchor.jsx";
import {
  FARM_CONFIG,
  FARM_LIGHTING,
  FARM_LIGHTING_COLORS,
  llamaShopTypes,
  LLAMA_ECONOMY,
  LLAMA_TYPES,
  LLAMA_TYPE_DESCRIPTIONS,
  LLAMA_TYPE_NAMES,
  farmEligibleBreedingStalls,
  farmLlamaCount,
  farmPurchaseCostCents,
  formatEstimateDuration,
  llamaBuyPriceCents,
  llamaSellPriceCents,
} from "../../../shared/game-balance.js";
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";

/**
 * Llama Farm tab (issue #79, economy v2 in issue #129). A business you
 * buy with money, and a breeding mini-game. No soil: the farm uses
 * MOOD and STALLS.
 *
 * Click a stall to select it. Its controls open at the stall (issue
 * #230): a chip right under the stall's row, and the section scrolls
 * so the stall and the chip are in view together. A selected llama can
 * be sold (for its type's current sell price), moved to an empty
 * stall, or have its stall's lighting changed. A selected empty stall can have a llama bought
 * into it, or its lighting changed. The empty stall's own lighting
 * sets the breeding odds for a kid appearing there, and a Mama Llama
 * next door makes kids far more often. Breeding is rolled on the
 * client (shared.rollFarmBreeding) every breedingTickSeconds.
 *
 * Every buy price is time at the player's BUFFED LOC/s
 * (getBaseLocPerSecond, the same rate the reducer charges from), so
 * the price on the button and the price the reducer charges can never
 * disagree, and both rise as the player grows. Sell prices float the
 * same way: one price per type (llamaSellPriceCents, sellSeconds x S
 * at the same buffed LOC/s), the same for a bought llama and a born
 * one, so the number on a stall rises with production.
 *
 * There is no llama icon in react-icons, so the stalls render the
 * llama emoji. It is a game about llamas; the emoji is the point.
 */
export function Farm() {
  const { state, dispatch } = useGameContext();
  const farm = state.farm ?? { owned: false, stalls: [], unlockedTypes: [] };
  // Issue #218: the last breed result's pops (null when none is live).
  const births = useBirthPops(state.lastBirths);
  // The selected stall (null when none), and whether the selected
  // llama is being moved (the next empty stall clicked receives it).
  const [selectedStall, setSelectedStall] = useState(null);
  const [moving, setMoving] = useState(false);
  const pricingRate = getBaseLocPerSecond(state);
  // Progress bar toggles (issue #128): the farm's unlock bar follows
  // the "unlock" toggle, like every other unlock bar.
  const showUnlockBar = useProgressBarEnabled("unlock");
  // Issue #230: the stall grid and the focus chip, for scrolling the
  // tapped stall and its controls into view together.
  const gridRef = useRef(null);
  const chipRef = useRef(null);

  useEffect(() => {
    if (selectedStall === null) return;
    const chip = chipRef.current;
    const stallEl = gridRef.current?.querySelector(
      `[data-stall-index="${selectedStall}"]`
    );
    if (!chip || !stallEl) return;
    // The nearest scrolling ancestor: the section's own scroller.
    let scroller = chip.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const view = scroller.getBoundingClientRect();
    const delta = stallFocusScrollDelta(
      stallEl.getBoundingClientRect().top,
      chip.getBoundingClientRect().bottom,
      view.top,
      view.bottom
    );
    if (delta === 0) return;
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    scroller.scrollBy({ top: delta, behavior: reduceMotion ? "auto" : "smooth" });
  }, [selectedStall]);

  const clearSelection = () => {
    setSelectedStall(null);
    setMoving(false);
  };

  const handleBuyFarm = () => {
    dispatch({ type: "BUY_FARM" });
  };

  const handleCycleLighting = (stallIndex) => {
    const stall = farm.stalls[stallIndex];
    if (!stall) return;
    const current = FARM_LIGHTING_COLORS.indexOf(stall.lighting);
    const next =
      FARM_LIGHTING_COLORS[(current + 1) % FARM_LIGHTING_COLORS.length];
    dispatch({
      type: "SET_STALL_LIGHTING",
      payload: { stallIndex, lighting: next },
    });
  };

  const handleStallClick = (stallIndex) => {
    const stall = farm.stalls[stallIndex];
    if (!stall) return;
    if (moving && selectedStall !== null) {
      if (stallIndex === selectedStall) {
        // Clicking the moving llama again cancels the move.
        setMoving(false);
        return;
      }
      if (!stall.llama) {
        dispatch({
          type: "MOVE_LLAMA",
          payload: { fromIndex: selectedStall, toIndex: stallIndex },
        });
        clearSelection();
        return;
      }
      // An occupied stall: select that llama instead.
      setMoving(false);
      setSelectedStall(stallIndex);
      return;
    }
    setMoving(false);
    setSelectedStall((current) => (current === stallIndex ? null : stallIndex));
  };

  const handleBuyLlama = (type) => {
    if (selectedStall === null) return;
    dispatch({
      type: "BUY_LLAMA",
      payload: { stallIndex: selectedStall, type },
    });
    clearSelection();
  };

  const handleSellLlama = () => {
    if (selectedStall === null) return;
    dispatch({ type: "SELL_LLAMA", payload: { stallIndex: selectedStall } });
    clearSelection();
  };

  if (!farm.owned && !isFarmUnlockMet(state)) {
    return (
      <SectionLayout sectionId="farm">
        {/* Email links (issue #173): farm mail lands on this panel. */}
        <HighlightAnchor tab="farm">
          <Panel className="flex flex-col gap-2 p-3">
            <p className="m-0 text-sm">
              Every Senior Developer has the same exit plan: quit and
              raise alpacas. Get enough of them on payroll and they stop
              talking about it and start building. You still pay for the
              barn.
            </p>
            <p className="m-0 text-xs font-semibold">Unlock requirement:</p>
            {getUnlockProgressForFarm(state).map((entry, index) => (
              <ProgressBar
                key={index}
                current={entry.current}
                target={entry.target}
                label={formatCondition(entry)}
                showBar={showUnlockBar}
              />
            ))}
            <Button onClick={handleBuyFarm} disabled>
              Llama Farm (locked)
            </Button>
          </Panel>
        </HighlightAnchor>
      </SectionLayout>
    );
  }

  if (!farm.owned) {
    const barnCost = farmPurchaseCostCents(pricingRate);
    const canAfford = state.money >= barnCost;
    return (
      <SectionLayout sectionId="farm">
        <HighlightAnchor tab="farm">
          <Panel className="flex flex-col gap-2 p-3">
            {/* The farm intro lives in the section description (green code
                comment above this panel), so it is not repeated here. */}
            <p className="m-0 text-sm">
              Buy the barn and it arrives empty. No llamas come with it.
              Buy llamas, move them into nests, set the lights, breed
              them, and sell the kids. Barn prices track your production:
              it costs {formatEstimateDuration(LLAMA_ECONOMY.barnSeconds)} of
              what your team earns shipping everything, so it is never a
              rounding error and never a mortgage.
            </p>
            <Button onClick={handleBuyFarm} disabled={!canAfford}>
              Buy the Llama Farm ({formatMoney(barnCost)})
            </Button>
            {!canAfford && (
              <p className="m-0 text-sm">
                You need {formatMoney(barnCost)}. Ship some projects first.
              </p>
            )}
            <PricingNote rate={pricingRate} />
          </Panel>
        </HighlightAnchor>
      </SectionLayout>
    );
  }

  const eligible = farmEligibleBreedingStalls(farm.stalls);
  const llamaCount = farmLlamaCount(farm.stalls);
  const selected = selectedStall !== null ? farm.stalls[selectedStall] : null;
  const selectedLlama = selected?.llama ?? null;
  const selectedSellCents = selectedLlama
    ? llamaSellPriceCents(selectedLlama, pricingRate)
    : null;
  const selectedLighting = selected
    ? (FARM_LIGHTING[selected.lighting] ?? FARM_LIGHTING.warm)
    : null;
  const chipAfterIndex = stallChipAfterIndex(
    selected ? selectedStall : null,
    farm.stalls.length,
    FARM_CONFIG.gridCols
  );

  return (
    <SectionLayout sectionId="farm">
      <HighlightAnchor tab="farm">
        <Panel className="flex flex-col gap-2 p-3">
          <p className="m-0 text-sm">
            {llamaCount} {llamaCount === 1 ? "llama" : "llamas"} in the barn.{" "}
            {llamaCount === 0
              ? "The barn is empty. Pick an empty stall and buy your first llamas."
              : eligible.length > 0
                ? `${eligible.length} empty ${eligible.length === 1 ? "stall" : "stalls"} can breed right now (one breeding tick every ${FARM_CONFIG.breedingTickSeconds}s).`
                : "No empty stall sits between two llamas right now, so nothing can breed. Move some llamas into a nest."}{" "}
            Click a stall to select it.
          </p>
          <PricingNote rate={pricingRate} />
        </Panel>
      </HighlightAnchor>

      {/* Barn stalls: a 3x3 grid. Each stall shows its llama (or Empty)
          and its lighting color as a tint. Clicking selects a stall;
          while moving, clicking an empty stall drops the llama there.
          The selected stall's controls (issue #230) open in a chip
          spanning the grid, right under that stall's row. */}
      <div
        ref={gridRef}
        className="grid grid-cols-3 gap-2"
        role="group"
        aria-label="Barn stalls"
      >
        {farm.stalls.map((stall, index) => {
          const lighting = FARM_LIGHTING[stall.lighting] ?? FARM_LIGHTING.warm;
          const isEligible = eligible.includes(index);
          const isSelected = selectedStall === index;
          const isMoveTarget = moving && !stall.llama;
          // Issue #218: a kid just born here pops in (and a new type
          // gets the one-time gold outline).
          const birth = stallBirth(births, index);
          return (
            <Fragment key={index}>
            <Panel
              as="button"
              type="button"
              data-stall-index={index}
              aria-expanded={isSelected}
              aria-controls={isSelected ? "farm-stall-chip" : undefined}
              onClick={() => handleStallClick(index)}
              className={`stall relative flex flex-col items-center gap-1 p-2 min-h-[84px] cursor-pointer${
                isSelected || isMoveTarget
                  ? " stall--selected"
                  : isEligible
                    ? " stall--eligible"
                    : ""
              }`}
              style={{ "--stall-light": lighting.color }}
              title={
                isMoveTarget
                  ? "Move the llama here."
                  : `${lighting.label}: ${lighting.description} Click to select this stall.`
              }
              aria-label={
                stall.llama
                  ? `Stall ${index + 1}: ${LLAMA_TYPE_NAMES[stall.llama]}, sells for ${formatMoney(
                      llamaSellPriceCents(stall.llama, pricingRate)
                    )}, ${lighting.label} lighting${isSelected ? ", selected" : ""}`
                  : `Stall ${index + 1}: empty, ${lighting.label} lighting${
                      isEligible ? ", can breed" : ""
                    }${isSelected ? ", selected" : ""}${
                      isMoveTarget ? ", move here" : ""
                    }`
              }
            >
              {birth?.newType && (
                <span key={`new-${births.seq}`} className="birth-new-type" aria-hidden="true" />
              )}
              <span
                key={birth ? `pop-${births.seq}` : "llama"}
                className={`text-2xl${birth ? " llama-pop" : ""}`}
                aria-hidden="true"
              >
                {stall.llama ? "🦙" : "·"}
              </span>
              {birth && (
                <span key={`chip-${births.seq}`} className="birth-chip" aria-hidden="true">
                  +1
                </span>
              )}
              <span className="text-sm text-center">
                {stall.llama ? LLAMA_TYPE_NAMES[stall.llama] : "Empty stall"}
              </span>
              {stall.llama && (
                <span className="text-xs text-gray-400">
                  Sells for {formatMoney(llamaSellPriceCents(stall.llama, pricingRate))}
                </span>
              )}
              <span className="text-xs" style={{ color: lighting.color }}>
                {lighting.label}
                {isEligible ? " · can breed" : ""}
                {isMoveTarget ? " · move here" : ""}
              </span>
            </Panel>
            {index === chipAfterIndex && (
              <Panel
                ref={chipRef}
                id="farm-stall-chip"
                role="region"
                aria-label={`Stall ${selectedStall + 1} controls`}
                className="col-span-full flex flex-col gap-2 p-3"
              >
                {selectedLlama ? (
                  <>
                    <p className="m-0 text-sm">
                      <strong>{LLAMA_TYPE_NAMES[selectedLlama]}</strong> in stall{" "}
                      {selectedStall + 1}. Sells for{" "}
                      {formatMoney(selectedSellCents ?? 0)}. The price follows
                      your shipping income, so it rises as your team grows.
                    </p>
                    {moving ? (
                      <p className="m-0 text-sm text-yellow-300">
                        Pick an empty stall to move this llama into. Click it
                        again to cancel.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={handleSellLlama}>
                          Sell ({formatMoney(selectedSellCents ?? 0)})
                        </Button>
                        <Button
                          onClick={() => setMoving(true)}
                          disabled={llamaCount >= FARM_CONFIG.stallCount}
                        >
                          Move
                        </Button>
                        <Button onClick={() => handleCycleLighting(selectedStall)}>
                          Lighting: {selectedLighting.label}
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="m-0 text-sm">
                      Buy a llama for stall {selectedStall + 1}. The base types
                      are always for sale; a fancy type joins the shop once you
                      have bred one.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {llamaShopTypes(farm.unlockedTypes).map((type) => {
                        const price = llamaBuyPriceCents(type, pricingRate);
                        return (
                          <Button
                            key={type}
                            onClick={() => handleBuyLlama(type)}
                            disabled={state.money < price}
                          >
                            Buy {LLAMA_TYPE_NAMES[type]} ({formatMoney(price)})
                          </Button>
                        );
                      })}
                      <Button onClick={() => handleCycleLighting(selectedStall)}>
                        Lighting: {selectedLighting.label}
                      </Button>
                    </div>
                  </>
                )}
              </Panel>
                  )}
            </Fragment>
          );
        })}
      </div>

      {/* Lighting legend: what each mood does, and the Mama boost. */}
      <Panel className="flex flex-col gap-1 p-3 text-sm">
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
        <p className="m-0">
          <strong>Mama Llama:</strong> an empty stall beside a Mama rolls
          kids {LLAMA_ECONOMY.mamaKidChanceMultiplier}x as often (up to{" "}
          {Math.round(LLAMA_ECONOMY.maxKidChance * 100)}% per tick). Her
          kids take the other parent's type. Breed fast, sell the kids.
        </p>
      </Panel>

      {/* The herd book: every type, its price as time, and its value. */}
      <Panel className="flex flex-col gap-1 p-3">
        <p className="m-0 text-sm font-semibold">
          Herd book ({farm.unlockedTypes.length}/{LLAMA_TYPES.length} discovered)
        </p>
        {LLAMA_TYPES.map((type) => {
          const discovered = farm.unlockedTypes.includes(type);
          const forSale = llamaShopTypes(farm.unlockedTypes).includes(type);
          return (
            <p key={type} className="m-0 text-sm">
              {discovered ? "🦙 " : "· "}
              <strong>{LLAMA_TYPE_NAMES[type]}</strong>{" "}
              <span className="text-xs text-gray-400">
                ({forSale ? "buy" : "worth"}{" "}
                {formatMoney(llamaBuyPriceCents(type, pricingRate))},{" "}
                {formatEstimateDuration(LLAMA_ECONOMY.typeSeconds[type])} of
                shipping; sells for{" "}
                {formatMoney(llamaSellPriceCents(type, pricingRate))})
              </span>
              {discovered ? (
                <>: {LLAMA_TYPE_DESCRIPTIONS[type]}</>
              ) : forSale ? (
                ", in the shop. Buy one to meet it."
              ) : (
                ", undiscovered. Breed one and it joins the shop."
              )}
            </p>
          );
        })}
      </Panel>
    </SectionLayout>
  );
}

/** How the farm prices: buys and sells are time at the player's buffed LOC/s, right now. */
function PricingNote({ rate }) {
  const floored = rate < LLAMA_ECONOMY.minPricingLocPerSecond;
  return (
    <p className="m-0 text-xs text-gray-400">
      Llama market: prices are time at your current {formatNumber(rate)}{" "}
      LOC/s (achievement and Founder buffs included), so they rise as you
      grow. A llama's sell price follows your shipping income too, the
      same for one you bought and one born here.
      {floored
        ? ` Priced as if you made ${LLAMA_ECONOMY.minPricingLocPerSecond} LOC/s until you do; nothing here is free.`
        : ""}
    </p>
  );
}
