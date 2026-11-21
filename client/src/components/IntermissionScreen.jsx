/**
 * The store-only intermission screen (issue #188).
 *
 * While the post-sale intermission is open, App renders this instead of
 * the game: the title bar and the permanent store (with its Start the
 * next company action), and nothing else. No stats, no star bars, no
 * nav tabs, no Commit Code button, no game panels. The reducer is inert
 * meanwhile (context/intermissionGate.js), and the store is the shared
 * PermanentStore, so every content box is the shared Panel.
 */
import { PermanentStore } from "./PermanentStore.jsx";
import smallLogo from "../img/duck_logo_small.png";

export function IntermissionScreen() {
  return (
    <div className="h-dvh flex flex-col sm:max-w-2xl sm:mx-auto">
      <header className="shrink-0 title-bar">
        <div className="flex items-center justify-center gap-3 py-2">
          <img
            src={smallLogo}
            alt="Git Rich Quick Logo"
            className="w-10 h-10"
          />
          <h1 className="m-0 text-2xl font-bold">Git Rich Quick</h1>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto px-1 mx-2 pb-2">
        <PermanentStore />
      </main>
    </div>
  );
}
