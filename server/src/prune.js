/**
 * Prune inactive guest saves (issue #25).
 *
 * Every guest who opens the game mints a UUID row in git_saves, and most
 * of them never come back. This job deletes guest rows whose last save is
 * older than a generous inactivity window (3 months, per Brandon's
 * decision on issue #25). It is a background job, never part of the
 * save/load path: it only ever DELETEs rows, it never reads or writes a
 * save state.
 *
 * GUARDRAIL (the whole point of the module): only GUEST rows are ever
 * pruned (`user_id IS NULL`). A row linked to a Better Auth account is
 * never touched by this job, however old it is — the window for
 * account-linked rows is still undecided (keep longer, or warn by email
 * first), so they are out of scope until Brandon decides.
 *
 * Two ways to run it:
 * - The in-process scheduler (`startPruneScheduler`, started by main()
 *   in server.js): first run one hour after boot, then once a day.
 *   No new infrastructure, no new dependency, no new cost.
 * - On demand, via POST /api/admin/prune-inactive-saves (admin token).
 *   The endpoint defaults to a dry run: it reports what WOULD be
 *   deleted and deletes nothing unless the body says
 *   `{ "dryRun": false }` explicitly. That is the safe way to verify
 *   against live data before the first real run.
 *
 * Every run writes one structured `[prune]` log line (dry-run or live,
 * cutoff, count, up to 100 sample playerIds). A failed run is logged
 * and never takes the server down.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Guest inactivity window: 3 months (Brandon's decision, issue #25). */
export const GUEST_PRUNE_INACTIVITY_DAYS = 90;
export const GUEST_PRUNE_INACTIVITY_MS =
  GUEST_PRUNE_INACTIVITY_DAYS * DAY_MS;

/** How often the scheduler runs once it is going. */
export const PRUNE_INTERVAL_MS = DAY_MS;

/** Delay before the first scheduled run after boot. */
export const PRUNE_INITIAL_DELAY_MS = 60 * 60 * 1000;

/** How many pruned playerIds a run reports (the count itself is exact). */
export const MAX_PRUNE_IDS_REPORTED = 100;

/**
 * One prune run. `store` is the save store (only its
 * `pruneInactiveGuests` method is used). Returns
 * `{ dryRun, cutoffMs, deleted, wouldDelete, playerIds }`.
 */
export async function pruneInactiveGuestSaves(
  store,
  {
    nowMs = Date.now(),
    dryRun = false,
    inactivityMs = GUEST_PRUNE_INACTIVITY_MS,
  } = {}
) {
  const cutoffMs = nowMs - inactivityMs;
  const result = await store.pruneInactiveGuests(cutoffMs, { dryRun });
  console.warn(
    "[prune]",
    JSON.stringify({
      at: new Date(nowMs).toISOString(),
      dryRun,
      cutoff: new Date(cutoffMs).toISOString(),
      ...(dryRun
        ? { wouldDelete: result.wouldDelete }
        : { deleted: result.deleted }),
      samplePlayerIds: result.playerIds,
    })
  );
  return { dryRun, cutoffMs, ...result };
}

/**
 * Schedule recurring prune runs in-process. Timers are injectable so
 * tests can drive the schedule without waiting (same pattern as the
 * client's SaveSync retry timers). Returns `{ stop() }`; the timers
 * are unref'd so the scheduler alone never keeps the process alive.
 * A run that throws is reported to `onError` and the schedule carries
 * on: a failed prune must never take down the save service.
 */
export function startPruneScheduler(
  store,
  {
    clock = Date.now,
    setTimeoutFn = setTimeout,
    setIntervalFn = setInterval,
    clearTimeoutFn = clearTimeout,
    clearIntervalFn = clearInterval,
    intervalMs = PRUNE_INTERVAL_MS,
    initialDelayMs = PRUNE_INITIAL_DELAY_MS,
    inactivityMs = GUEST_PRUNE_INACTIVITY_MS,
    dryRun = false,
    onError = (err) => console.error("[prune] scheduled run failed:", err),
  } = {}
) {
  let timeoutId;
  let intervalId;
  let stopped = false;

  function unref(timer) {
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  async function runOnce() {
    try {
      await pruneInactiveGuestSaves(store, {
        nowMs: clock(),
        dryRun,
        inactivityMs,
      });
    } catch (err) {
      onError(err);
    }
  }

  timeoutId = setTimeoutFn(async () => {
    if (stopped) return;
    await runOnce();
    if (stopped) return;
    intervalId = setIntervalFn(() => {
      void runOnce();
    }, intervalMs);
    unref(intervalId);
  }, initialDelayMs);
  unref(timeoutId);

  return {
    stop() {
      stopped = true;
      if (timeoutId !== undefined) clearTimeoutFn(timeoutId);
      if (intervalId !== undefined) clearIntervalFn(intervalId);
    },
  };
}
