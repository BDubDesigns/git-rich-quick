/**
 * The collapsible Hire card pieces (Brandon, Nov 21: "collapse them as
 * well and just show the image, buy button, number you have, and the
 * name of the employee"), in the Night Shift card's visual language
 * (#261) so the rows line up: the shared `info-toggle-chevron` (it
 * snaps under prefers-reduced-motion), a disclosure <button> with
 * aria-expanded / aria-controls, and the same 40px minimum row height
 * inside the same `px-3 py-1.5` Panel padding.
 *
 * - CollapsedHireRow: the whole collapsed card. A disclosure button
 *   (chevron, small icon, name, one small line under it) on the left,
 *   the card's own buy button on the right, and the empty hidden
 *   detail region the disclosure controls.
 * - ExpandedHireHeader: the expanded card's disclosure. It renders the
 *   JSDoc opener and the title line the card always had, with the
 *   chevron in front, so the expanded card reads as before.
 *
 * Presentation only: the buy button and every number come from the
 * card that uses these.
 */

import { Panel } from "./Panel.jsx";
import { brandNodes } from "./BrandName.jsx";
import { hireCardToggleLabel } from "../utils/hireCards.js";

/** The disclosure button's look (the Night Shift toggle's classes). */
const TOGGLE_CLASS =
  "bg-transparent border-0 p-0 text-left text-[#cccccc] cursor-pointer rounded outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[#0078d4]";

/** The shared disclosure chevron; rotates when open. */
export function HireCardChevron({ open, className = "" }) {
  return (
    <span
      className={`info-toggle-chevron shrink-0 leading-none${open ? " info-toggle-chevron--open" : ""} ${className}`}
      aria-hidden="true"
    >
      ▸
    </span>
  );
}

export function CollapsedHireRow({
  name,
  icon,
  sub = null,
  action,
  detailId,
  onToggle,
  className = "",
}) {
  return (
    <Panel className={`px-3 py-1.5 m-0 ${className}`.trim()}>
      <div className="flex items-center gap-2 min-h-10">
        <button
          type="button"
          className={`flex flex-1 min-w-0 items-center gap-2 min-h-10 ${TOGGLE_CLASS}`}
          onClick={onToggle}
          aria-expanded={false}
          aria-controls={detailId}
          aria-label={hireCardToggleLabel(name, false)}
        >
          <HireCardChevron open={false} className="text-base" />
          {icon}
          <span className="flex min-w-0 flex-col font-mono">
            <span className="text-sm font-bold truncate">
              {brandNodes(name)}
            </span>
            {sub !== null && (
              <span className="text-xs text-gray-400 truncate">{sub}</span>
            )}
          </span>
        </button>
        {action}
      </div>
      <div id={detailId} hidden />
    </Panel>
  );
}

export function ExpandedHireHeader({ name, detailId, onToggle }) {
  return (
    <button
      type="button"
      className={`block w-full min-h-10 ${TOGGLE_CLASS}`}
      onClick={onToggle}
      aria-expanded={true}
      aria-controls={detailId}
      aria-label={hireCardToggleLabel(name, true)}
    >
      <HireCardChevron open className="mr-1" />
      <span className="comment-text">{`/** `}</span>
      <br />
      <span className="text-sm font-bold">{brandNodes(name)}</span>
    </button>
  );
}
