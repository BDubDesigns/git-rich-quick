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
    </header>
  );
}
