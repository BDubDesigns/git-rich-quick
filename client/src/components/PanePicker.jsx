import { useEffect, useRef, useState } from "react";
import { NAV_TABS } from "../context/gameConfig.js";
import { useGameContext } from "../context/useGameContext.js";
import { pickerRowState } from "../navigation/panes.js";

/** "left" -> "left pane" for accessible names; tags use the bare word. */
const PANE_WORD = { left: "left", center: "center", right: "right" };

/**
 * The pane picker (issue #174, desktop only): a listbox dropdown under
 * a pane's title button with the seven sections in nav order, by their
 * nav icon and label. This pane's own section is checked ("Here");
 * a section open in another pane is dimmed and tagged "Open (right)",
 * and choosing it SWAPS the two panes (the tag reads "Swap" on hover
 * or focus, so it is never a surprise); a section on screen nowhere
 * just replaces this pane's. Closes on choose, Escape (focus returns
 * to the title button) or a click outside.
 */
export function PanePicker({ pane, onClose, returnFocusRef }) {
  const { state, dispatch } = useGameContext();
  const listRef = useRef(null);
  const rows = NAV_TABS.map((tab) => ({ ...tab, ...pickerRowState(state, pane, tab.id) }));
  const [focusIndex, setFocusIndex] = useState(() =>
    Math.max(0, rows.findIndex((row) => row.kind === "here"))
  );

  const close = (restoreFocus) => {
    onClose();
    if (restoreFocus) returnFocusRef?.current?.focus?.();
  };

  const choose = (row) => {
    if (row.kind === "here") {
      close(true);
      return;
    }
    dispatch({ type: "CHOOSE_PANE_SECTION", payload: { pane, sectionId: row.id } });
    onClose();
    // The pane now shows a new section (it remounts), so focus goes to
    // that pane's new title button once it is on the page.
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-pane="${pane}"] .pane-title-button`)
        ?.focus();
    });
  };

  // Focus the highlighted row; close on a click outside.
  useEffect(() => {
    listRef.current?.querySelectorAll('[role="option"]')[focusIndex]?.focus();
  }, [focusIndex]);
  useEffect(() => {
    const onDown = (event) => {
      const inside =
        listRef.current?.contains(event.target) ||
        returnFocusRef?.current?.contains?.(event.target);
      if (!inside) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose, returnFocusRef]);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusIndex((i) => (i + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusIndex((i) => (i - 1 + rows.length) % rows.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocusIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setFocusIndex(rows.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(rows[focusIndex]);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label={`Choose what this ${PANE_WORD[pane]} pane shows`}
      onKeyDown={onKeyDown}
      className="pane-picker absolute left-0 top-full z-30 m-0 mt-1 p-1 list-none w-64 max-w-full bg-[#252526] border border-[#454545] rounded-md shadow-lg text-sm text-[#cccccc]"
    >
      {rows.map((row, index) => {
        const IconComponent = row.Icon;
        const label =
          row.kind === "here"
            ? `${row.label}, shown in this pane`
            : row.kind === "open"
              ? `${row.label}, open in ${PANE_WORD[row.pane]} pane, swap`
              : row.label;
        return (
          <li
            key={row.id}
            role="option"
            tabIndex={index === focusIndex ? 0 : -1}
            aria-selected={row.kind === "here"}
            aria-label={label}
            data-row-kind={row.kind}
            onClick={() => choose(row)}
            onMouseEnter={() => setFocusIndex(index)}
            className={`pane-picker-row flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer outline-none hover:bg-[#04395e] focus:bg-[#04395e] ${
              row.kind === "open" ? "text-[#858585]" : ""
            }`}
          >
            <span className="w-5 h-5 flex items-center justify-center shrink-0">
              {row.imageSrc ? (
                <img src={row.imageSrc} alt="" className="w-5 h-5 object-contain" />
              ) : (
                <IconComponent size={16} />
              )}
            </span>
            <span className="flex-1">{row.label}</span>
            {row.kind === "here" && (
              <span className="text-xs text-[#c5c53f]">Here ✓</span>
            )}
            {row.kind === "open" && (
              <span className="pane-picker-tag text-xs">
                <span className="pane-picker-tag-open">Open ({PANE_WORD[row.pane]})</span>
                <span className="pane-picker-tag-swap">Swap</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
