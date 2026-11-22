import { useGameContext } from "../context/useGameContext";
import { getBaseLocPerSecond } from "../context/gameLogic.js";
import { reviewPanelModel } from "../utils/agentFleetPanel.js";

/** Check tones to colors: green passes, red is a red flag, grey is neither. */
const TONE_CLASS = {
  good: "text-green-400",
  bad: "text-red-400",
  neutral: "text-gray-400",
};

/** The result line's colors by tone. */
const MESSAGE_CLASS = {
  good: "text-green-400",
  bad: "text-red-400",
  info: "text-gray-300",
};

/** The tech debt bar, one row: its label, the bar and "-X% production". */
export function TechDebtBar({ model }) {
  const width = `${Math.min(100, Math.max(0, model.debt))}%`;
  return (
    <div className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] leading-[14px]" data-tech-debt-bar>
      <span className={`shrink-0 font-semibold ${model.debtHigh ? "text-red-400" : "text-amber-300"}`}>
        {model.debtLabel}
      </span>
      <div
        className="h-1 min-w-6 flex-1 overflow-hidden rounded bg-[#2b2b2b]"
        role="meter"
        aria-label="Tech debt"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={model.debt}
      >
        <div
          className={model.debtHigh ? "h-1 bg-red-500" : "h-1 bg-amber-400"}
          style={{ width }}
        />
      </div>
      <span className="shrink-0 text-gray-400">{model.dragLabel}</span>
    </div>
  );
}

/** One `@tag value` line of the PR card. */
function CheckLine({ tag, line }) {
  return (
    <>
      <span className="text-blue-400">{tag}</span>{" "}
      <span className={TONE_CLASS[line.tone]}>{line.text}</span>
    </>
  );
}

/** The top PR as a JSDoc card. */
function PullRequestCard({ pr }) {
  return (
    <div
      className="rounded-md border border-[#3c3c3c] bg-[#181818] px-2.5 py-1 font-mono text-[11px] leading-[14px]"
      data-pr-card
      data-pr-number={pr.number}
    >
      <span className="comment-text">{`/** ${pr.agent} opened #${pr.number}`}</span>
      <div className="text-xs font-bold leading-4 text-gray-100 break-words">
        {pr.title}
      </div>
      <span className="text-blue-400">@returns</span>
      <span className="text-cyan-300">{" {LOC}"}</span>
      <span className="text-green-400">{` ${pr.payoutLabel}`}</span>
      <span className="text-gray-400">{`  diff ${pr.lines.diff}`}</span>
      <br />
      <CheckLine tag="@ci" line={pr.lines.ci} />
      <br />
      <CheckLine tag="@tests" line={pr.lines.tests} />
      <br />
      <CheckLine tag="@deps" line={pr.lines.deps} />
      <span className="comment-text">{" */"}</span>
    </div>
  );
}

/** The empty queue: no agents yet, or agents typing. */
function EmptyQueue({ model }) {
  const lines =
    model.agents === 0
      ? [" * No agents are on payroll yet.", " * Hire a Coding Agent on the Hire tab."]
      : model.nextPrSeconds !== null
        ? [` * ${model.agents === 1 ? "Your agent is" : "Your agents are"} typing.`, ` * Next PR in about ${model.nextPrSeconds}s.`]
        : [" * Nothing to review."];
  return (
    <div className="whitespace-pre-wrap rounded-md border border-[#3c3c3c] bg-[#181818] px-3 py-1.5 font-mono text-xs leading-4">
      <span className="comment-text">{"/**"}</span>
      <br />
      {lines.map((line) => (
        <span key={line}>
          <span className="comment-text">{line}</span>
          <br />
        </span>
      ))}
      <span className="comment-text">{" * "}</span>
      <span className="text-blue-400">@returns</span>
      <span className="text-cyan-300">{" {PullRequest[]}"}</span>
      <span className="text-gray-400">{" []"}</span>
      <br />
      <span className="comment-text">{" */"}</span>
    </div>
  );
}

