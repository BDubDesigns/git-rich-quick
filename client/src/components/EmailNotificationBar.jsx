import { useRef, useState } from "react";
import { useGameContext } from "../context/useGameContext.js";

/** A horizontal swipe longer than this dismisses the bar. */
const SWIPE_DISMISS_PX = 60;

/**
 * Email notification bar (issue #31): the toast for new mail.
 *
 * When an email arrives, this bar appears above the navbar (it is
 * rendered inside the footer wrapper, absolutely positioned above it,
 * so it floats over the main content instead of shifting layout).
 * Tapping/clicking the bar body goes to the email (opens the Email tab
 * to that email). Swiping it, or tapping the X, dismisses it WITHOUT
 * going to the email — the mail stays unread in the inbox until
 * opened. The bar is suppressed while the player is already in the
 * Email tab (the badge updates instead); the reducer owns that rule.
 */
export function EmailNotificationBar() {
  const { state, dispatch } = useGameContext();
  const notification = state.emailNotification;
  const email = (state.emails ?? []).find(
    (entry) => entry.id === notification?.emailId
  );
  const [dragX, setDragX] = useState(0);
  const touchStartRef = useRef(null);
  const draggedRef = useRef(false);

  if (!notification || !email) return null;

  const handleBodyClick = () => {
    // A swipe ends in a click on some browsers; ignore clicks that
    // followed a drag, so a swipe never also navigates to the email.
    if (draggedRef.current) return;
    dispatch({ type: "OPEN_EMAIL", payload: { emailId: email.id } });
  };

  const handleDismiss = (event) => {
    event.stopPropagation();
    dispatch({ type: "DISMISS_EMAIL_NOTIFICATION" });
  };

  const handleTouchStart = (event) => {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    draggedRef.current = false;
  };

  const handleTouchMove = (event) => {
    const start = touchStartRef.current;
    if (!start) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    if (Math.abs(dx) > 10) draggedRef.current = true;
    setDragX(dx);
  };

  const handleTouchEnd = (event) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    setDragX(0);
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > SWIPE_DISMISS_PX || dy > SWIPE_DISMISS_PX) {
      dispatch({ type: "DISMISS_EMAIL_NOTIFICATION" });
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`New email from ${email.sender}: ${email.subject}. Activate to open it.`}
      onClick={handleBodyClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") handleBodyClick();
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="absolute bottom-full left-0 right-0 z-50 mb-2 cursor-pointer"
      style={{ transform: `translateX(${dragX}px)` }}
    >
      <div className="panel flex items-center gap-2 px-3 py-2">
        <span className="shrink-0 inline-block w-2 h-2 rounded-full bg-blue-400" />
        <span className="flex-1 min-w-0 truncate text-sm">
          <span className="font-bold">{email.sender}</span>
          {` — ${email.subject}`}
        </span>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={handleDismiss}
          className="shrink-0 rounded px-2 py-0.5 text-sm opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
