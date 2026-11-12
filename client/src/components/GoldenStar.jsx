import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FaStar } from "react-icons/fa";
import { useGameContext } from "../context/useGameContext";
import { useFloatingText } from "../hooks/useFloatingText";
import { EMPLOYEE_CONFIGS } from "../context/gameConfig";
import {
  flatEmployeeCounts,
  getBaseLocPerSecond,
  getConstellationLevel,
  getStarBrokerLevel,
} from "../context/gameLogic";
import {
  STAR_CONFIG,
  rollNextStarAtMs,
  rollStarEffect,
  rollStarGood,
  resolveStarClaim,
  starBrokerBuyCost,
  starBrokerCooldownSeconds,
  starBuffDurationSeconds,
  starEffectName,
  starRewardDetail,
} from "../../../shared/game-balance.js";
import { formatNumber } from "../../../shared/formatNumber.js";
import { playStarSpawnSound, playStarClickSound } from "../utils/sound.js";
import { FloatingText } from "./FloatingText.jsx";
import "./GoldenStar.css";

/** The star's rendered size in px; spawn positions keep it fully on-screen. */
const STAR_SIZE_PX = 64;
/** localStorage key for the collapsed star bar area (same `grq:` prefix as the player id). */
const STAR_BARS_COLLAPSED_KEY = "grq:starBarsCollapsed";

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

/** The floating label for a resolved claim (effect name + what it did). */
function starRewardLabel(claim) {
  const name = starEffectName(claim.effect, claim.good);
  const employeeTypeName =
    EMPLOYEE_CONFIGS[claim.employeeType]?.name ?? claim.employeeType;
  const detail = starRewardDetail(claim, employeeTypeName);
  return detail ? `${name}! ${detail}` : `${name}!`;
}

