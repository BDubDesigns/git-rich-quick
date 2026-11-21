import { forwardRef, useImperativeHandle } from "react";
import { useClaimPops } from "../hooks/useClaimPops.js";
import "./ClaimPop.css";

/**
 * The claim pop layer (issue #213): one shockwave ring per live pop, at
 * the claimed star's center, and the To the Moon screen-edge frame
 * while its buff lives. Decoration only: aria-hidden, pointer-events
 * none (ClaimPop.css), and nothing here reads or changes game state.
 *
 * The live pops are this layer's own state, so adding and removing a
 * ring re-renders only the layer, never GoldenStar. GoldenStar holds a
 * ref and calls ref.current.pop(claim, x, y).
 */
export const ClaimPopLayer = forwardRef(function ClaimPopLayer({ moonFrame }, ref) {
  const { claimPops, triggerClaimPop, handleClaimPopEnd } = useClaimPops();
  useImperativeHandle(ref, () => ({ pop: triggerClaimPop }), [triggerClaimPop]);
  return (
    <>
      {moonFrame && <div className="moon-frame" aria-hidden="true" />}
      {claimPops.map((pop) => (
        <div
          key={pop.id}
          aria-hidden="true"
          className={`claim-pop claim-pop--${pop.kind} claim-pop--s${pop.step}`}
          style={{ left: `${pop.x}px`, top: `${pop.y}px` }}
          // The div's own life animation (the pseudo-elements' ring and
          // dashes end at the same time) removes it.
          onAnimationEnd={(event) => {
            if (event.animationName === "claim-pop-life") handleClaimPopEnd(pop.id);
          }}
        />
      ))}
    </>
  );
});
