import { useEffect, useRef } from "react";
import { Button } from "./Button.jsx";

/**
 * The shell every Farm info popup shares (issue #238's breeding guide,
 * then Mood lighting and the Herd book, Brandon, Nov 21: "Mood lighting
 * and herd book should be popups also like how breeding works").
 *
 * It is a native <dialog> opened with showModal(), so the browser
 * gives it the dialog role, keeps focus inside it, and closes it on
 * Escape. It also closes from its Close button, its Got it button or a
 * tap on the backdrop, and focus goes back to whatever opened it. The
 * title and Close stay pinned while the content scrolls. Nothing is
 * animated, so there is nothing to turn off for reduced motion.
 *
 * The content only renders while it is open, so a closed popup costs
 * nothing and reads fresh numbers every time it opens.
 */
export function InfoDialog({ open, onClose, titleId, title, children }) {
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

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={handleBackdropClick}
      className="m-auto w-[calc(100%-1.5rem)] max-w-lg max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-0 bg-transparent text-[#cccccc] backdrop:bg-black/70"
    >
      {open && (
        <div className="panel flex flex-col gap-3 p-4 text-sm">
          {/* The title and Close stay pinned while the content scrolls,
              so a phone never has to scroll back up to close it. */}
          <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 pt-4 pb-2 flex items-center gap-2 rounded-t-2xl bg-[var(--panel-background-color)]">
            <h2 id={titleId} className="m-0 flex-1 text-base font-bold">
              {title}
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

          {children}

          <Button onClick={() => dialogRef.current?.close()}>Got it</Button>
        </div>
      )}
    </dialog>
  );
}
