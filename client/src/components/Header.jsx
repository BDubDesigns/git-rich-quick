import { StatBox } from "./StatBox";
import smallLogo from "../img/duck_logo_small.png";

export function Header() {
  return (
    <header className="mt-0 mb-0">
      {/* Mobile: Stacked (title + stats) */}
      <div className="lg:hidden text-center">
        <h1 className="hidden md:block text-3xl font-bold">Git Rich Quick</h1>
        <StatBox />
      </div>

      {/* Desktop: Horizontal (title left, stats right) */}
      <div className="hidden lg:flex lg:items-center lg:justify-center">
        <span className="flex items-center justify-center gap-4 px-4 py-1 border rounded-2xl m-2 bg-[#181818] border-[var(--border-color)]">
          <img
            src={smallLogo}
            alt="Git Rich Quick Logo"
            className="mb-1 w-14 h-14"
          />
          <h1 className="text-3xl font-bold">Git Rich Quick</h1>
          <StatBox />
        </span>
      </div>

      {/* Next-star countdown slot (issue #29): the GoldenStar component
          portals its thin countdown bar here, so it sits directly
          beneath the stats bar, full width with a small inset, on
          mobile and desktop. Empty (zero height) when no countdown is
          active. */}
      <div id="star-countdown-slot" className="px-2" />

      {/* Active-effect slot: GoldenStar portals one thin duration bar
          per live timed buff here, below the countdown bar, so both
          bars sit under the stats bar. Empty when no effect is live. */}
      <div id="star-effect-slot" className="px-2" />

      {/* Buy-star slot: GoldenStar portals the Buy Star button and its
          cooldown timer here, below the effect bars, so the whole star
          area (countdown, effects, buy) sits under the stats bar. Empty
          when the player owns no StarBroker. The star area is
          collapsible — GoldenStar owns the toggle (tap the countdown
          bar to hide all the bars, tap the collapsed strip to show them). */}
      <div id="star-buy-slot" className="px-2" />
    </header>
  );
}
