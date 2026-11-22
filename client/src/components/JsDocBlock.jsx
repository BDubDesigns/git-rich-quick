// Shared faux-JSDoc block (issue #18) — the `/** ... @param ... @returns ... */`
// comment style used by the project, open-source, and employee cards.
// One implementation (DRY/SSOT); every card renders its lines through it,
// so the opener, tag colors, and closer can never drift apart again.
// Normalization note: the old cards disagreed on whether `@returns` had a
// leading space before it (ProjectCard and LockedFreelanceProjectCard had
// one, the others did not). The shared line renders both tags flush-left.
import { ProgressBar } from "./ProgressBar.jsx";
import { brandNodes } from "./BrandName.jsx";
import { formatCondition } from "../utils/formatCondition.js";
import { useProgressBarEnabled } from "../hooks/useProgressBarPrefs.js";

/** The JSDoc wrapper: title line, description, then the tag lines
 *  (or any other block content) the caller passes as children.
 *  `titleAfter` (optional) is a node rendered right after the title
 *  text, inside the title line (the Open Source card's rolling version,
 *  issue #216).
 *
 *  The collapsible Hire cards pass two more (optional) props:
 *  `header` replaces the opener and title lines (the card's disclosure
 *  button renders them itself, with the chevron), and `bodyId` wraps
 *  the rest (description, tag lines, closer) in a div with that id, so
 *  the disclosure's aria-controls can point at it. Without them the
 *  block renders exactly as before. */
export function JsDocBlock({
  title,
  titleAfter = null,
  description,
  children,
  header = null,
  bodyId = null,
}) {
  const body = (
    <>
      {description ? (
        <>
          <span>{description}</span>
          <br />
        </>
      ) : null}
      {children}
      <span className="comment-text">{`*/`}</span>
    </>
  );
  return (
    <div className="text-xs font-mono">
      {header ?? (
        <>
          <span className="comment-text">{`/** `}</span>
          <br />
          <span className="text-sm font-bold">
            {brandNodes(title)}
            {titleAfter}
          </span>
          <br />
        </>
      )}
      {bodyId ? <div id={bodyId}>{body}</div> : body}
    </div>
  );
}

/** One `@tag {Type} value` line. @param lines use the default grey value;
 *  @returns lines pass valueClassName="text-green-400" (the project /
 *  open-source convention). A caller can also pass an optional suffix
 *  (e.g. a boosted amount next to the base amount) rendered in its own
 *  color via suffixClassName — the suffix is omitted entirely when null. */
export function JsDocLine({
  tag,
  type,
  value,
  valueClassName = "text-gray-400",
  suffix = null,
  suffixClassName = "",
}) {
  return (
    <>
      <span className="text-blue-400">{tag}</span>
      <span className="text-cyan-300"> {`{${type}}`}</span>
      <span className={valueClassName}> {value}</span>
      {suffix !== null ? (
        <span className={suffixClassName}>{suffix}</span>
      ) : null}
      <br />
    </>
  );
}

/** The unlock-requirement progress bars inside a locked card's JSDoc
 *  block (the "Unlock requirement:" label + one bar per condition). */
export function JsDocUnlockRequirements({ progress }) {
  // Progress bar toggles (issue #128): the "unlock" toggle.
  const showBar = useProgressBarEnabled("unlock");
  return (
    <div>
      <p className="text-xs font-semibold mb-1">Unlock requirement:</p>
      {progress.map((prog, index) => (
        <ProgressBar
          key={index}
          current={prog.current}
          target={prog.target}
          label={formatCondition(prog)}
          showBar={showBar}
        />
      ))}
    </div>
  );
}
