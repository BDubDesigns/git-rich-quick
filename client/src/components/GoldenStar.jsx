import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaStar } from "react-icons/fa";
import { useGameContext } from "../context/useGameContext";
import { useFloatingText } from "../hooks/useFloatingText";
import { EMPLOYEE_CONFIGS } from "../context/gameConfig";
import { getBaseLocPerSecond, getConstellationLevel, getStarBrokerLevel } from "../context/gameLogic";
import { STAR_CONFIG, starBrokerBuyCost, starBuffDurationSeconds, starEffectName, starRewardDetail } from "../../../shared/game-balance.js";
import { formatNumber } from "../../../shared/formatNumber.js";
import {
  SAVE_API_URL,
  getNextStar,
  claimStar,
  buyStar,
  claimBoughtStar,
} from "../save/api.js";
import { playStarSpawnSound, playStarClickSound } from "../utils/sound.js";
import { FloatingText } from "./FloatingText.jsx";
import "./GoldenStar.css";

/** The star's rendered size in px; spawn positions keep it fully on-screen. */
const STAR_SIZE_PX = 64;
/** Retry delay (seconds) after a failed next-star / claim request. */
const STAR_FETCH_RETRY_SECONDS = 30;
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
  const { state, dispatch, recordStarClaim, savePlayerId, saveNow } =
    useGameContext();
  const { floatingTexts, triggerFloatingText, handleAnimationEnd } =
    useFloatingText();
  const [star, setStar] = useState(null);
  // Whether the star is in its fade-out window (issue #49): it starts
  // fading starFadeSeconds before it despawns, so the player gets a
  // "click me now or lose me" signal instead of it just vanishing.
  const [fading, setFading] = useState(false);
  // A BOUGHT star (StarBroker), shown alongside a natural star — the
  // whole point is stacking. Same 30s lifetime, same presentation,
  // independent click/claim path (claimBoughtStar). Null when none is
  // pending. boughtStarAtMs is the wall-clock time it appeared, for
  // the lifetime backstop (the despawn timer freezes in the background).
  const [boughtStar, setBoughtStar] = useState(null);
  const [boughtFading, setBoughtFading] = useState(false);
  const [boughtStarAtMs, setBoughtStarAtMs] = useState(null);
  // Buy-star cooldown (StarBroker): the total and the wall-clock time
  // the current cooldown was armed from (the server's remaining, or
  // the buy response's cooldown). Derived from the wall clock, like
  // the star countdown — never from counting ticks. Null = no
  // cooldown armed (ready to buy, or no StarBroker yet).
  const [buyCooldownTotalSeconds, setBuyCooldownTotalSeconds] =
    useState(null);
  const [buyCooldownStartedAtMs, setBuyCooldownStartedAtMs] =
    useState(null);
  // A buy in flight (the Buy button is disabled while one runs, so a
  // double-tap cannot fire two buys — the server would reject the
  // second on cooldown anyway, but the button should not lie).
  const [buyInFlight, setBuyInFlight] = useState(false);
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
  // delay instead of spinning. The response also carries the
  // StarBroker buy status, which arms (or resyncs) the buy cooldown
  // from the server's remaining — the server is the authority on when
  // the next buy is available, the client only counts it down.
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
      if (typeof data.buyCooldownSecondsRemaining === "number") {
        setBuyCooldownTotalSeconds(data.buyCooldownSecondsRemaining);
        setBuyCooldownStartedAtMs(Date.now());
      }
    } catch {
      if (!mountedRef.current) return;
      retryTimerRef.current = setTimeout(
        () => fetchNext(),
        STAR_FETCH_RETRY_SECONDS * 1000
      );
    }
  }, [savePlayerId, constellationLevel]);

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

  // Buy-star cooldown remaining (seconds), derived from the wall
  // clock — the total the server returned (or the buy response's
  // cooldown) minus the elapsed time since it was armed. Null when no
  // cooldown is armed: the player never bought (ready), or owns no
  // StarBroker. The countdown is a difference of two client readings,
  // so it cannot drift (same wall-clock rule as the star countdown).
  const buyCooldownRemainingSeconds =
    buyCooldownTotalSeconds === null || buyCooldownStartedAtMs === null
      ? null
      : Math.max(
          0,
          Math.ceil(
            buyCooldownTotalSeconds - (nowMs - buyCooldownStartedAtMs) / 1000
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

  // Despawn an unclicked BOUGHT star after its lifetime (same 30s,
  // same fade in the last 5s). Unlike the natural star, there is no
  // next star to re-fetch — the natural schedule was never touched by
  // the buy, so it continues on its own. The pending bought star
  // simply expires server-side (a late claim is rejected).
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

  // Apply a server-issued star claim (natural or bought — the two
  // claims are the same shape, and the server validates both against
  // an issued outcome). The claim and the state change are applied in
  // the same handler, with the exact deltas applied, so the claim and
  // the state change can never disagree. The floating text appears at
  // the clicked star's position.
  const applyClaim = useCallback(
    (claim, position) => {
      dispatch({ type: "APPLY_STAR_REWARD", payload: { claim } });
      recordStarClaim(claim);
      playStarClickSound(claim.good);
      triggerFloatingText(
        position.x + STAR_SIZE_PX / 2,
        position.y,
        starRewardLabel(claim),
        <FaStar size={20} color="#ffd700" />
      );
    },
    [dispatch, recordStarClaim, triggerFloatingText]
  );

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
      applyClaim(data.claim, star);
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
  }, [star, savePlayerId, applyClaim, fetchNext]);

  // Buy a golden star (StarBroker). The server validates the level,
  // the cooldown, and affordability, deducts the cost from the stored
  // state, and records a pending bought star. The client deducts the
  // same cost locally (BUY_STAR), shows the bought star, arms the buy
  // cooldown from the server's answer, and saves promptly so the
  // deduction persists. The bought star is a separate star from the
  // natural one — it stacks, and the natural timer is never touched.
  const handleBuyStar = useCallback(async () => {
    if (!savePlayerId || buyInFlight) return;
    setBuyInFlight(true);
    try {
      const { status, data } = await buyStar(SAVE_API_URL, savePlayerId);
      if (!mountedRef.current) return;
      if (status !== 200 || !data) {
        // Refused (cooldown / not enough LOC / no StarBroker): resync
        // the cooldown from the server's answer when it carries one,
        // and re-fetch the schedule (which carries the buy status).
        if (typeof data?.cooldownSecondsRemaining === "number") {
          setBuyCooldownTotalSeconds(data.cooldownSecondsRemaining);
          setBuyCooldownStartedAtMs(Date.now());
        }
        fetchNext();
        return;
      }
      dispatch({ type: "BUY_STAR", payload: { cost: data.cost } });
      setBoughtStar(randomStarPosition());
      setBoughtFading(false);
      setBoughtStarAtMs(Date.now());
      setBuyCooldownTotalSeconds(data.buyCooldownSeconds);
      setBuyCooldownStartedAtMs(Date.now());
      playStarSpawnSound();
      saveNow();
    } catch {
      // Network failure: the buy may or may not have landed — re-fetch
      // the schedule (which carries the buy status) to resync.
      if (!mountedRef.current) return;
      fetchNext();
    } finally {
      if (mountedRef.current) setBuyInFlight(false);
    }
  }, [savePlayerId, buyInFlight, dispatch, fetchNext, saveNow]);

  // Claim a bought star: the player clicked the star they bought. The
  // server rolls the outcome (at click time, like the natural star)
  // and clears the pending bought star; the client applies exactly
  // the returned claim, the same way as a natural claim.
  const handleBoughtStarClick = useCallback(async () => {
    if (!boughtStar || !savePlayerId) return;
    // Hide the bought star immediately so a double-click cannot claim
    // twice; the server also only issues one outcome per bought star.
    const position = boughtStar;
    setBoughtStar(null);
    setBoughtFading(false);
    setBoughtStarAtMs(null);
    try {
      const { status, data } = await claimBoughtStar(
        SAVE_API_URL,
        savePlayerId
      );
      if (!mountedRef.current) return;
      if (status !== 200 || !data?.claim) {
        // No bought star pending (already claimed / burned out):
        // nothing to apply.
        return;
      }
      applyClaim(data.claim, position);
    } catch {
      // Network failure: the claim may or may not have landed, but the
      // reward is only applied when the server answers, so nothing is
      // lost.
      return;
    }
  }, [boughtStar, savePlayerId, applyClaim]);

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

  // Buy Star button state (StarBroker). The cost is 30x the player's
  // base passive LOC/s (the same shared formula the server prices a
  // buy from), recomputed from the live state so it is never stale as
  // the player hires. The button is enabled when the player owns
  // StarBroker, the cooldown is ready, the player can afford it, and
  // no buy is in flight. The cooldown text counts down from the
  // server's remaining; the server is the authority (a too-early buy
  // is rejected and the cooldown resyncs from the answer).
  const buyCost =
    starBrokerLevel < 1
      ? null
      : starBrokerBuyCost(getBaseLocPerSecond(state));
  const buyReady =
    starBrokerLevel >= 1 &&
    !buyCooldownActive &&
    !buyInFlight &&
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
      {/* A bought star renders exactly like a natural star (same
          presentation, same lifetime) and is independently clickable —
          the two can be on screen at once, which is the whole point of
          buying one. */}
      {boughtStar && (
        <button
          type="button"
          aria-label="Bought golden star — click for a random reward"
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
            aria-label={`Next golden star in ${formatCountdown(secondsLeft)} — tap to hide the star bars`}
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
                  ? `Buy a golden star — available in ${formatCountdown(buyCooldownRemainingSeconds)}`
                  : buyReady
                    ? `Buy a golden star for ${formatNumber(buyCost)} LOC`
                    : `Buy a golden star — costs ${formatNumber(buyCost)} LOC`
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
