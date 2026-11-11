import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaStar } from "react-icons/fa";
import { useGameContext } from "../context/useGameContext";
import { useFloatingText } from "../hooks/useFloatingText";
import { EMPLOYEE_CONFIGS } from "../context/gameConfig";
import { getConstellationLevel } from "../context/gameLogic";
import { STAR_CONFIG, starBuffDurationSeconds, starEffectName, starRewardDetail } from "../../../shared/game-balance.js";
import {
  SAVE_API_URL,
  getNextStar,
  claimStar,
} from "../save/api.js";
import { playStarSpawnSound, playStarClickSound } from "../utils/sound.js";
import { FloatingText } from "./FloatingText.jsx";
import "./GoldenStar.css";

/** The star's rendered size in px; spawn positions keep it fully on-screen. */
const STAR_SIZE_PX = 64;
/** Retry delay (seconds) after a failed next-star / claim request. */
const STAR_FETCH_RETRY_SECONDS = 30;

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
 * 2-7x, bad 0.5x). The multiplier comes from the live buff data (the
 * same value the email reports), never hardcoded per effect. Green
 * fill for a buff, red for a debuff.
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
      aria-label={`${label} ${buff.multiplier}x — ${formatCountdown(remainingSeconds)} left`}
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
 * Golden star (GitNub Constellation, issue #29): fully server-driven.
 *
 * The SERVER owns the schedule and the outcome. The client fetches the
 * next star time (GET /api/star/next) and arms a countdown from the
 * duration the server returns — it never picks its own spawn time, so
 * client/server clock skew cannot shift it. When the countdown hits
 * zero the star appears; clicking it asks the server for the outcome
 * (POST /api/star/claim) and applies exactly the claim the server
 * returns (with its claimId), so a hacked client cannot claim a reward
 * the server never issued. An unclicked star despawns after its
 * lifetime and the client re-fetches (the server rolls a fresh time —
 * the missed window has passed).
 *
 * The countdown display is an unlockable: the server reports
 * `countdownUnlocked` and the client only shows the timer once the
 * player reaches that Constellation level. The star itself still
 * spawns on schedule before then; only the timer is gated. The timer
 * is a thin progress bar under the stats bar that fills left to
 * right as the star approaches, with the small seconds-remaining
 * text inside it.
 */
export function GoldenStar() {
  const { state, dispatch, recordStarClaim, savePlayerId } =
    useGameContext();
  const { floatingTexts, triggerFloatingText, handleAnimationEnd } =
    useFloatingText();
  const [star, setStar] = useState(null);
  // Whether the star is in its fade-out window (issue #49): it starts
  // fading starFadeSeconds before it despawns, so the player gets a
  // "click me now or lose me" signal instead of it just vanishing.
  const [fading, setFading] = useState(false);
  // Whether the next-star countdown may be shown (server-gated unlock).
  const [countdownUnlocked, setCountdownUnlocked] = useState(false);
  // Seconds until the next star appears (null = no star scheduled).
  const [secondsLeft, setSecondsLeft] = useState(null);
  // The total interval the current countdown started from (the
  // duration the server returned). The progress bar fills from
  // 0% (just rolled) to 100% (due) as secondsLeft counts down from
  // this total — it is set from the same server value as secondsLeft,
  // so the fill and the text can never disagree.
  const [countdownTotalSeconds, setCountdownTotalSeconds] = useState(null);
  // Client wall-clock time (Date.now()) when the current countdown was
  // armed. The countdown is derived from this + the total (see the tick
  // effect), NOT from counting setInterval ticks — counting ticks drifts
  // behind real time (render time per tick, and background throttling
  // on mobile freezes timers), so a star shown from a drifted countdown
  // can already be past the server's 30s claim window and the click is
  // rejected with no reward (the PR #64 regression). The wall clock is
  // the authority; the interval only triggers re-renders. Elapsed time
  // is a difference of two client readings, so this is clock-skew
  // independent (the server's absolute nextStarAtMs is never compared
  // to the client clock).
  const [countdownStartedAtMs, setCountdownStartedAtMs] = useState(null);
  // The header slot the countdown bar portals into (see Header.jsx):
  // the bar sits directly beneath the stats bar instead of floating
  // above the Commit button. Grabbed after mount — the header is in
  // the same commit, so it always exists by then.
  const [countdownSlot, setCountdownSlot] = useState(null);
  // The header slot the active-effect bars portal into (below the
  // countdown slot). Same grab-after-mount pattern.
  const [effectSlot, setEffectSlot] = useState(null);
  useEffect(() => {
    setCountdownSlot(document.getElementById("star-countdown-slot"));
    setEffectSlot(document.getElementById("star-effect-slot"));
  }, []);
  const constellationLevel = getConstellationLevel(state);
  const mountedRef = useRef(true);
  const retryTimerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // Fetch the server's next star time and arm the countdown from the
  // duration it returns. A failed fetch (offline) retries after a
  // delay instead of spinning.
  const fetchNext = useCallback(async () => {
    if (!savePlayerId || constellationLevel < 1) {
      setCountdownUnlocked(false);
      setSecondsLeft(null);
      setCountdownTotalSeconds(null);
      setCountdownStartedAtMs(null);
      return;
    }
    try {
      const { status, data } = await getNextStar(SAVE_API_URL, savePlayerId);
      if (!mountedRef.current) return;
      if (status !== 200 || !data || data.secondsUntilStar === null) {
        retryTimerRef.current = setTimeout(
          () => fetchNext(),
          STAR_FETCH_RETRY_SECONDS * 1000
        );
        return;
      }
      setCountdownUnlocked(data.countdownUnlocked);
      setSecondsLeft(data.secondsUntilStar);
      setCountdownTotalSeconds(data.secondsUntilStar);
      setCountdownStartedAtMs(Date.now());
    } catch {
      if (!mountedRef.current) return;
      retryTimerRef.current = setTimeout(
        () => fetchNext(),
        STAR_FETCH_RETRY_SECONDS * 1000
      );
    }
  }, [savePlayerId, constellationLevel]);

  // (Re)fetch when the player or the Constellation level changes.
  // The countdown is cleared alongside the star: while the next time
  // is being fetched, no star is due, and the show-star effect must
  // not re-spawn the cleared star from a stale secondsLeft of 0
  // (the double-star bug).
  useEffect(() => {
    setStar(null);
    setSecondsLeft(null);
    setCountdownTotalSeconds(null);
    setCountdownStartedAtMs(null);
    fetchNext();
  }, [fetchNext]);

  // Tick once a second while a countdown is armed (a star awaited or
  // shown). The countdown is derived from the wall clock — elapsed time
  // since the countdown was armed — NOT from counting setInterval
  // ticks. Counting ticks drifts behind real time (render time per
  // tick, and background throttling on mobile freezes timers), so a
  // star shown from a drifted countdown can already be past the
  // server's 30s claim window and the click is rejected with no reward
  // (the PR #64 regression: the star just disappears). The wall clock
  // is the authority; the interval only triggers re-renders. While a
  // star is shown, the same tick hides it once its window passes (the
  // despawn timer freezes in the background, so a stale star would
  // otherwise stay up and eat the click).
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
        // A shown star whose window passed: hide it and re-fetch.
        if (now > windowEndMs) {
          setStar(null);
          setSecondsLeft(null);
          setCountdownTotalSeconds(null);
          setCountdownStartedAtMs(null);
          fetchNext();
        }
        return;
      }
      const elapsedSeconds = (now - countdownStartedAtMs) / 1000;
      setSecondsLeft(
        Math.max(0, Math.ceil(countdownTotalSeconds - elapsedSeconds))
      );
    }, 1000);
    return () => clearInterval(id);
  }, [countdownStartedAtMs, countdownTotalSeconds, star, fetchNext]);

  // Live timed buffs (frenzy / click / employee) with their expiry
  // still ahead. GAME_TICK drops expired entries from state, but the
  // expiry check here keeps a buff from showing in the gap between
  // its expiry and the next tick.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const liveEffects = (state.activeStarEffects ?? []).filter(
    (buff) => buff.expiresAtMs > nowMs
  );

  // Tick the clock once a second while any effect is live, so the
  // duration bars deplete. The interval only runs while there is
  // something to deplete.
  useEffect(() => {
    if (liveEffects.length === 0) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveEffects.length]);

  // Show the star the moment the countdown hits zero. secondsLeft is
  // null while no star is due (awaiting the next roll), so the guard
  // below only fires on the countdown actually reaching 0 — never on
  // a star that was just dismissed (click / despawn / refetch), which
  // clears the countdown to null first. That clearing is what stops
  // the double-star bug: without it, the effect re-fires while the
  // claim is still in flight (secondsLeft still 0) and spawns a
  // second star whose claim the server rejects (409 star-not-due).
  // Wall-clock backstop: if the star's 30s window already passed
  // (the tab was backgrounded so long the countdown only just caught
  // up), do NOT show a star the server will reject — re-fetch for the
  // next one instead.
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
      fetchNext();
      return undefined;
    }
    setStar(randomStarPosition());
    playStarSpawnSound();
  }, [star, secondsLeft, countdownStartedAtMs, countdownTotalSeconds, fetchNext]);

  // Despawn an unclicked star after its lifetime, then re-fetch the
  // next star time (the server rolls a fresh one). The star starts
  // fading starFadeSeconds before it despawns (issue #49). The
  // countdown is cleared alongside the star, so the show-star effect
  // does not re-spawn it — without the clearing the star stayed up
  // ~60s (two 30s windows) instead of its 30s lifetime.
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
      fetchNext();
    }, STAR_CONFIG.starLifetimeSeconds * 1000);
    return () => {
      clearTimeout(fadeId);
      clearTimeout(despawnId);
    };
  }, [star, fetchNext]);

  const handleStarClick = useCallback(async () => {
    if (!star || !savePlayerId) return;
    // Hide the star immediately so a double-click cannot claim twice;
    // the server also only issues one outcome per due star. Clear the
    // countdown too: while the claim is in flight, no star is due, and
    // the show-star effect must not re-spawn a second star from the
    // stale secondsLeft of 0 (the double-star bug — the second star's
    // claim was rejected 409 star-not-due). The claim response arms
    // the next countdown below; a failed claim re-fetches it.
    setStar(null);
    setSecondsLeft(null);
    setCountdownTotalSeconds(null);
    setCountdownStartedAtMs(null);
    try {
      const { status, data } = await claimStar(SAVE_API_URL, savePlayerId);
      if (!mountedRef.current) return;
      if (status !== 200 || !data?.claim) {
        // Not due (or no stars): re-fetch the schedule.
        fetchNext();
        return;
      }
      const claim = data.claim;
      // Apply the server's claim and record it in the same handler,
      // with the exact deltas applied, so the claim and the state
      // change can never disagree (the server validates the claim
      // against the outcome it issued).
      dispatch({ type: "APPLY_STAR_REWARD", payload: { claim } });
      recordStarClaim(claim);
      playStarClickSound(claim.good);
      triggerFloatingText(
        star.x + STAR_SIZE_PX / 2,
        star.y,
        starRewardLabel(claim),
        <FaStar size={20} color="#ffd700" />
      );
      // Arm the next star from the server's returned time.
      setSecondsLeft(data.secondsUntilStar);
      setCountdownTotalSeconds(data.secondsUntilStar);
      setCountdownStartedAtMs(Date.now());
    } catch {
      // Network failure: the claim may or may not have landed, but the
      // reward is only applied when the server answers, so nothing is
      // lost — re-fetch the schedule and the star comes again.
      if (!mountedRef.current) return;
      fetchNext();
    }
  }, [
    star,
    savePlayerId,
    dispatch,
    recordStarClaim,
    triggerFloatingText,
    fetchNext,
  ]);

  const showCountdown =
    countdownUnlocked &&
    star === null &&
    secondsLeft !== null &&
    secondsLeft > 0;

  // Fill proportion for the countdown bar: 0% when the star was just
  // rolled (secondsLeft == total), 100% when it is due (secondsLeft
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
          aria-label="Golden star — click for a random reward"
          className={fading ? "golden-star fading" : "golden-star"}
          style={{ left: `${star.x}px`, top: `${star.y}px` }}
          onClick={handleStarClick}
        >
          <FaStar size={STAR_SIZE_PX} color="#ffd700" />
        </button>
      )}
      {showCountdown &&
        countdownSlot &&
        createPortal(
          <div
            className="star-countdown-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(countdownFillPct)}
            aria-label={`Next golden star in ${formatCountdown(secondsLeft)}`}
          >
            <div
              className="star-countdown-bar-fill"
              style={{ width: `${countdownFillPct}%` }}
            />
            <span className="star-countdown-bar-text">
              ★ {formatCountdown(secondsLeft)}
            </span>
          </div>,
          countdownSlot
        )}
      {/* One duration bar per live timed buff, below the countdown
          bar: the bar depletes as the effect runs out. At most one
          buff per (effect, employeeType) can be live, so the stack
          stays short in practice (usually one bar). */}
      {liveEffects.length > 0 &&
        effectSlot &&
        createPortal(
          <div className="star-effect-bars">
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
