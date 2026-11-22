import { useEffect, useState } from "react";
import { useGameContext } from "../context/useGameContext";
import { ClickButton } from "./ClickButton";
import { CPSMeter } from "./CPSMeter";
import { NavBar } from "./NavBar";
import { EmailNotificationBar } from "./EmailNotificationBar";
import { Panel } from "./Panel.jsx";
import { WorkModeToggle } from "./WorkModeToggle.jsx";
import { ReviewPanel } from "./ReviewPanel.jsx";
import { writeModeDebtLine } from "../utils/agentFleetPanel.js";
import {
  WORK_MODE_AGENTS,
  claimWorkModeAnnouncement,
  effectiveWorkMode,
  readWorkMode,
  workModeUnlocked,
  writeWorkMode,
} from "../utils/workMode.js";
import {
  NEW_VERSION_STATUS,
  SAVE_RATE_LIMIT_SECONDS,
} from "../save/saveSync.js";

// Save status (Slice 2, server-authoritative saves). The engine reports it
// via context; the footer just renders it, it never drives a save.
const SAVE_STATUS_LABELS = {
  loading: "Connecting to save server…",
  saving: "Saving…",
  saved: "Progress saved",
  offline: "Offline. Progress will sync when reconnected",
  error: "Save error. Progress reverted to the last good save",
  [NEW_VERSION_STATUS]: "Saving paused until you reload",
};

/** The reload prompt (stale-client guard). No dashes: player-facing. */
export const NEW_VERSION_MESSAGE = "A new version is out. Reload to keep playing.";

/**
 * Stale-client guard: a newer build is deployed, so this tab has
 * stopped saving (its idea of the save may lack fields the new build
 * writes). The prompt stays until the player reloads: there is no
 * dismiss, and the engine keeps the status pinned. It sits in the
 * normal flow above the nav, like the email bar, so it never covers
 * the game, and spans the width on a phone.
 */
function NewVersionBanner() {
  const { saveStatus } = useGameContext();
  if (saveStatus !== NEW_VERSION_STATUS) return null;
  return (
    <Panel className="mt-1 flex items-center justify-between gap-3 border border-amber-400 bg-amber-950 px-3 py-2 text-amber-100">
      <span role="alert" className="text-sm leading-snug">
        {NEW_VERSION_MESSAGE}
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded bg-amber-400 px-3 py-1.5 text-sm font-semibold text-black hover:bg-amber-300"
      >
        Reload
      </button>
    </Panel>
  );
}

// "Saved just now" right after a save, then "Saved 5s ago", "Saved 2m ago".
function formatSavedAgo(savedAtMs, nowMs) {
  const seconds = Math.max(0, Math.floor((nowMs - savedAtMs) / 1000));
  if (seconds < 5) return "Saved just now";
  if (seconds < 60) return `Saved ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Saved ${minutes}m ago`;
  return `Saved ${Math.floor(minutes / 60)}h ago`;
}

// Compact save line: live relative time once a save has landed this
// session, plus a "Save now" button that forces an immediate save.
// While a rate-limited save waits to retry, it counts down
// ("Retrying in 25s") instead of a bare "Saving..." that looks hung.
// The button also greys out (with its own countdown) until the server's
// rate limit has passed since the last accepted save, so tapping it can't
// just land in a 429 retry — when it's enabled, a manual save will land.
function SaveStatus() {
  const { saveStatus, lastSavedAt, retryEndsAtMs, saveNow } =
    useGameContext();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const showRelative = saveStatus === "saved" && lastSavedAt != null;
  const showRetry = saveStatus === "retrying";
  // Seconds until a manual save can land (server allows one per 1s).
  // Null when no save has landed yet (nothing to count down from).
  const cooldownSeconds =
    lastSavedAt == null
      ? null
      : Math.max(
          0,
          Math.ceil(
            (SAVE_RATE_LIMIT_SECONDS * 1000 - (nowMs - lastSavedAt)) / 1000
          )
        );
  const onCooldown = cooldownSeconds != null && cooldownSeconds > 0;

  // Tick the relative time while a successful save is being shown, the
  // retry countdown while waiting to retry, and the button cooldown.
  // The retry deadline comes from context (an absolute timestamp the
  // engine sets on every 429), so there is no local re-arm effect to
  // go stale: the countdown is always derived from the latest deadline.
  useEffect(() => {
    if (!showRelative && !showRetry && !onCooldown) return undefined;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showRelative, showRetry, onCooldown]);

  let label;
  if (showRetry) {
    const remaining =
      retryEndsAtMs == null
        ? null
        : Math.max(0, Math.ceil((retryEndsAtMs - nowMs) / 1000));
    label = remaining == null ? "Saving…" : `Retrying in ${remaining}s`;
  } else if (showRelative) {
    label = formatSavedAgo(lastSavedAt, nowMs);
  } else {
    label = SAVE_STATUS_LABELS[saveStatus] ?? "";
  }
  // Disabled while a save is in flight, while waiting to retry, while the
  // server is unreachable, or while the rate-limit cooldown hasn't passed
  // since the last accepted save.
  const saveDisabled =
    saveStatus === "saving" ||
    saveStatus === "retrying" ||
    saveStatus === "offline" ||
    saveStatus === "loading" ||
    saveStatus === NEW_VERSION_STATUS ||
    onCooldown;

  return (
    <div className="mt-1 flex items-center justify-center gap-2 text-[11px] leading-none opacity-60">
      <span>{label}</span>
      {/* The button always reads "Save now": the status line beside it
          carries the state ("Saved just now", "Saving…", "Retrying in
          Ns"). The old "Save in Ns" countdown read as a pending save
          while the status line said the save had already landed, which
          looked contradictory. The button still greys out for the 1s
          rate-limit cooldown after a save; it just does not count it
          down. */}
      <button
        type="button"
        onClick={saveNow}
        disabled={saveDisabled}
        className="rounded border border-current px-1.5 py-0.5 opacity-80 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Save now
      </button>
    </div>
  );
}

