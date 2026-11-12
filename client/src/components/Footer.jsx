import { useEffect, useState } from "react";
import { useGameContext } from "../context/useGameContext";
import { ClickButton } from "./ClickButton";
import { CPSMeter } from "./CPSMeter";
import { NavBar } from "./NavBar";
import { EmailNotificationBar } from "./EmailNotificationBar";
import { SAVE_RATE_LIMIT_SECONDS } from "../save/saveSync.js";

// Save status (Slice 2, server-authoritative saves). The engine reports it
// via context; the footer just renders it, it never drives a save.
const SAVE_STATUS_LABELS = {
  loading: "Connecting to save server…",
  saving: "Saving…",
  saved: "Progress saved",
  offline: "Offline. Progress will sync when reconnected",
  error: "Save error. Progress reverted to the last good save",
};

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
  // Seconds until a manual save can land (server allows one per 10s).
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
    onCooldown;

  return (
    <div className="mt-1 flex items-center justify-center gap-2 text-[11px] leading-none opacity-60">
      <span>{label}</span>
      <button
        type="button"
        onClick={saveNow}
        disabled={saveDisabled}
        className="rounded border border-current px-1.5 py-0.5 opacity-80 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {onCooldown ? `Save in ${cooldownSeconds}s` : "Save now"}
      </button>
    </div>
  );
}

export function Footer() {
  // The wrapper is relative so the email notification bar (absolute,
  // bottom-full) sits directly above the footer — above the navbar —
  // floating over the main content instead of shifting layout.
  return (
    <div className="relative">
      <EmailNotificationBar />
      {/* Mobile: Stacked (nav + commit button) */}
      <div className="lg:hidden">
        <div className="panel flex justify-evenly gap-4 mt-1 py-4 bg-[#181818]">
          <NavBar />
        </div>
        <div className="text-center mt-2 pb-5 panel">
          <CPSMeter />
          <ClickButton />
          <SaveStatus />
        </div>
      </div>

      {/* Desktop: Horizontal (nav left, commit button right) */}
      <div className="hidden lg:flex lg:items-center lg:justify-between lg:gap-4 lg:py-3 lg:px-4 panel bg-[#181818]">
        {/* Nav on left */}

        {/* Commit button on right */}
        <div className="flex-1 flex justify-center">New Emails</div>
        <NavBar />

        <span className="inline-flex flex-1 items-center justify-center gap-8">
          <div>
            <CPSMeter />
          </div>
          <div className="flex flex-col items-end gap-1">
            <ClickButton />
            <SaveStatus />
          </div>
        </span>
      </div>
    </div>
  );
}
