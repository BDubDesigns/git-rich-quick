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
 * level-up, freelance project visible / unlocked, and star rewards.
 * Each adapter only fires on a transition
 * (a latch flip, a level increase, a claim), so the same event never
 * mails twice, and a restored save never re-mails old unlocks.
 */

import {
  EMAIL_CONFIG,
  EMPLOYEE_DISPLAY_NAMES,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_DISPLAY_NAMES,
  FREELANCE_PROJECT_KEYS,
  LLAMA_BASE_TYPES,
  LLAMA_TYPE_DESCRIPTIONS,
  LLAMA_TYPE_NAMES,
  OPEN_SOURCE_DISPLAY_NAMES,
  OPEN_SOURCE_IDS,
  buildEmployeeUnlockedEmail,
  buildEmployeeVisibleEmail,
  buildFarmNewTypeEmail,
  buildFarmPurchasedEmail,
  buildFreelanceProjectUnlockedEmail,
  buildFreelanceProjectVisibleEmail,
  buildOpenSourceLevelEmail,
  buildOpenSourceUnlockedEmail,
  buildOpenSourceVisibleEmail,
  buildStarRewardEmail,
  starEffectName,
  starRewardDetail,
} from "../../../shared/game-balance.js";
import {
  getUnlockProgress,
  getUnlockProgressForFreelanceProject,
  getUnlockProgressForOpenSource,
  hasCrossedUnlockThreshold,
} from "../utils/unlockProgress.js";
import { formatCondition } from "../utils/formatCondition.js";

// NOTE: this module deliberately imports only shared/game-balance.js and
// pure client utils (unlockProgress, formatCondition) — never the display
// config (gameConfig.js) or gameLogic.js, which pull in react-icons. The
// save server's test environment installs only the server workspace, so
// server tests that import this module must stay free of npm packages.

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

/**
 * Mark every email read. Returns the original array when nothing is
 * unread, so a no-op tap changes no state (and triggers no save).
 */
export function markAllEmailsRead(emails) {
  const inbox = emails ?? [];
  if (!inbox.some((entry) => !entry.read)) {
    return inbox;
  }
  return inbox.map((entry) =>
    entry.read ? entry : { ...entry, read: true }
  );
}

/**
 * Delete one email from the inbox. Returns the original array when the
 * id is not in the inbox. The caller (reducer) triggers a save — a
 * delete is a big action, so the save sync picks it up the same way it
 * picks up a new email arriving (see bigActionIncreased).
 */
export function deleteEmail(emails, emailId) {
  const inbox = emails ?? [];
  if (!inbox.some((entry) => entry.id === emailId)) {
    return inbox;
  }
  return inbox.filter((entry) => entry.id !== emailId);
}

/**
 * Signed amounts in an email body ("+11.21K LOC", "-$10.54"), split
 * into segments so the renderer can color gains green and losses red.
 *
 * Returns `[{ text, tone }]` where tone is "gain", "loss", or null
 * (plain text). Only a SIGNED amount with a unit is colored: the "$"
 * (money), a suffix (K/M/B/...), or " LOC". A bare signed number with
 * no unit ("level +5") is left plain. The shared reward string
 * (starRewardDetail) is NOT changed — the coloring happens here, at
 * the email render layer, so the floating text stays uncolored.
 *
 * Multipliers ("0.5x", "2x", "7x") are colored the same way, by
 * value: above 1x is a buff (green), below 1x a debuff (red), exactly
 * 1x plain. The pattern needs digits before the "x", so "x7" (x first)
 * and "v5.0" never match, and unlock text ("Hire 5 Juniors") has no
 * "Nx" token to match.
 */
const AMOUNT_PATTERN =
  /([+-])(\$?[\d,]+(?:\.\d+)?(?:K|M|B|T|Qa|Qi|Sx|Sp|Oc|No|Dc)?)(\s?LOC)?/g;
const MULTIPLIER_PATTERN = /\b(\d+(?:\.\d+)?)x(?![A-Za-z])/g;