/**
 * Agent Fleet, slice 1 (issue #267): the Commit area's mode. Below
 * Series A there is no toggle and the mode is always "write", so the
 * area renders exactly as before. The choice is one per device
 * (utils/workMode.js), held here once so the mobile and desktop
 * layouts (both mounted, one hidden by CSS) can never disagree. When
 * the toggle first appears on this device, one announcement mail is
 * asked for; the trigger key dedupes it in the inbox.
 */
function useWorkMode() {
  const { state, dispatch } = useGameContext();
  const unlocked = workModeUnlocked(state.permanentStoreRanks);
  const [storedMode, setStoredMode] = useState(() => readWorkMode());
  const mode = effectiveWorkMode(storedMode, unlocked);
  const chooseMode = (next) => {
    setStoredMode(next);
    writeWorkMode(next);
  };
  useEffect(() => {
    if (!unlocked || !claimWorkModeAnnouncement()) return;
    dispatch({ type: "ANNOUNCE_AGENT_FLEET_TOGGLE" });
  }, [unlocked, dispatch]);
  return { unlocked, mode, chooseMode };
}

/**
 * Agent Fleet (issue #267): in Write code mode, with any tech debt, one
 * compact line above the Commit button says every commit pays it down
 * (the reducer applies the paydown; the button is untouched). Nothing
 * renders with no debt, so the Commit area is unchanged.
 */
function WriteModeDebtLine({ className = "" }) {
  const { state } = useGameContext();
  const line = writeModeDebtLine(state.agentFleet);
  if (!line) return null;
  return (
    <p
      className={`m-0 font-mono text-[11px] leading-4 text-amber-300 ${className}`}
      data-write-debt-line
    >
      {line}
    </p>
  );
}

export function Footer() {
  const { unlocked, mode, chooseMode } = useWorkMode();
  // Manage agents mode swaps the Clicks/sec line and the Commit button
  // for the Review panel. The Commit button is not rendered at all, so
  // no manual commit can happen (there is no keyboard shortcut).
  const agents = mode === WORK_MODE_AGENTS;
  // The email notification bar renders in the normal flow above the
  // nav/commit panels (issue #104), so it takes layout space and
  // never covers panel content.
  return (
    <div>
      <NewVersionBanner />
      <EmailNotificationBar />
      {/* Mobile: Stacked (nav + commit button) */}
      <div className="lg:hidden">
        <Panel className="flex justify-evenly gap-4 mt-1 py-4 bg-[#181818]">
          <NavBar />
        </Panel>
        <Panel className={unlocked ? "text-center mt-2 pt-3 pb-5" : "text-center mt-2 pb-5"}>
          {unlocked ? (
            <WorkModeToggle
              mode={mode}
              onChange={chooseMode}
              className="mx-auto mb-2 w-[85%]"
            />
          ) : null}
          {agents ? null : <WriteModeDebtLine className="mx-auto w-[85%]" />}
          {agents ? (
            <ReviewPanel className="mx-auto w-[85%]" />
          ) : (
            <>
              <CPSMeter />
              <ClickButton />
            </>
          )}
          <SaveStatus />
        </Panel>
      </div>

      {/* Desktop: Horizontal (nav left, commit button right) */}
      <Panel className="hidden lg:flex lg:items-center lg:justify-between lg:gap-4 lg:py-3 lg:px-4 bg-[#181818]">
        {/* Nav on the left, commit button on the right. The stray
            "New Emails" label that used to sit here is removed
            (issue #103): each tab now carries its own label under
            its icon, so a detached label in the middle of the footer
            only confused which tab it belonged to. */}
        <NavBar />

        {/* Once the toggle exists the group is pinned right, so the
            toggle never moves when the mode changes; before Series A it
            is centered as it always was. */}
        <span
          className={
            unlocked
              ? "inline-flex min-w-0 flex-1 items-center justify-end gap-6"
              : "inline-flex flex-1 items-center justify-center gap-8"
          }
        >
          {/* Manage agents (issue #267): the PR card sits where
              Clicks/sec was, and its buttons go in the Commit column, so
              the footer stays short. */}
          {agents ? (
            <ReviewPanel part="queue" className="min-w-52 max-w-[22rem] flex-1" />
          ) : (
            <CPSMeter />
          )}
          {/* Once the toggle exists the column has one fixed width, so
              the toggle does not resize or move when the mode changes. */}
          <div
            className={
              unlocked
                ? "flex w-72 flex-col items-end gap-1"
                : "flex flex-col items-end gap-1"
            }
          >
            {unlocked ? (
              <WorkModeToggle
                mode={mode}
                onChange={chooseMode}
                className="w-full"
              />
            ) : null}
            {agents ? null : <WriteModeDebtLine className="w-full text-right" />}
            {agents ? <ReviewPanel part="actions" className="w-full" /> : <ClickButton />}
            <SaveStatus />
          </div>
        </span>
      </Panel>
    </div>
  );
}
