import { useGameContext } from "../context/useGameContext.js";
import { SectionLayout } from "./SectionLayout.jsx";

/** "5m ago", "2h ago", "3d ago" for an email's arrival time. */
function formatEmailAge(createdAtMs, nowMs) {
  const seconds = Math.max(0, Math.floor((nowMs - createdAtMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * In-game inbox (issue #31): a fictional mailbox in the game world,
 * not real email. The list is newest first. Clicking a row opens it
 * (and marks it read); clicking the open row collapses it back to the
 * list. Opening the tab does NOT mark anything read — only opening an
 * email does. The inbox is capped at 25; the oldest mail is deleted
 * automatically when a new one arrives past the cap.
 */
export function Email() {
  const { state, dispatch } = useGameContext();
  const emails = [...(state.emails ?? [])].reverse();
  const selectedEmailId = state.selectedEmailId;

  const handleRowClick = (emailId) => {
    if (selectedEmailId === emailId) {
      dispatch({ type: "CLOSE_EMAIL" });
    } else {
      dispatch({ type: "OPEN_EMAIL", payload: { emailId } });
    }
  };

  return (
    <SectionLayout sectionId="email">
      {emails.length === 0 && (
        <p className="primary-text">
          No mail yet. Hire someone, unlock something, or click a golden
          star — the game world will write.
        </p>
      )}
      {emails.length > 0 && (
        <div className="panel flex flex-col gap-1">
          {emails.map((email) => {
            const isOpen = selectedEmailId === email.id;
            return (
              <div key={email.id}>
                <button
                  type="button"
                  onClick={() => handleRowClick(email.id)}
                  className="w-full text-left px-2 py-1 rounded hover:bg-white/5 flex items-center gap-2"
                >
                  {/* Unread dot; read mail drops the bold. */}
                  <span
                    aria-label={email.read ? "read" : "unread"}
                    className={`shrink-0 inline-block w-2 h-2 rounded-full ${
                      email.read ? "bg-transparent" : "bg-blue-400"
                    }`}
                  />
                  <span
                    className={`flex-1 min-w-0 ${email.read ? "" : "font-bold"}`}
                  >
                    <span className="block truncate text-sm">
                      {email.sender} — {email.subject}
                    </span>
                    <span className="block text-xs opacity-60">
                      {formatEmailAge(email.createdAtMs, Date.now())}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="px-2 pb-2 pt-1 text-sm whitespace-pre-line">
                    {email.body}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionLayout>
  );
}
