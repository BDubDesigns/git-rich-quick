import { useEffect, useState } from "react";
import { useGameContext } from "../context/GameContext";
import { ClickButton } from "./ClickButton";
import { CPSMeter } from "./CPSMeter";
import { NavBar } from "./NavBar";

// Save status (Slice 2, server-authoritative saves). The engine reports it
// via context; the footer just renders it, it never drives a save.
const SAVE_STATUS_LABELS = {
  loading: "Connecting to save server…",
  saving: "Saving…",
  saved: "Progress saved",
  offline: "Offline — progress will sync when reconnected",
  error: "Save error — progress reverted to the last good save",
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
function SaveStatus() {
  const { saveStatus, lastSavedAt, saveNow } = useGameContext();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const showRelative = saveStatus === "saved" && lastSavedAt != null;

  // Tick the relative time while a successful save is being shown.
  useEffect(() => {
    if (!showRelative) return undefined;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showRelative]);

  const label = showRelative
    ? formatSavedAgo(lastSavedAt, nowMs)
    : SAVE_STATUS_LABELS[saveStatus] ?? "";
  // Disabled while a save is in flight or the server is unreachable.
  const saveDisabled =
    saveStatus === "saving" ||
    saveStatus === "offline" ||
    saveStatus === "loading";

  return (
    <div className="mt-1 flex items-center justify-center gap-2 text-[11px] leading-none opacity-60">
      <span>{label}</span>
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

export function Footer() {
  return (
    <>
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
    </>
  );
}
