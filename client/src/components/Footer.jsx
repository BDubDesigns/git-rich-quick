import { useGameContext } from "../context/GameContext";
import { ClickButton } from "./ClickButton";
import { CPSMeter } from "./CPSMeter";
import { NavBar } from "./NavBar";

export function Footer() {
  const { state } = useGameContext();

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
          </div>
        </span>
      </div>
    </>
  );
}
