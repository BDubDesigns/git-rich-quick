import { useRef } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { useScrollAffordances } from "../hooks/useScrollAffordances.js";
import { ScrollAffordanceOverlay } from "./ScrollAffordances.jsx";

export function GameLayout({ children }) {
  // The main box lives in a relative frame with a scroll-affordance
  // overlay (up/down arrows, RuneSpace #345 pattern) as a backstop.
  // Issue #174: main no longer scrolls the section. Every section fills
  // it and scrolls itself under its pinned title bar (SectionLayout),
  // on mobile and desktop alike, so main measures no overflow and the
  // overlay renders nothing.
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
