import { useRef } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { useScrollAffordances } from "../hooks/useScrollAffordances.js";
import { ScrollAffordanceOverlay } from "./ScrollAffordances.jsx";

export function GameLayout({ children }) {
  // The main scroll container (mobile) lives in a relative frame so
  // the scroll-affordance overlay (up/down arrows, RuneSpace #345
  // pattern) sits on its visible box and never scrolls away with the
  // content. On desktop the grid inside main fits exactly, so the
  // overlay renders nothing here — the desktop panes carry their own.
  const mainRef = useRef(null);
  const affordances = useScrollAffordances(mainRef);
  return (
    <div className="h-dvh flex flex-col relative sm:max-w-2xl sm:mx-auto lg:max-w-none">
      {" "}
      <header className="shrink-0 title-bar">
        <Header />
      </header>
      <div className="relative flex-1 min-h-0">
        <main ref={mainRef} className="h-full overflow-y-auto px-1 mx-2 pb-2">
          {children}
        </main>
        <ScrollAffordanceOverlay affordances={affordances} />
      </div>
      <footer className="shrink-0 mb-2 mx-2">
        <Footer />
      </footer>
    </div>
  );
}
