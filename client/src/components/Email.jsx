import { useGameContext } from "../context/useGameContext.js";
import {
  EMAIL_PREVIEW_MAX_LENGTH,
  emailDetailModel,
  emailSnippet,
  highlightAmounts,
  truncateAtWordBoundary,
  unreadEmailCount,
} from "../email/email.js";
import { brandNodes } from "./BrandName.jsx";
import gitmailBanner from "../img/gitmail-banner.png";
import { Button } from "./Button.jsx";
import { Panel } from "./Panel.jsx";
import { SectionLayout } from "./SectionLayout.jsx";

/** "5m ago", "2h ago", "3d ago" for an email's arrival time. */
function formatEmailAge(createdAtMs, nowMs) {
  // A record missing its timestamp shows no age, never "NaNd ago".
  if (!Number.isFinite(createdAtMs)) return "";
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

/**
 * An achievement mail's trophy list (issue #173): one row per trophy,
 * its name and tiers, the goal it met, and its flavor line (all from
 * the achievement definitions, via emailDetailModel). Each row is a
 * link to that trophy's card on the Achievements tab.
 */
function TrophyList({ entries, onNavigate }) {
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-1">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onNavigate(entry.target)}
            className="w-full text-left px-2 py-1.5 rounded hover:bg-white/5 flex flex-col gap-0.5"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold underline decoration-dotted underline-offset-2">
                {entry.name}
                {entry.tierText}
              </span>
              <span className="shrink-0 text-xs text-green-400">
                +{entry.buffPercent}% LOC
              </span>
            </span>
            <span className="text-xs">{entry.flavor}</span>
            <span className="text-xs opacity-60">{entry.goal}</span>
          </button>
        </li>
      ))}
    </ul>
  );
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
 *
 * Email links (issue #173): an email with a target shows a link
 * button under its body, and an achievement mail lists each trophy as
 * its own link. Following one dispatches NAVIGATE_TO_TARGET (the
 * shared mechanism in navigation/highlight.js); the destination card
 * scrolls into view and flashes. An email with no target (or a bad
 * one) renders exactly as before, with no link.
 */
export function Email() {
  const { state, dispatch } = useGameContext();
  const emails = [...(state.emails ?? [])].reverse();
  const selectedEmail = emails.find(
    (entry) => entry.id === state.selectedEmailId
  );

  const navigate = (target) =>
    dispatch({ type: "NAVIGATE_TO_TARGET", payload: { target } });

  // Detail view: the opened email takes over the whole tab.
  if (selectedEmail) {
    const detail = emailDetailModel(selectedEmail);
    return (
      <SectionLayout sectionId="email">
        <Panel className="flex flex-col gap-3 px-3 py-3">
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
              From: {brandNodes(selectedEmail.sender)}
            </div>
            <div className="text-lg font-bold">{selectedEmail.subject}</div>
            <div className="text-xs opacity-60">
              {formatEmailAge(selectedEmail.createdAtMs, Date.now())}
            </div>
          </div>
          {detail.body !== null && (
            <EmailText
              text={detail.body}
              className="text-sm whitespace-pre-line"
            />
          )}
          {detail.trophies && (
            <TrophyList entries={detail.trophies} onNavigate={navigate} />
          )}
          {detail.outro && <p className="m-0 text-sm">{detail.outro}</p>}
          {detail.link && (
            <div>
              <Button onClick={() => navigate(detail.link.target)}>
                {detail.link.label} →
              </Button>
            </div>
          )}
        </Panel>
      </SectionLayout>
    );
  }

  return (
    <SectionLayout sectionId="email">
      {/* Inbox header bar: the GITMail logo and the Mark all as read
          button share one title bar. The logo sits on the left at
          button height (h-8) so it fits the bar without stretching
          it taller; the button stays on the right and only shows
          while mail is unread. The bar uses the same px-3 py-2
          padding as the list rows so nothing is cramped against
          the edges. */}
      <Panel className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <img
            src={gitmailBanner}
            alt="GITMail"
            className="h-8 w-auto max-w-full shrink-0 object-contain"
          />
          {unreadEmailCount(state.emails) > 0 && (
            <Button
              onClick={() => dispatch({ type: "MARK_ALL_EMAILS_READ" })}
              className="shrink-0"
            >
              Mark all as read
            </Button>
          )}
        </div>
        {emails.length === 0 && (
          <p className="primary-text px-3 pb-3">
            No mail yet. Hire someone, unlock something, or click a golden
            star. The game world will write.
          </p>
        )}
        {emails.length > 0 &&
          emails.map((email) => (
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
                    {brandNodes(email.sender)}
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
                  text={truncateAtWordBoundary(
                    emailSnippet(email.body, email.subject),
                    EMAIL_PREVIEW_MAX_LENGTH
                  )}
                  className="block truncate text-xs opacity-60"
                />
              </span>
            </button>
          ))}
      </Panel>
    </SectionLayout>
  );
}
