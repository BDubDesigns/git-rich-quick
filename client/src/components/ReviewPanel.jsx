import { reviewQueueHeader } from "../utils/workMode.js";

/**
 * The Review panel shell (issue #267, slice 1): what the Commit area
 * shows in Manage agents mode. No agents exist yet, so the queue is
 * always empty and nothing here touches game state. Later slices fill
 * the queue with pull request cards.
 *
 * Sized close to the Clicks/sec line plus the Commit button, so
 * switching modes barely moves the layout. Copy rules: no em or en
 * dashes.
 */
export function ReviewPanel({ className = "" }) {
  return (
    <section
      aria-label="Review queue"
      data-review-panel
      className={`text-left ${className}`}
    >
      <h2 className="mb-1 text-sm font-bold leading-5 text-gray-200">
        {reviewQueueHeader(0)}
      </h2>
      <div className="whitespace-pre rounded-md border border-[#3c3c3c] bg-[#181818] px-3 py-1.5 font-mono text-xs leading-4">
        <span className="comment-text">{"/**"}</span>
        <br />
        <span className="comment-text">{" * No agents are on payroll yet."}</span>
        <br />
        <span className="comment-text">{" * "}</span>
        <span className="text-blue-400">@returns</span>
        <span className="text-cyan-300">{" {PullRequest[]}"}</span>
        <span className="text-gray-400">{" []"}</span>
        <br />
        <span className="comment-text">{" */"}</span>
      </div>
    </section>
  );
}
