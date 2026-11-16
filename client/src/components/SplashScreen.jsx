import { Button } from "./Button.jsx";
import { Panel } from "./Panel.jsx";
import duckLogo from "../img/duck_logo.png";

/**
 * SplashScreen: the first-run / new-user splash (Brandon's Canva mockup,
 * Nov 10, 2026). Title, duck mascot, terminal-style pitch, green
 * `npm start` button, PASS test panel. Client-only; it never touches the
 * save. The parent (App) shows it only when there is no existing save
 * and it has never been dismissed; `onStart` dismisses it and starts
 * the game.
 *
 * Copy is verbatim from the mockup (image 1000013534_18_rpdp.png, the
 * "Splash Page" phone). Nothing was filled in; every line was readable.
 *
 * Polish (issue #141): every content box is the shared Panel (which sets
 * the theme's primary text color, so the pitch and test lines are
 * readable instead of browser-default black on a dark panel), the
 * title bar sits on top of a Panel instead of floating alone, and the
 * `npm start` button ends in a blinking terminal cursor (no blink under
 * prefers-reduced-motion).
 *
 * @param {Object} props
 * @param {() => void} props.onStart - Dismiss the splash and start the game.
 */
export function SplashScreen({ onStart }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--main-bg-color)]">
      <div className="min-h-full flex flex-col items-center px-4 py-6 sm:max-w-2xl sm:mx-auto w-full">
        {/* Header Panel: the title bar (mockup: "// Git Rich Quick")
            anchored on top of a Panel, like every title bar in the game,
            with the duck mascot (the repo pixel-art duck, the same one
            as the Header logo) inside it. */}
        <Panel className="w-full overflow-hidden mb-4 flex flex-col items-center">
          <div className="title-bar w-full px-4 py-3 text-center">
            <span className="font-mono text-2xl font-bold">
              {"// Git Rich Quick"}
            </span>
          </div>
          <img
            src={duckLogo}
            alt="Git Rich Quick duck mascot"
            className="w-40 h-auto my-6"
          />
        </Panel>

        {/* Terminal-style pitch (mockup: `npm run game-pitch`). */}
        <Panel className="w-full font-mono text-xs overflow-hidden mb-4 p-3 whitespace-pre-wrap break-words">
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
        </Panel>

        {/* Green `npm start` button (mockup). Full width, the one action. */}
        <Button
          onClick={onStart}
          className="game-button--success w-full text-lg py-3 mb-4"
        >
          {/* One inline span, so the cursor sits on the same line as the
              text (game-button lays its children out as a column).
              Blinking terminal cursor (issue #141): decorative, so it is
              hidden from screen readers, and the blink stops under
              prefers-reduced-motion (see .terminal-cursor). */}
          <span>
            {"> npm start"}
            <span className="terminal-cursor" aria-hidden="true">
              ▊
            </span>
          </span>
        </Button>

        {/* PASS test panel (mockup: /src/game-features.test.js). */}
        <Panel className="w-full font-mono text-xs overflow-hidden p-3">
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
        </Panel>
      </div>
    </div>
  );
}