/**
 * The Review panel (issue #267, slices 2 and 3): what the Commit area
 * shows in Manage agents mode. The header and queue count, the tech
 * debt bar, the top PR as a JSDoc card (agent, number, title, payout,
 * diff, and the CI, tests and deps checks), Reject and Approve, the
 * Refactor Sprint, the token bill and the last result line.
 *
 * Slop is never in the title: the diff and the three checks show it.
 * Every number comes from the shared AGENT_FLEET_CONFIG through
 * utils/agentFleetPanel.js. The panel scrolls inside itself past its
 * height cap, so the pane above keeps its room on a phone.
 *
 * Copy rules: no em or en dashes.
 */
export function ReviewPanel({ className = "", part = "all" }) {
  const { state, dispatch } = useGameContext();
  const model = reviewPanelModel(state, getBaseLocPerSecond(state));
  const message = state.agentFleetMessage;
  const pr = model.pr;
  const review = (decision) =>
    pr && dispatch({ type: "REVIEW_AGENT_PR", payload: { prNumber: pr.number, decision } });

  const queue = (
    <>
      <h2 className="text-sm font-bold leading-5 text-gray-200">{model.header}</h2>
      {model.agents > 0 && <TechDebtBar model={model} />}
      {model.statusText && (
        <p className="m-0 font-mono text-[11px] leading-4 text-amber-300" role="status">
          {model.statusText}
        </p>
      )}
      {/* The last result, above the card so it shows without scrolling;
          two lines at most (the full text is its title). */}
      {message && (
        <p
          key={message.key}
          title={message.text}
          className={`m-0 line-clamp-2 text-[11px] leading-[14px] ${MESSAGE_CLASS[message.tone] ?? MESSAGE_CLASS.info}`}
          role="status"
          aria-live="polite"
          data-review-message
        >
          {message.text}
        </p>
      )}
      {pr ? <PullRequestCard pr={pr} /> : <EmptyQueue model={model} />}
    </>
  );

  const actions = (
    <>
      {pr && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => review("reject")}
            className="h-11 rounded-lg border border-[#5a5a5a] bg-[#2d2d2d] text-sm font-semibold text-gray-100 hover:bg-[#3a3a3a]"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => review("approve")}
            className="h-11 rounded-lg bg-blue-700 text-sm font-semibold text-white hover:bg-blue-600"
          >
            Approve
          </button>
        </div>
      )}
      {model.agents > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => dispatch({ type: "REFACTOR_SPRINT" })}
            disabled={model.sprint.disabled}
            className="h-11 shrink-0 rounded-lg border border-amber-400 bg-transparent px-3 text-xs font-semibold text-amber-300 hover:bg-amber-950 disabled:cursor-not-allowed disabled:border-[#5a5a5a] disabled:text-gray-500 disabled:hover:bg-transparent"
          >
            {model.sprint.label}
          </button>
          <span className="flex min-w-0 grow basis-32 flex-col font-mono text-[11px] leading-[14px]">
            <span className="text-gray-400">
              {model.sprint.reason ?? `Debt goes to ${model.sprint.debtAfter}%.`}
            </span>
            {/* The token bill, per second, while agents work. */}
            <span className="text-amber-300">{model.billLabel}</span>
          </span>
        </div>
      )}
    </>
  );

  // Desktop splits the panel: the queue beside the Commit column, the
  // buttons in it, so the footer stays short. Mobile stacks both in one
  // section that scrolls inside its height cap.
  if (part === "queue") {
    return (
      <section aria-label="Review queue" data-review-panel className={`flex flex-col gap-1 text-left ${className}`}>
        {queue}
      </section>
    );
  }
  if (part === "actions") {
    return (
      <div role="group" aria-label="Review actions" className={`flex flex-col gap-1.5 text-left ${className}`}>
        {actions}
      </div>
    );
  }
  return (
    <section
      aria-label="Review queue"
      data-review-panel
      className={`flex max-h-52 flex-col gap-1 overflow-y-auto overscroll-contain [&>*]:shrink-0 text-left ${className}`}
    >
      {queue}
      {actions}
    </section>
  );
}
