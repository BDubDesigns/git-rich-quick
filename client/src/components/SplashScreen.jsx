import { Button } from "./Button.jsx";
import duckLogo from "../img/duck_logo.png";

/**
 * SplashScreen — the first-run / new-user splash (Brandon's Canva mockup,
 * Nov 10, 2026). Title, duck mascot, terminal-style pitch, green
 * `npm start` button, PASS test panel. Client-only; it never touches the
 * save. The parent (App) shows it only when there is no existing save
 * and it has never been dismissed; `onStart` dismisses it and starts
 * the game.
 *
 * Copy is verbatim from the mockup (image 1000013534_18_rpdp.png, the
 * "Splash Page" phone). Nothing was filled in — every line was readable.
 *
 * @param {Object} props
 * @param {() => void} props.onStart - Dismiss the splash and start the game.
 */
export function SplashScreen({ onStart }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--main-bg-color)]">
      <div className="min-h-full flex flex-col items-center px-4 py-6 sm:max-w-2xl sm:mx-auto w-full">
        {/* Title bar (mockup: "// Git Rich Quick"). */}
        <div className="title-bar w-full rounded-t-xl px-4 py-3 text-center">
          <span className="font-mono text-2xl font-bold">
            {"// Git Rich Quick"}
          </span>
        </div>

        {/* Duck mascot (repo pixel-art duck, the same one as the Header logo). */}
        <img
          src={duckLogo}
          alt="Git Rich Quick duck mascot"
          className="w-40 h-auto my-6"
        />

        {/* Terminal-style pitch (mockup: `npm run game-pitch`). */}
        <div className="w-full font-mono text-xs bg-gray-900/80 border border-gray-700 rounded-md overflow-hidden shadow-sm mb-4 p-3 whitespace-pre-wrap break-words">
          <div>
            <span className="text-gray-400">{"C:\\dev\\git-rich-quick> "}</span>
            <span className="classes-text">npm run game-pitch</span>
          </div>
          <div className="mt-2">
            {"> git-rich-quick by committing LOC and shipping projects for money"}
          </div>
          <div>
            {"> hire-more-devs with money to generate LOC for you"}
          </div>
          <div>
            {
              "> contribute-to-OSS to unlock powerful upgrades and buffs to generate LOC fast"
            }
          </div>
          <div className="mt-2">
            <span className="comment-text font-bold">YEET v42.0</span>
            <span className="text-gray-400"> ready in 1337 ms</span>
          </div>
          <div className="mt-2">
            <span className="text-gray-400">{"\u2192 Humor Style: "}</span>
            <span className="text-blue-400">Dad puns for devs</span>
          </div>
          <div>
            <span className="text-gray-400">{"\u2192 Genre: "}</span>
            <span className="text-blue-400">Click button, number go up</span>
          </div>
        </div>

        {/* Green `npm start` button (mockup). Full width, the one action. */}
        <Button
          onClick={onStart}
          className="game-button--success w-full text-lg py-3 mb-4"
        >
          {"> npm start"}
        </Button>

        {/* PASS test panel (mockup: /src/game-features.test.js). */}
        <div className="w-full font-mono text-xs bg-gray-900/80 border border-gray-700 rounded-md overflow-hidden shadow-sm p-3">
          <div className="mb-2">
            <span className="bg-green-600 text-white font-bold px-1.5 py-0.5 rounded text-[11px]">
              PASS
            </span>{" "}
            <span>/src/game-features.test.js</span>
          </div>
          <div className="mt-1">
            <span className="text-green-400">{"\u2713 "}</span>
            should execute loop; code, ship, hire, get acquired, earn clout,
            repeat
          </div>
          <div className="mt-1">
            <span className="text-green-400">{"\u2713 "}</span>
            expects excellent progression pacing
          </div>
          <div className="mt-1">
            <span className="text-green-400">{"\u2713 "}</span>
            validates meta-commentary on dev culture
          </div>
          <div className="mt-1">
            <span className="text-green-400">{"\u2713 "}</span>
            requires license remains open source, welcoming contributions
          </div>
        </div>
      </div>
    </div>
  );
}
