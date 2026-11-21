import { versionText } from "../utils/versionRoll.js";
import "./VersionRoll.css";

/**
 * The card's version text (issue #216). Rolling, it stacks the old and
 * the new version in a clipped one-line box and slides them up; at rest
 * it is just the text. Keyed by the roll's seq by the caller.
 */
export function VersionRoll({ level, roll }) {
  if (!roll) return <>{versionText(level)}</>;
  return (
    <span className="version-roll" aria-label={versionText(level)}>
      <span className="version-roll-old" aria-hidden="true">
        {versionText(roll.from)}
      </span>
      <span className="version-roll-new" aria-hidden="true">
        {versionText(level)}
      </span>
    </span>
  );
}

/** The 1px top-border sweep that runs with the roll. */
export function VersionSweep() {
  return <span className="version-sweep" aria-hidden="true" />;
}
