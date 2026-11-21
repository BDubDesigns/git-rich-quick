import { useEffect, useRef } from "react";
import { Button } from "./Button.jsx";
import {
  BREEDING_GUIDE_HERD_BOOK_LINE,
  BREEDING_GUIDE_LIGHTING_INTRO,
  breedingGuideLightingRows,
  breedingGuideSections,
} from "../utils/breedingGuide.js";

/**
 * The Farm's breeding guide (issue #238): a popup that explains how a
 * kid is made, what each light does to both odds, the Mama Llama, and
 * how a new kind is discovered. Every number comes from the shared
 * balance file through utils/breedingGuide.js.
 *
 * It is a native <dialog> opened with showModal(), so the browser
 * gives it the dialog role, keeps focus inside it, and closes it on
 * Escape. It also closes from its Close button or a tap on the
 * backdrop, and focus goes back to whatever opened it. Nothing is
 * animated, so there is nothing to turn off for reduced motion.
 */
function renderSection(section) {
  return (
    <section key={section.heading} className="flex flex-col gap-1">
      <h3 className="m-0 text-sm font-semibold">{section.heading}</h3>
      {section.lines.map((line) => (
        <p key={line} className="m-0">
          {line}
        </p>
      ))}
    </section>
  );
}

export function BreedingGuide({ open, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement;
      dialog.showModal?.();
      closeRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The dialog's own close event (Escape, the Close button, the
  // backdrop) is the one place state goes back to closed.
  const handleClose = () => {
    onClose();
    const opener = returnFocusRef.current;
    returnFocusRef.current = null;
    if (opener && typeof opener.focus === "function") opener.focus();
  };

  // A tap on the backdrop lands on the <dialog> itself, never on its
  // content box, so only that closes it.
  const handleBackdropClick = (event) => {
    if (event.target === dialogRef.current) dialogRef.current.close();
  };

  const rows = breedingGuideLightingRows();
  // Making kids and New kinds first, then the lighting table (the
  // discovery choice), then the Mama Llama.
  const sections = breedingGuideSections();

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="breeding-guide-title"
      onClose={handleClose}
      onClick={handleBackdropClick}
      className="m-auto w-[calc(100%-1.5rem)] max-w-lg max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-0 bg-transparent text-[#cccccc] backdrop:bg-black/70"
    >
      {open && (
        <div className="panel flex flex-col gap-3 p-4 text-sm">
          {/* The title and Close stay pinned while the guide scrolls,
              so a phone never has to scroll back up to close it. */}
          <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 pt-4 pb-2 flex items-center gap-2 rounded-t-2xl bg-[var(--panel-background-color)]">
            <h2 id="breeding-guide-title" className="m-0 flex-1 text-base font-bold">
              How breeding works
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="shrink-0 min-w-10 h-10 px-3 rounded border border-[#5a5a5a] bg-transparent text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white"
            >
              Close
            </button>
          </div>

          {sections.slice(0, 2).map(renderSection)}

          <section className="flex flex-col gap-1">
            <h3 className="m-0 text-sm font-semibold">Lighting</h3>
            <p className="m-0">{BREEDING_GUIDE_LIGHTING_INTRO}</p>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-gray-400">
                  <th scope="col" className="text-left font-normal py-1">Light</th>
                  <th scope="col" className="text-right font-normal py-1">Kid per check</th>
                  <th scope="col" className="text-right font-normal py-1">With a Mama</th>
                  <th scope="col" className="text-right font-normal py-1">New kind</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#3a3a3a]">
                    <th scope="row" className="text-left font-normal py-1">
                      <span style={{ color: row.color }} aria-hidden="true">●</span>{" "}
                      {row.label}
                    </th>
                    <td className="text-right tabular-nums py-1">{row.kid}</td>
                    <td className="text-right tabular-nums py-1">{row.kidWithMama}</td>
                    <td className="text-right tabular-nums py-1">{row.newKind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 text-xs text-gray-400">
              New kind: the chance a kid, once born, is a kind you have not found yet.
            </p>
            <p className="m-0">{BREEDING_GUIDE_HERD_BOOK_LINE}</p>
          </section>

          {sections.slice(2).map(renderSection)}

          <Button onClick={() => dialogRef.current?.close()}>Got it</Button>
        </div>
      )}
    </dialog>
  );
}