/** "90s" or "1m 30s" for the next-star countdown. */
function formatCountdown(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/**
 * One active star-effect duration bar: the effect name (plus the
 * employee type for Sprint/Meeting), its production multiplier, and
 * the seconds left, over a fill that depletes as the effect runs out
 * (remaining / total duration). The total is derived from the config
 * — the stored buff only carries expiresAtMs, not its duration — and
 * good is a multiplier above 1x (the config only ever issues good
 * 2-15x — Frenzy 2-5x, Click 2-5x, Employee 3-15x — bad 0.5x). The
 * multiplier comes from the live buff data (the same value the email
 * reports), never hardcoded per effect. Green fill for a buff, red
 * for a debuff.
 */
function StarEffectBar({ buff, nowMs }) {
  const good = buff.multiplier > 1;
  const totalSeconds = starBuffDurationSeconds(buff.effect, good) ?? 0;
  const remainingSeconds = Math.max(
    0,
    Math.ceil((buff.expiresAtMs - nowMs) / 1000)
  );
  const fillPct =
    totalSeconds > 0
      ? Math.min(100, Math.max(0, (remainingSeconds / totalSeconds) * 100))
      : 0;
  const name = starEffectName(buff.effect, good);
  const employeeTypeName =
    buff.effect === "employee"
      ? EMPLOYEE_CONFIGS[buff.employeeType]?.name
      : null;
  const label = employeeTypeName ? `${name} (${employeeTypeName})` : name;
  const text = `${label} · ${buff.multiplier}x · ${formatCountdown(remainingSeconds)}`;
  return (
    <div
      className="star-effect-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fillPct)}
      aria-label={`${label} ${buff.multiplier}x, ${formatCountdown(remainingSeconds)} left`}
    >
      <div
        className={`star-effect-bar-fill ${
          good ? "star-effect-bar-fill--good" : "star-effect-bar-fill--bad"
        }`}
        style={{ width: `${fillPct}%` }}
      />
      <span className="star-effect-bar-text">{text}</span>
    </div>
  );
}

/**
 * Golden star (GitNub Constellation, issue #29): fully client-driven.
 *
 * The CLIENT owns the schedule and the outcome now (the star
 * resolution moved local when the leaderboard was killed). The next
 * star time is persisted in the save state (`state.nextStarAtMs`), so
 * the countdown survives a reload — the client rolls a fresh time
 * (shared.rollNextStarAtMs) whenever the schedule needs one: on load
 * with no schedule, after a claim, and after a despawn. When the
 * countdown hits zero the star appears; clicking it rolls the outcome
 * locally (shared.rollStarEffect + rollStarGood + resolveStarClaim,
 * the same config and odds the server used) and applies it. An
 * unclicked star despawns after its lifetime and the client rolls a
 * fresh schedule (the missed window has passed).
 *
 * The countdown display is an unlockable: the client only shows the
 * timer once the player reaches Constellation level
 * STAR_CONFIG.countdownUnlockLevel. The star itself still spawns on
 * schedule before then; only the timer is gated. The timer is a thin
 * progress bar under the stats bar that fills left to right as the
 * star approaches, with the small seconds-remaining text inside it.
 */
export function GoldenStar() {
  const { state, dispatch, requestClaimSave, saveNow } = useGameContext();
  const { floatingTexts, triggerFloatingText, handleAnimationEnd } =
    useFloatingText();
  const [star, setStar] = useState(null);
  // Whether the star is in its fade-out window (issue #49): it starts
  // fading starFadeSeconds before it despawns, so the player gets a
  // "click me now or lose me" signal instead of it just vanishing.
  const [fading, setFading] = useState(false);
  // A BOUGHT star (StarBroker), shown alongside a natural star — the
  // whole point is stacking. Same 30s lifetime, same presentation,
  // independent click path (the outcome is rolled locally at click
  // time, like the natural star). Null when none is pending.
  // boughtStarAtMs is the wall-clock time it appeared, for the
  // lifetime backstop (the despawn timer freezes in the background).
  const [boughtStar, setBoughtStar] = useState(null);
  const [boughtFading, setBoughtFading] = useState(false);
  const [boughtStarAtMs, setBoughtStarAtMs] = useState(null);
  // Whether the star bar area (countdown, effect bars, buy) is
  // collapsed to a thin strip. A device preference (localStorage, like
  // the sound settings) — never in the server save. Tap the countdown
  // bar (or the collapsed strip) to toggle.
  const [starBarsCollapsed, setStarBarsCollapsed] = useState(() => {
    try {
      if (typeof localStorage === "undefined") return false;
      return localStorage.getItem(STAR_BARS_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  // Seconds until the next star appears (null = no star scheduled).
  const [secondsLeft, setSecondsLeft] = useState(null);
  // The total interval the current countdown started from (the
  // remaining time when it was armed). The progress bar fills from
  // 0% (just armed) to 100% (due) as secondsLeft counts down from
  // this total — it is set from the same remaining value as
  // secondsLeft, so the fill and the text can never disagree.
  const [countdownTotalSeconds, setCountdownTotalSeconds] = useState(null);
  // Client wall-clock time (Date.now()) when the current countdown was
  // armed. The countdown is derived from this + the total (see the tick
  // effect), NOT from counting setInterval ticks — counting ticks drifts
  // behind real time (render time per tick, and background throttling
  // on mobile freezes timers), so a star shown from a drifted countdown
  // can already be past its 30s claim window (the PR #64 regression).
  // The wall clock is the authority; the interval only triggers
  // re-renders. Elapsed time is a difference of two client readings.
  const [countdownStartedAtMs, setCountdownStartedAtMs] = useState(null);
  // The header slot the countdown bar portals into (see Header.jsx):
  // the bar sits directly beneath the stats bar instead of floating
  // above the Commit button. Grabbed after mount — the header is in
  // the same commit, so it always exists by then.
  const [countdownSlot, setCountdownSlot] = useState(null);
  // The header slot the active-effect bars portal into (below the
  // countdown slot). Same grab-after-mount pattern.
  const [effectSlot, setEffectSlot] = useState(null);
  // The header slot the Buy Star button + cooldown timer portal into
  // (below the effect slot). Same grab-after-mount pattern.
  const [buySlot, setBuySlot] = useState(null);
  useEffect(() => {
    setCountdownSlot(document.getElementById("star-countdown-slot"));
    setEffectSlot(document.getElementById("star-effect-slot"));
    setBuySlot(document.getElementById("star-buy-slot"));
  }, []);
  const constellationLevel = getConstellationLevel(state);
  const starBrokerLevel = getStarBrokerLevel(state);

  // Roll a fresh next-star time and persist it (SET_NEXT_STAR_AT).
  // The arm effect (below) picks up the new state.nextStarAtMs and
  // arms the countdown from it. Returns the new time (null at level 0).
  const rollNextStar = useCallback(() => {
    const nextAt = rollNextStarAtMs(constellationLevel, Date.now());
    dispatch({ type: "SET_NEXT_STAR_AT", payload: { nextStarAtMs: nextAt } });
    return nextAt;
  }, [constellationLevel, dispatch]);

  // Arm the countdown from the persisted schedule
  // (state.nextStarAtMs). If there is no schedule (null) and
  // Constellation is unlocked, roll a fresh one; the effect re-runs
  // when the persisted value lands and arms from it. The countdown is
  // derived from the wall clock (the absolute nextStarAtMs minus now),
  // so it survives a reload. If the scheduled time is more than a star
  // lifetime in the past, the star's 30s claim window has fully passed
  // (the tab was closed or backgrounded past it) — roll a fresh
  // schedule instead of showing a stale star. This matches the old
  // server behavior (a due star whose window passed was re-rolled).
  useEffect(() => {
    if (constellationLevel < 1) {
      setStar(null);
      setSecondsLeft(null);
      setCountdownTotalSeconds(null);
      setCountdownStartedAtMs(null);
      return;
    }
    if (state.nextStarAtMs === null) {
      rollNextStar();
      return;
    }
    if (
      Date.now() - state.nextStarAtMs >
      STAR_CONFIG.starLifetimeSeconds * 1000
    ) {
      rollNextStar();
      return;
    }
    const remaining = Math.max(
      0,
      Math.ceil((state.nextStarAtMs - Date.now()) / 1000)
    );
    setSecondsLeft(remaining);
    setCountdownTotalSeconds(remaining);
    setCountdownStartedAtMs(Date.now());
  }, [constellationLevel, state.nextStarAtMs, rollNextStar]);

  // Toggle the star bar area collapsed/expanded, persisting the
  // preference (a device preference, like the sound settings).
  const toggleStarBarsCollapsed = useCallback(() => {
    setStarBarsCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STAR_BARS_COLLAPSED_KEY, next ? "1" : "0");
        }
      } catch {
        // Storage unavailable (private mode) — the toggle still works
        // for this session, it just does not persist.
      }
      return next;
    });
  }, []);

  // Tick once a second while a countdown is armed (a star awaited or
  // shown). The countdown is derived from the wall clock — elapsed time
  // since the countdown was armed — NOT from counting setInterval
  // ticks. Counting ticks drifts behind real time (render time per
  // tick, and background throttling on mobile freezes timers), so a
  // star shown from a drifted countdown can already be past its 30s
  // claim window (the PR #64 regression: the star just disappears).
  // The wall clock is the authority; the interval only triggers
  // re-renders. While a star is shown, the same tick hides it once its
  // window passes (the despawn timer freezes in the background, so a
  // stale star would otherwise stay up and eat the click). The
  // countdown is cleared before rolling the fresh schedule, so the
  // show-star effect cannot re-spawn it from a stale secondsLeft of 0
  // (the double-star bug).
  useEffect(() => {
    if (countdownStartedAtMs === null || countdownTotalSeconds === null) {
      return undefined;
    }
    const id = setInterval(() => {
      const now = Date.now();
      const windowEndMs =
        countdownStartedAtMs +
        (countdownTotalSeconds + STAR_CONFIG.starLifetimeSeconds) * 1000;
      if (star !== null) {
        // A shown star whose window passed: hide it and roll a fresh
        // schedule.
        if (now > windowEndMs) {
          setStar(null);
          setSecondsLeft(null);
          setCountdownTotalSeconds(null);
          setCountdownStartedAtMs(null);
          rollNextStar();
        }
        return;
      }
      const elapsedSeconds = (now - countdownStartedAtMs) / 1000;
      setSecondsLeft(
        Math.max(0, Math.ceil(countdownTotalSeconds - elapsedSeconds))
      );
    }, 1000);
    return () => clearInterval(id);
  }, [countdownStartedAtMs, countdownTotalSeconds, star, rollNextStar]);

  // Live timed buffs (frenzy / click / employee) with their expiry
  // still ahead. GAME_TICK drops expired entries from state, but the
  // expiry check here keeps a buff from showing in the gap between
  // its expiry and the next tick.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const liveEffects = (state.activeStarEffects ?? []).filter(
    (buff) => buff.expiresAtMs > nowMs
  );

  // Buy-star cooldown (StarBroker): the total for this level and the
  // wall-clock time the last star was bought (state.lastStarBuyAtMs,
  // null = never bought). The remaining is derived from the wall
  // clock — the total minus the elapsed time since the buy — never
  // from counting ticks. Null when no cooldown is armed: the player
  // never bought (ready), or owns no StarBroker.
  const buyCooldownTotalSeconds =
    starBrokerLevel >= 1 ? starBrokerCooldownSeconds(starBrokerLevel) : null;
  const buyCooldownRemainingSeconds =
    buyCooldownTotalSeconds === null || state.lastStarBuyAtMs === null
      ? null
      : Math.max(
          0,
          Math.ceil(
            buyCooldownTotalSeconds - (nowMs - state.lastStarBuyAtMs) / 1000
          )
        );
  const buyCooldownActive =
    buyCooldownRemainingSeconds !== null && buyCooldownRemainingSeconds > 0;

  // Tick the clock once a second while any effect is live, so the
  // duration bars deplete, while the buy cooldown is active (so its
  // timer counts down), or while a bought star is shown (so its
  // lifetime backstop can hide it once its window passes). The
  // interval only runs while there is something to deplete.
  useEffect(() => {
    if (
      liveEffects.length === 0 &&
      !buyCooldownActive &&
      boughtStar === null
    )
      return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveEffects.length, buyCooldownActive, boughtStar]);

  // Show the star the moment the countdown hits zero. secondsLeft is
  // null while no star is due (awaiting the next roll), so the guard
  // below only fires on the countdown actually reaching 0 — never on
  // a star that was just dismissed (click / despawn / re-roll), which
  // clears the countdown to null first. That clearing is what stops
  // the double-star bug: without it, the effect re-fires while the
  // claim is still being applied (secondsLeft still 0) and spawns a
  // second star. Wall-clock backstop: if the star's 30s window already
  // passed (the tab was backgrounded so long the countdown only just
  // caught up), do NOT show a star whose window is gone — roll a fresh
  // schedule instead.
  useEffect(() => {
    if (
      star !== null ||
      secondsLeft !== 0 ||
      countdownStartedAtMs === null ||
      countdownTotalSeconds === null
    )
      return undefined;
    const windowEndMs =
      countdownStartedAtMs +
      (countdownTotalSeconds + STAR_CONFIG.starLifetimeSeconds) * 1000;
    if (Date.now() > windowEndMs) {
      setSecondsLeft(null);
      setCountdownTotalSeconds(null);
      setCountdownStartedAtMs(null);
      rollNextStar();
      return undefined;
    }
    setStar(randomStarPosition());
    playStarSpawnSound();
  }, [
    star,
    secondsLeft,
    countdownStartedAtMs,
    countdownTotalSeconds,
    rollNextStar,
  ]);

  // Despawn an unclicked star after its lifetime, then roll a fresh
  // schedule (the missed window has passed). The star starts fading
  // starFadeSeconds before it despawns (issue #49). The countdown is
  // cleared alongside the star, so the show-star effect does not
  // re-spawn it — without the clearing the star stayed up ~60s (two
  // 30s windows) instead of its 30s lifetime.
  useEffect(() => {
    if (star === null) return undefined;
    setFading(false);
    const fadeId = setTimeout(
      () => {
        setFading(true);
      },
      Math.max(
        0,
        (STAR_CONFIG.starLifetimeSeconds - STAR_CONFIG.starFadeSeconds) *
          1000
      )
    );
    const despawnId = setTimeout(() => {
      setStar(null);
      setSecondsLeft(null);
      setCountdownTotalSeconds(null);
      setCountdownStartedAtMs(null);
      rollNextStar();
    }, STAR_CONFIG.starLifetimeSeconds * 1000);
    return () => {
      clearTimeout(fadeId);
      clearTimeout(despawnId);
    };
  }, [star, rollNextStar]);

  // Despawn an unclicked BOUGHT star after its lifetime (same 30s,
  // same fade in the last 5s). Unlike the natural star, there is no
  // next star to roll — the natural schedule was never touched by the
  // buy, so it continues on its own. The pending bought star simply
  // expires.
  useEffect(() => {
    if (boughtStar === null) return undefined;
    setBoughtFading(false);
    const fadeId = setTimeout(
      () => {
        setBoughtFading(true);
      },
      Math.max(
        0,
        (STAR_CONFIG.starLifetimeSeconds - STAR_CONFIG.starFadeSeconds) *
          1000
      )
    );
    const despawnId = setTimeout(() => {
      setBoughtStar(null);
      setBoughtFading(false);
      setBoughtStarAtMs(null);
    }, STAR_CONFIG.starLifetimeSeconds * 1000);
    return () => {
      clearTimeout(fadeId);
      clearTimeout(despawnId);
    };
  }, [boughtStar]);

  // Hide a bought star once its 30s window passes (the despawn timer
  // freezes in the background, so a stale bought star would otherwise
  // stay up and eat the click — same backstop as the natural star's
  // tick effect). Runs off the once-a-second clock tick, which is
  // alive while a bought star is shown.
  useEffect(() => {
    if (boughtStar === null || boughtStarAtMs === null) return undefined;
    const windowEndMs =
      boughtStarAtMs + STAR_CONFIG.starLifetimeSeconds * 1000;
    if (nowMs > windowEndMs) {
      setBoughtStar(null);
      setBoughtFading(false);
      setBoughtStarAtMs(null);
    }
    return undefined;
  }, [boughtStar, boughtStarAtMs, nowMs]);

  // Buy Star button state (StarBroker). The cost is 30x the player's
  // base passive LOC/s (the same shared formula), recomputed from the
  // live state so it is never stale as the player hires. The button is
  // enabled when the player owns StarBroker, the cooldown is ready,
  // and the player can afford it. The buy is synchronous now (no
  // server round-trip): the cooldown arms from lastStarBuyAtMs the
  // moment the buy dispatches, so a double-tap cannot buy twice — the
  // button disables as soon as the state updates, and the handler
  // re-checks the cooldown from the live state.
  const buyCost =
    starBrokerLevel < 1
      ? null
      : starBrokerBuyCost(getBaseLocPerSecond(state));
  const buyReady =
    starBrokerLevel >= 1 &&
    !buyCooldownActive &&
    buyCost !== null &&
    state.linesOfCode >= buyCost;
  const buyText =
    starBrokerLevel < 1
      ? ""
      : buyCooldownActive
        ? `Buy in ${formatCountdown(buyCooldownRemainingSeconds)}`
        : buyCost !== null
          ? `${formatNumber(buyCost)} LOC`
          : "";

  // Apply a locally-rolled star claim (natural or bought — the two
  // claims are the same shape). The claim and the state change are
  // applied in the same handler, with the exact deltas rolled, so the
  // claim and the state change can never disagree. A prompt save is
  // requested so the reward persists (a bought-star claim changes no
  // big-action field, so without it the reward would wait for the 60s
  // heartbeat). The floating text appears at the clicked star's
  // position.
  const applyClaim = useCallback(
    (claim, position) => {
      dispatch({ type: "APPLY_STAR_REWARD", payload: { claim } });
      requestClaimSave();
      playStarClickSound(claim.good);
      triggerFloatingText(
        position.x + STAR_SIZE_PX / 2,
        position.y,
        starRewardLabel(claim),
        <FaStar size={20} color="#ffd700" />
      );
    },
    [dispatch, requestClaimSave, triggerFloatingText]
  );

  // Roll one star outcome locally, from the shared config and odds
  // (the same helpers the server used). `locPerSecond` is the base
  // passive LOC/s — employees + Blocker bonus, no star buffs — the
  // same value the server priced Lucky rewards from, so a Lucky LOC
  // reward is identical. `employeeCounts` is the flat employee map
  // (the claim's Employee effect only boosts a type the player owns).
  const rollClaim = useCallback(() => {
    const effect = rollStarEffect(constellationLevel);
    if (effect === null) return null;
    const good = rollStarGood();
    return resolveStarClaim({
      effect,
      good,
      locPerSecond: getBaseLocPerSecond(state),
      money: state.money,
      linesOfCode: state.linesOfCode,
      employeeCounts: flatEmployeeCounts(state),
    });
  }, [constellationLevel, state]);

  const handleStarClick = useCallback(() => {
    if (!star) return;
    // Hide the star immediately so a double-click cannot claim twice,
    // and clear the countdown so the show-star effect cannot re-spawn
    // a second star from the stale secondsLeft of 0 (the double-star
    // bug). The claim is rolled locally now (no server round-trip), so
    // it completes synchronously: the outcome is applied and a fresh
    // schedule is rolled before the handler returns, and the arm effect
    // re-arms the countdown from the new schedule.
    const position = star;
    setStar(null);
    setSecondsLeft(null);
    setCountdownTotalSeconds(null);
    setCountdownStartedAtMs(null);
    const claim = rollClaim();
    if (claim === null) {
      rollNextStar();
      return;
    }
    applyClaim(claim, position);
    rollNextStar();
  }, [star, rollClaim, applyClaim, rollNextStar]);

  // Buy a golden star (StarBroker). Validated client-side now (the
  // server no longer polices buys): the player must own StarBroker,
  // the cooldown must be ready, and the player must afford the 30x
  // passive LOC/s cost. The client deducts the cost locally (BUY_STAR,
  // which also arms the buy cooldown from lastStarBuyAtMs), shows the
  // bought star, and saves promptly so the deduction persists. The
  // bought star is a separate star from the natural one — it stacks,
  // and the natural timer is never touched.
  const handleBuyStar = useCallback(() => {
    if (starBrokerLevel < 1) return;
    if (buyCooldownActive) return;
    if (buyCost === null) return;
    if (state.linesOfCode < buyCost) return;
    dispatch({ type: "BUY_STAR", payload: { cost: buyCost } });
    setBoughtStar(randomStarPosition());
    setBoughtFading(false);
    setBoughtStarAtMs(Date.now());
    playStarSpawnSound();
    saveNow();
  }, [
    starBrokerLevel,
    buyCooldownActive,
    buyCost,
    state.linesOfCode,
    dispatch,
    saveNow,
  ]);

  // Claim a bought star: the player clicked the star they bought. The
  // outcome is rolled locally at click time (like the natural star)
  // and applied the same way.
  const handleBoughtStarClick = useCallback(() => {
    if (!boughtStar) return;
    // Hide the bought star immediately so a double-click cannot claim
    // twice.
    const position = boughtStar;
    setBoughtStar(null);
    setBoughtFading(false);
    setBoughtStarAtMs(null);
    const claim = rollClaim();
    if (claim === null) return;
    applyClaim(claim, position);
  }, [boughtStar, rollClaim, applyClaim]);

  // Whether the next-star countdown may be shown (a client-side
  // unlock now): the player reaches Constellation level
  // STAR_CONFIG.countdownUnlockLevel. The star itself still spawns on
  // schedule before then; only the timer is gated.
  const countdownUnlocked =
    constellationLevel >= STAR_CONFIG.countdownUnlockLevel;

  const showCountdown =
    countdownUnlocked &&
    star === null &&
    secondsLeft !== null &&
    secondsLeft > 0;

  // Fill proportion for the countdown bar: 0% when the star was just
  // armed (secondsLeft == total), 100% when it is due (secondsLeft
  // == 0). Clamped so a stale total can never over/under-fill.
  const countdownFillPct =
    countdownTotalSeconds !== null && countdownTotalSeconds > 0
      ? Math.min(
          100,
          Math.max(
            0,
            ((countdownTotalSeconds - secondsLeft) /
              countdownTotalSeconds) *
              100
          )
        )
      : 0;

  return (
    <>
      {star && (
        <button
          type="button"
          aria-label="Golden star, click for a random reward"
          className={fading ? "golden-star fading" : "golden-star"}
          style={{ left: `${star.x}px`, top: `${star.y}px` }}
          onClick={handleStarClick}
        >
          <FaStar size={STAR_SIZE_PX} color="#ffd700" />
        </button>
      )}
      {/* A bought star renders exactly like a natural star (same
          presentation, same lifetime) and is independently clickable —
          the two can be on screen at once, which is the whole point of
          buying one. */}
      {boughtStar && (
        <button
          type="button"
          aria-label="Bought golden star, click for a random reward"
          className={boughtFading ? "golden-star fading" : "golden-star"}
          style={{ left: `${boughtStar.x}px`, top: `${boughtStar.y}px` }}
          onClick={handleBoughtStarClick}
        >
          <FaStar size={STAR_SIZE_PX} color="#ffd700" />
        </button>
      )}
      {/* Collapsed star bar area: a thin strip in the countdown slot.
          Tap it to reopen the bars. Shown instead of all three bars
          when the area is collapsed. */}
      {starBarsCollapsed &&
        countdownSlot &&
        createPortal(
          <div
            className="star-bar-collapsed"
            role="button"
            aria-label="Show the star bars"
            onClick={toggleStarBarsCollapsed}
          >
            <span className="star-bar-collapsed-text">★ ▾</span>
          </div>,
          countdownSlot
        )}
      {showCountdown &&
        !starBarsCollapsed &&
        countdownSlot &&
        createPortal(
          <div
            className="star-countdown-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(countdownFillPct)}
            aria-label={`Next golden star in ${formatCountdown(secondsLeft)}. Tap to hide the star bars`}
            onClick={toggleStarBarsCollapsed}
          >
            <div
              className="star-countdown-bar-fill"
              style={{ width: `${countdownFillPct}%` }}
            />
            <span className="star-countdown-bar-text">
              ★ {formatCountdown(secondsLeft)} ▴
            </span>
          </div>,
          countdownSlot
        )}
      {/* One duration bar per live timed buff, below the countdown
          bar: the bar depletes as the effect runs out. At most one
          buff per (effect, employeeType) can be live, so the stack
          stays short in practice (usually one bar). Tapping the bars
          collapses the whole star area, like the countdown bar. */}
      {liveEffects.length > 0 &&
        !starBarsCollapsed &&
        effectSlot &&
        createPortal(
          <div className="star-effect-bars" onClick={toggleStarBarsCollapsed}>
            {liveEffects.map((buff) => (
              <StarEffectBar
                key={`${buff.effect}:${buff.employeeType ?? ""}`}
                buff={buff}
                nowMs={nowMs}
              />
            ))}
          </div>,
          effectSlot
        )}
      {/* Buy Star (StarBroker): the button and its cooldown timer, in
          the star bar area below the effect bars. Shown only when the
          player owns StarBroker. Tapping the bar (not the button)
          collapses the whole star area; the button itself buys (its
          click stops propagation so it never collapses instead). */}
      {starBrokerLevel >= 1 &&
        !starBarsCollapsed &&
        buySlot &&
        createPortal(
          <div className="star-buy-bar" onClick={toggleStarBarsCollapsed}>
            <button
              type="button"
              className="star-buy-button"
              disabled={!buyReady}
              aria-label={
                buyCooldownActive
                  ? `Buy a golden star, available in ${formatCountdown(buyCooldownRemainingSeconds)}`
                  : buyReady
                    ? `Buy a golden star for ${formatNumber(buyCost)} LOC`
                    : `Buy a golden star, costs ${formatNumber(buyCost)} LOC`
              }
              onClick={(event) => {
                event.stopPropagation();
                handleBuyStar();
              }}
            >
              ★ Buy a Star
            </button>
            <span className="star-buy-text">{buyText}</span>
          </div>,
          buySlot
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
