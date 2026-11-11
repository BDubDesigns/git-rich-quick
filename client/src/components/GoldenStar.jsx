import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaStar } from "react-icons/fa";
import { useGameContext } from "../context/useGameContext";
import { useFloatingText } from "../hooks/useFloatingText";
import { EMPLOYEE_CONFIGS } from "../context/gameConfig";
import { getConstellationLevel } from "../context/gameLogic";
import { STAR_CONFIG, starEffectName, starRewardDetail } from "../../../shared/game-balance.js";
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
 * The countdown display ("Next star in 1m 23s") is an unlockable: the
 * server reports `countdownUnlocked` and the client only shows the
 * timer once the player reaches that Constellation level. The star
 * itself still spawns on schedule before then; only the timer is gated.
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
  // The header slot the countdown pill portals into (see Header.jsx):
  // the pill sits directly beneath the stats bar instead of floating
  // above the Commit button. Grabbed after mount — the header is in
  // the same commit, so it always exists by then.
  const [countdownSlot, setCountdownSlot] = useState(null);
  useEffect(() => {
    setCountdownSlot(document.getElementById("star-countdown-slot"));
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
    } catch {
      if (!mountedRef.current) return;
      retryTimerRef.current = setTimeout(
        () => fetchNext(),
        STAR_FETCH_RETRY_SECONDS * 1000
      );
    }
  }, [savePlayerId, constellationLevel]);

  // (Re)fetch when the player or the Constellation level changes.
  useEffect(() => {
    setStar(null);
    fetchNext();
  }, [fetchNext]);

  // Tick the countdown once a second while a star is awaited.
  useEffect(() => {
    if (star !== null || secondsLeft === null || secondsLeft <= 0) {
      return undefined;
    }
    const id = setInterval(() => {
      setSecondsLeft((prev) =>
        prev === null ? null : Math.max(0, prev - 1)
      );
    }, 1000);
    return () => clearInterval(id);
  }, [star, secondsLeft]);

  // Show the star the moment the countdown hits zero.
  useEffect(() => {
    if (star !== null || secondsLeft !== 0) return undefined;
    setStar(randomStarPosition());
    playStarSpawnSound();
  }, [star, secondsLeft]);

  // Despawn an unclicked star after its lifetime, then re-fetch the
  // next star time (the server rolls a fresh one). The star starts
  // fading starFadeSeconds before it despawns (issue #49).
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
    // the server also only issues one outcome per due star.
    setStar(null);
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
          <div className="star-countdown" aria-live="off">
            Next star in {formatCountdown(secondsLeft)}
          </div>,
          countdownSlot
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
