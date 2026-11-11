// Shared faux-JSDoc block (issue #18) — the `/** ... @param ... @returns ... */`
// comment style used by the project, open-source, and employee cards.
// One implementation (DRY/SSOT); every card renders its lines through it,
// so the opener, tag colors, and closer can never drift apart again.
// Normalization note: the old cards disagreed on whether `@returns` had a
// leading space before it (ProjectCard and LockedFreelanceProjectCard had
// one, the others did not). The shared line renders both tags flush-left.
import { ProgressBar } from "./ProgressBar.jsx";
import { formatCondition } from "../utils/formatCondition.js";

/** The JSDoc wrapper: title line, description, then the tag lines
 *  (or any other block content) the caller passes as children. */
export function JsDocBlock({ title, description, children }) {
  return (
    <div className="text-xs font-mono">
      <span className="comment-text">{`/** `}</span>
      <br />
      <span className="text-sm font-bold">{title}</span>
      <br />
      {description ? (
        <>
          <span>{description}</span>
          <br />
        </>
      ) : null}
      {children}
      <span className="comment-text">{`*/`}</span>
    </div>
  );
}

/** One `@tag {Type} value` line. @param lines use the default grey value;
 *  @returns lines pass valueClassName="text-green-400" (the project /
 *  open-source convention). */
export function JsDocLine({
  tag,
  type,
  value,
  valueClassName = "text-gray-400",
}) {
  return (
    <>
      <span className="text-blue-400">{tag}</span>
      <span className="text-cyan-300"> {`{${type}}`}</span>
      <span className={valueClassName}> {value}</span>
      <br />
    </>
  );
}

/** The unlock-requirement progress bars inside a locked card's JSDoc
 *  block (the "Unlock requirement:" label + one bar per condition). */
export function JsDocUnlockRequirements({ progress }) {
  return (
    <div>
      <p className="text-xs font-semibold mb-1">Unlock requirement:</p>
      {progress.map((prog, index) => (
        <ProgressBar
          key={index}
          current={prog.current}
          target={prog.target}
          label={formatCondition(prog)}
        />
      ))}
    </div>
  );
}
