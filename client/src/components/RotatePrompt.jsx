/**
 * The phone portrait lock (issue #194): a full-screen prompt that covers
 * the game when a phone is in landscape, instead of the broken layout.
 *
 * Pure CSS: the overlay is display none, and index.css shows it under
 * the phone-landscape media query (PHONE_LANDSCAPE_QUERY in
 * utils/starViewport.js, kept identical by a test). No Screen
 * Orientation API: locking needs fullscreen and is unreliable across
 * browsers. Rendered once at the root, so it covers the splash, the
 * game and the store alike; rotating back hides it and play resumes.
 *
 * Not a content box (a full-screen overlay), so not a Panel; it uses
 * the game's colors and logo. Copy rules: no em or en dashes.
 */
import smallLogo from "../img/duck_logo_small.png";

export function RotatePrompt() {
  return (
    <div className="rotate-prompt" role="alert" aria-live="assertive">
      <img src={smallLogo} alt="" className="w-16 h-16" />
      <h2 className="m-0 text-xl font-bold text-[#cccccc]">
        Rotate to portrait
      </h2>
      <p className="m-0 text-sm text-[#cccccc]">
        Git Rich Quick only ships in portrait. Landscape support is in the
        backlog, right under &quot;write tests&quot;.
      </p>
      <p className="m-0 text-sm text-[#c5c53f]">
        Turn your phone upright and your commits pick up where you left off.
      </p>
    </div>
  );
}
