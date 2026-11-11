import { useGameContext } from "../context/useGameContext.js";
import { highlightAmounts } from "../email/email.js";
import gitmailBanner from "../img/gitmail-banner.png";
import { Button } from "./Button.jsx";
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
 * Renders email text with gains green and losses red (signed amounts
 * only — see highlightAmounts). Plain segments render as-is.
 */
function EmailText({ text, className }) {
  return (
    <span className={className}>
      {highlightAmounts(text).map((segment, index) => (
        <span
          key={index}
          className={
            segment.tone === "gain"
              ? "text-green-400"
              : segment.tone === "loss"
                ? "text-red-400"
                : undefined
          }
        >
          {segment.text}
        </span>
      ))}
    </span>
  );
}

/** First non-empty line of a body — the list preview snippet. */
function emailSnippet(body) {
  return (body ?? "").split("\n").find((line) => line.trim() !== "") ?? "";
}

/**
 * In-game inbox (issue #31): a fictional mailbox in the game world,
 * not real email. Gmail-style: the list shows sender, subject (bold
 * when unread), a preview snippet, and a timestamp; unread rows stand
 * out, read rows are muted. Tapping a row OPENS the email — the detail
 * view takes over the whole tab, with Back to inbox and Delete. Opening
 * an email marks it read; opening the tab does NOT mark anything read.
 * Deleting removes the mail from the inbox (a big-action save persists
 * it) and returns to the list. The inbox is capped at 25; the oldest
 * mail is deleted automatically when a new one arrives past the cap.
 */
export function Email() {
  const { state, dispatch } = useGameContext();
  const emails = [...(state.emails ?? [])].reverse();
  const selectedEmail = emails.find(
    (entry) => entry.id === state.selectedEmailId
  );

  // Detail view: the opened email takes over the whole tab.
  if (selectedEmail) {
    return (
      <SectionLayout sectionId="email">
        <div className="panel flex flex-col gap-3 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <Button onClick={() => dispatch({ type: "CLOSE_EMAIL" })}>
              ← Back to inbox
            </Button>
            <Button
              onClick={() =>
                dispatch({
                  type: "DELETE_EMAIL",
                  payload: { emailId: selectedEmail.id },
                })
              }
            >
              Delete
            </Button>
          </div>
          <div>
            <div className="text-sm opacity-70">
              From: {selectedEmail.sender}
            </div>
            <div className="text-lg font-bold">{selectedEmail.subject}</div>
            <div className="text-xs opacity-60">
              {formatEmailAge(selectedEmail.createdAtMs, Date.now())}
            </div>
          </div>
          <EmailText
            text={selectedEmail.body}
            className="text-sm whitespace-pre-line"
          />
        </div>
      </SectionLayout>
    );
  }

  return (
    <SectionLayout sectionId="email">
      {/* GITMail banner: the in-world mail brand, at the top of the
          inbox list. The "Inbox" title and description above it keep
          the tab reading as the game's inbox. */}
      <img
        src={gitmailBanner}
        alt="GITMail"
        className="w-full h-auto rounded-xl"
      />
      {emails.length === 0 && (
        <p className="primary-text">
          No mail yet. Hire someone, unlock something, or click a golden
          star — the game world will write.
        </p>
      )}
      {emails.length > 0 && (
        <div className="panel flex flex-col gap-1">
          {emails.map((email) => (
            <button
              key={email.id}
              type="button"
              onClick={() =>
                dispatch({ type: "OPEN_EMAIL", payload: { emailId: email.id } })
              }
              className={`w-full text-left px-3 py-2 rounded hover:bg-white/5 flex items-start gap-2 ${
                email.read ? "opacity-60" : "bg-white/5"
              }`}
            >
              {/* Unread dot; read mail drops the bold. */}
              <span
                aria-label={email.read ? "read" : "unread"}
                className={`shrink-0 inline-block w-2 h-2 rounded-full mt-1.5 ${
                  email.read ? "bg-transparent" : "bg-blue-400"
                }`}
              />
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-sm ${
                      email.read ? "" : "font-bold"
                    }`}
                  >
                    {email.sender}
                  </span>
                  <span className="shrink-0 text-xs opacity-60">
                    {formatEmailAge(email.createdAtMs, Date.now())}
                  </span>
                </span>
                <span
                  className={`block truncate text-sm ${
                    email.read ? "" : "font-bold"
                  }`}
                >
                  {email.subject}
                </span>
                <EmailText
                  text={emailSnippet(email.body)}
                  className="block truncate text-xs opacity-60"
                />
              </span>
            </button>
          ))}
        </div>
      )}
    </SectionLayout>
  );
}