export function highlightAmounts(text) {
  const matches = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const [full, sign, amount, loc] = match;
    const hasUnit =
      amount.includes("$") ||
      /(?:K|M|B|T|Qa|Qi|Sx|Sp|Oc|No|Dc)$/.test(amount) ||
      loc;
    if (!hasUnit) continue;
    matches.push({
      index: match.index,
      length: full.length,
      text: full,
      tone: sign === "+" ? "gain" : "loss",
    });
  }
  for (const match of text.matchAll(MULTIPLIER_PATTERN)) {
    const value = parseFloat(match[1]);
    if (value === 1) continue;
    matches.push({
      index: match.index,
      length: match[0].length,
      text: match[0],
      tone: value > 1 ? "gain" : "loss",
    });
  }
  matches.sort((a, b) => a.index - b.index);
  const segments = [];
  let lastIndex = 0;
  for (const m of matches) {
    if (m.index < lastIndex) continue; // Overlaps an earlier match.
    if (m.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, m.index), tone: null });
    }
    segments.push({ text: m.text, tone: m.tone });
    lastIndex = m.index + m.length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), tone: null });
  }
  return segments;
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
 * - Freelance project latch flip: unlocked email. Newly visible:
 *   teaser email. Same latch/visibility rules as employees and
 *   open-source (issue #19).
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
    const config = EMPLOYEE_DISPLAY_NAMES[type];
    if (!config) continue;
    if (!wasUnlocked && isUnlocked) {
      send(
        buildEmployeeUnlockedEmail({ employeeName: config }),
        `employee-unlocked:${type}`
      );
    } else if (
      !isUnlocked &&
      hasCrossedUnlockThreshold("employee", type, newState)
    ) {
      send(
        buildEmployeeVisibleEmail({
          employeeName: config,
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
    const config = OPEN_SOURCE_DISPLAY_NAMES[projectId];
    if (!config) continue;
    if (!wasUnlocked && isUnlocked) {
      send(
        buildOpenSourceUnlockedEmail({ projectName: config }),
        `opensource-unlocked:${projectId}`
      );
    } else if (
      !isUnlocked &&
      hasCrossedUnlockThreshold("openSource", projectId, newState)
    ) {
      send(
        buildOpenSourceVisibleEmail({
          projectName: config,
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
        buildOpenSourceLevelEmail({ projectName: config, level }),
        `opensource-level:${projectId}:${level}`
      );
    }
  }

  for (const projectKey of FREELANCE_PROJECT_KEYS) {
    const wasUnlocked =
      prevState.unlockedFreelanceProjects?.[projectKey] ?? false;
    const isUnlocked =
      newState.unlockedFreelanceProjects?.[projectKey] ?? false;
    const config = FREELANCE_PROJECT_DISPLAY_NAMES[projectKey];
    if (!config) continue;
    if (!wasUnlocked && isUnlocked) {
      send(
        buildFreelanceProjectUnlockedEmail({ projectName: config }),
        `freelance-unlocked:${projectKey}`
      );
    } else if (
      !isUnlocked &&
      hasCrossedUnlockThreshold("freelanceProject", projectKey, newState)
    ) {
      send(
        buildFreelanceProjectVisibleEmail({
          projectName: config,
          requirementText: describeUnlockRequirements(
            getUnlockProgressForFreelanceProject(projectKey, newState)
          ),
        }),
        `freelance-visible:${projectKey}`
      );
    }
  }

  if (starClaim) {
    const employeeTypeName =
      EMPLOYEE_DISPLAY_NAMES[starClaim.employeeType] ??
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

  // Llama farm (issue #79): buying the farm mails once, and each
  // brand-new type discovered by breeding mails once. Both fire on a
  // transition (owned false -> true, a type joining the unlocked list),
  // so a restored save never re-mails old purchases or discoveries.
  const wasFarmOwned = prevState.farm?.owned ?? false;
  const isFarmOwned = newState.farm?.owned ?? false;
  if (!wasFarmOwned && isFarmOwned) {
    send(buildFarmPurchasedEmail(), "farm-purchased");
  }
  const prevTypes = prevState.farm?.unlockedTypes ?? [];
  const newTypes = newState.farm?.unlockedTypes ?? [];
  for (const type of newTypes) {
    if (prevTypes.includes(type)) continue;
    // The base types are bought llamas, not a discovery — buying one
    // is a routine purchase, not a new type, so they never get a
    // new-type email of their own. Only bred types get one.
    if (LLAMA_BASE_TYPES.includes(type)) continue;
    send(
      buildFarmNewTypeEmail({
        typeName: LLAMA_TYPE_NAMES[type] ?? type,
        typeDescription: LLAMA_TYPE_DESCRIPTIONS[type] ?? "",
      }),
      `farm-new-type:${type}`
    );
  }

  return { emails, newEmailId };
}
