import { useCallback, useEffect, useState } from "react";
import { FaStar } from "react-icons/fa";
import { useGameContext } from "../context/useGameContext";
import { useFloatingText } from "../hooks/useFloatingText";
import { EMPLOYEE_CONFIGS } from "../context/gameConfig";
import {
  calculateLOCPerSecond,
  flatEmployeeCounts,
  getConstellationLevel,
} from "../context/gameLogic";
import {
  STAR_CONFIG,
  rollStarEffect,
  rollStarGood,
  resolveStarClaim,
  starEffectName,
  starSpawnIntervalSeconds,
} from "../../../shared/game-balance.js";
import { playStarSpawnSound, playStarClickSound } from "../utils/sound.js";
import { FloatingText } from "./FloatingText.jsx";
import "./GoldenStar.css";

/** The star's rendered size in px; spawn positions keep it fully on-screen. */
const STAR_SIZE_PX = 64;

/**
 * A random position fully inside the viewport. The star is fixed-positioned,
 * so it shows regardless of scroll, and its top-left is kept at least a
 * margin from each edge with the star's own size subtracted — it never
 * hangs half off the side, on mobile or desktop.
 */
function randomStarPosition() {
  const margin = 12;
  const maxX = Math.max(margin, window.innerWidth - STAR_SIZE_PX - margin);
  const maxY = Math.max(margin, window.innerHeight - STAR_SIZE_PX - margin);
  return {
    x: margin + Math.random() * (maxX - margin),
    y: margin + Math.random() * (maxY - margin),
  };
}

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The floating label for a resolved claim (effect name + what it did). */
function starRewardLabel(claim) {
  const name = starEffectName(claim.effect, claim.good);
  switch (claim.effect) {
    case "lucky": {
      if (claim.locDelta !== 0) {
        const sign = claim.locDelta > 0 ? "+" : "";
        return `${name}! ${sign}${claim.locDelta} LOC`;
      }
      const sign = claim.moneyDelta > 0 ? "+" : "-";
      return `${name}! ${sign}${formatMoney(Math.abs(claim.moneyDelta))}`;
    }
    case "shootingStars": {
      const parts = [];
      if (claim.locDelta !== 0) parts.push(`+${claim.locDelta} LOC`);
      if (claim.moneyDelta !== 0)
        parts.push(`+${formatMoney(claim.moneyDelta)}`);
      return `${name}! ${parts.join(" ")}`;
    }
    case "frenzy":
      return `${name}! Production x${claim.multiplier}`;
    case "click":
      return `${name}! Clicks x${claim.multiplier}`;
    case "employee": {
      const typeName =
        EMPLOYEE_CONFIGS[claim.employeeType]?.name ?? claim.employeeType;
      return `${name}! ${typeName}s x${claim.multiplier}`;
    }
    default:
      return `${name}!`;
  }
}

export function GoldenStar() {
  const { state, dispatch, recordStarClaim } = useGameContext();
  const { floatingTexts, triggerFloatingText, handleAnimationEnd } =
    useFloatingText();
  const [star, setStar] = useState(null);
  const constellationLevel = getConstellationLevel(state);

  // Spawn / despawn scheduling. One star at a time: when none is
  // showing, schedule the next spawn after a random interval for the
  // level; when one is showing, schedule its despawn. Clearing the
  // star (click or timeout) re-arms the next spawn via this effect.
  useEffect(() => {
    if (constellationLevel < 1) {
      setStar(null);
      return undefined;
    }
    let timer;
    if (star === null) {
      const interval = starSpawnIntervalSeconds(constellationLevel);
      const delayMs =
        (interval.min + Math.random() * (interval.max - interval.min)) * 1000;
      timer = setTimeout(() => {
        setStar(randomStarPosition());
        playStarSpawnSound();
      }, delayMs);
    } else {
      timer = setTimeout(() => {
        setStar(null);
      }, STAR_CONFIG.starLifetimeSeconds * 1000);
    }
    return () => clearTimeout(timer);
  }, [star, constellationLevel]);

  const handleStarClick = useCallback(() => {
    if (!star) return;
    const effect = rollStarEffect(constellationLevel);
    if (!effect) return;
    // Shooting Stars is always a good burst (five good Lucky rolls).
    const good = effect === "shootingStars" ? true : rollStarGood();
    const claim = resolveStarClaim({
      effect,
      good,
      locPerSecond: calculateLOCPerSecond(state),
      money: state.money,
      linesOfCode: state.linesOfCode,
      employeeCounts: flatEmployeeCounts(state),
    });
    // Apply the reward and record the claim in the same handler, with
    // the exact deltas applied, so the claim and the state change can
    // never disagree (the server validates the claim against them).
    dispatch({ type: "APPLY_STAR_REWARD", payload: { claim } });
    recordStarClaim(claim);
    playStarClickSound(good);
    triggerFloatingText(
      star.x + STAR_SIZE_PX / 2,
      star.y,
      starRewardLabel(claim),
      <FaStar size={20} color="#ffd700" />
    );
    setStar(null);
  }, [
    star,
    constellationLevel,
    state,
    dispatch,
    recordStarClaim,
    triggerFloatingText,
  ]);

  return (
    <>
      {star && (
        <button
          type="button"
          aria-label="Golden star — click for a random reward"
          className="golden-star"
          style={{ left: `${star.x}px`, top: `${star.y}px` }}
          onClick={handleStarClick}
        >
          <FaStar size={STAR_SIZE_PX} color="#ffd700" />
        </button>
      )}
      {floatingTexts.map((ft) => (
        <FloatingText
          key={ft.id}
          text={ft.text}
          icon={ft.icon}
          x={ft.x}
          y={ft.y}
          onAnimationEnd={() => handleAnimationEnd(ft.id)}
        />
      ))}
    </>
  );
}
