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

export function Footer() {
  const { saveStatus } = useGameContext();

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
          <div className="text-xs opacity-60 mt-2">
            {SAVE_STATUS_LABELS[saveStatus] ?? ""}
          </div>
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
            <div className="text-xs opacity-60">
              {SAVE_STATUS_LABELS[saveStatus] ?? ""}
            </div>
          </div>
        </span>
      </div>
    </>
  );
}
