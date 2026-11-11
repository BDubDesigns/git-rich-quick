/**
 * In-game email (issue #31) — the ONE module that owns the inbox.
 *
 * The inbox is a list of plain records in the game state:
 *   { id, triggerKey, sender, subject, body, createdAtMs, read }
 * Every game system that wants to send mail calls this module; no
 * component builds or mutates inbox entries directly.
 *
 * Dedup is by `triggerKey`: one email per trigger event, ever. A
 * trigger that already has an email in the inbox does not send again.
 * The inbox is capped at EMAIL_CONFIG.maxInboxEmails; past the cap the
 * oldest email is deleted when a new one arrives.
 *
 * The adapters at the bottom translate game events into mail:
 * employee visible / unlocked, open-source visible / unlocked /
 * level-up, and star rewards. Each adapter only fires on a transition
 * (a latch flip, a level increase, a claim), so the same event never
 * mails twice, and a restored save never re-mails old unlocks.
 */

import {
  EMAIL_CONFIG,
  EMPLOYEE_TYPES,
  OPEN_SOURCE_IDS,
  buildEmployeeUnlockedEmail,
  buildEmployeeVisibleEmail,
  buildOpenSourceLevelEmail,
  buildOpenSourceUnlockedEmail,
  buildOpenSourceVisibleEmail,
  buildStarRewardEmail,
  starEffectName,
  starRewardDetail,
} from "../../../shared/game-balance.js";
import {
  EMPLOYEE_CONFIGS,
  OPEN_SOURCE_PROJECTS_CONFIG,
} from "../context/gameConfig.js";
import {
  getUnlockProgress,
  getUnlockProgressForOpenSource,
  hasCrossedUnlockThreshold,
} from "../context/gameLogic.js";
import { formatCondition } from "../utils/formatCondition.js";

/** A unique id for a new email. crypto.randomUUID with a fallback. */
export function newEmailId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `email-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * Add one email to the inbox. Deduped by triggerKey: if an email with
 * that key already exists, the inbox is returned unchanged. Past the
 * cap, the oldest emails are dropped (the array is chronological).
 * Returns `{ emails, added }` where `added` is the new entry or null.
 */
export function addEmail(emails, content, triggerKey, createdAtMs) {
  const inbox = emails ?? [];
  if (inbox.some((entry) => entry.triggerKey === triggerKey)) {
    return { emails: inbox, added: null };
  }
  const entry = {
    id: newEmailId(),
    triggerKey,
    sender: content.sender,
    subject: content.subject,
    body: content.body,
    createdAtMs,
    read: false,
  };
  let next = [...inbox, entry];
  while (next.length > EMAIL_CONFIG.maxInboxEmails) {
    next = next.slice(1);
  }
  return { emails: next, added: entry };
}

/** Mark one email read. Returns the original array when nothing changed. */
export function markEmailRead(emails, emailId) {
  const inbox = emails ?? [];
  if (!inbox.some((entry) => entry.id === emailId && !entry.read)) {
    return inbox;
  }
  return inbox.map((entry) =>
    entry.id === emailId ? { ...entry, read: true } : entry
  );
}

/** How many emails are unread. */
export function unreadEmailCount(emails) {
  return (emails ?? []).reduce(
    (count, entry) => count + (entry.read ? 0 : 1),
    0
  );
}

/**
 * Human-readable unlock requirement for a teaser email, e.g.
 * "Earn 100 total lines of code" or "Hire 5 Juniors and Earn 3000
 * total lines of code". Reuses the same formatter the locked cards
 * show, so the email and the Shop never disagree.
 */
export function describeUnlockRequirements(progress) {
  return progress.map((entry) => formatCondition(entry)).join(" and ");
}

/**
 * Collect the emails a game-state transition should send.
 *
 * `prevState` / `newState` are the reducer states before and after the
 * action; `starClaim` is the claim from an APPLY_STAR_REWARD action
 * (or null). Returns `{ emails, newEmailId }` — the updated inbox and
 * the id of the newest email added (null when nothing was added).
 *
 * - Employee latch flip false -> true: unlocked email. Still locked
 *   but newly visible (10% progress): teaser email — but never both
 *   for the same employee in one transition.
 * - Open-source latch flip: unlocked email. Newly visible: teaser
 *   email. Level increase: one email per level crossed.
 * - Star claim: one email per claim, keyed by its claimId.
 */
export function collectTriggerEmails(prevState, newState, starClaim = null) {
  let emails = newState.emails ?? [];
  let newEmailId = null;
  const nowMs = Date.now();

  const send = (content, triggerKey) => {
    const result = addEmail(emails, content, triggerKey, nowMs);
    emails = result.emails;
    if (result.added) newEmailId = result.added.id;
  };

  for (const type of EMPLOYEE_TYPES) {
    const wasUnlocked = prevState.unlockedEmployees?.[type] ?? false;
    const isUnlocked = newState.unlockedEmployees?.[type] ?? false;
    const config = EMPLOYEE_CONFIGS[type];
    if (!config) continue;
    if (!wasUnlocked && isUnlocked) {
      send(
        buildEmployeeUnlockedEmail({ employeeName: config.name }),
        `employee-unlocked:${type}`
      );
    } else if (
      !isUnlocked &&
      hasCrossedUnlockThreshold("employee", type, newState)
    ) {
      send(
        buildEmployeeVisibleEmail({
          employeeName: config.name,
          requirementText: describeUnlockRequirements(
            getUnlockProgress(type, newState)
          ),
        }),
        `employee-visible:${type}`
      );
    }
  }

  for (const projectId of OPEN_SOURCE_IDS) {
    const wasUnlocked =
      prevState.unlockedOpenSourceProjects?.[projectId] ?? false;
    const isUnlocked =
      newState.unlockedOpenSourceProjects?.[projectId] ?? false;
    const config = OPEN_SOURCE_PROJECTS_CONFIG[projectId];
    if (!config) continue;
    if (!wasUnlocked && isUnlocked) {
      send(
        buildOpenSourceUnlockedEmail({ projectName: config.name }),
        `opensource-unlocked:${projectId}`
      );
    } else if (
      !isUnlocked &&
      hasCrossedUnlockThreshold("openSource", projectId, newState)
    ) {
      send(
        buildOpenSourceVisibleEmail({
          projectName: config.name,
          requirementText: describeUnlockRequirements(
            getUnlockProgressForOpenSource(projectId, newState)
          ),
        }),
        `opensource-visible:${projectId}`
      );
    }
    const prevLevel = prevState.openSourceProjects?.[projectId]?.level ?? 0;
    const newLevel = newState.openSourceProjects?.[projectId]?.level ?? 0;
    for (let level = prevLevel + 1; level <= newLevel; level += 1) {
      send(
        buildOpenSourceLevelEmail({ projectName: config.name, level }),
        `opensource-level:${projectId}:${level}`
      );
    }
  }

  if (starClaim) {
    const employeeTypeName =
      EMPLOYEE_CONFIGS[starClaim.employeeType]?.name ??
      starClaim.employeeType;
    send(
      buildStarRewardEmail({
        effectName: starEffectName(starClaim.effect, starClaim.good),
        rewardText: starRewardDetail(starClaim, employeeTypeName),
        good: starClaim.good,
      }),
      `star-reward:${starClaim.claimId}`
    );
  }

  return { emails, newEmailId };
}
