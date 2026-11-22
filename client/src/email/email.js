/**
 * In-game email (issue #31) — the ONE module that owns the inbox.
 *
 * The inbox is a list of plain records in the game state:
 *   { id, triggerKey, sender, subject, body, createdAtMs, read,
 *     target?, trophies? }
 * `target` (issue #173) links the email to the tab and card it
 * mentions; `trophies` lists an achievement mail's earned tiers, one
 * link each. Both are optional: an old email has neither and renders
 * no link.
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
 * level-up, freelance project visible / unlocked, star rewards, the
 * farm, Night Shift visible / unlocked, and the IPO Roadshow
 * milestones (one mail each, when its gate is met).
 * Each adapter only fires on a transition
 * (a latch flip, a level increase, a claim), so the same event never
 * mails twice, and a restored save never re-mails old unlocks.
 */

import {
  ACHIEVEMENT_EMAIL_OUTRO,
  AGENT_FLEET_TOGGLE_EMAIL_TRIGGER_KEY,
  EMAIL_CONFIG,
  EMPLOYEE_DISPLAY_NAMES,
  EMPLOYEE_TYPES,
  FREELANCE_PROJECT_DISPLAY_NAMES,
  FREELANCE_PROJECT_KEYS,
  LLAMA_BASE_TYPES,
  LLAMA_TYPE_DESCRIPTIONS,
  LLAMA_TYPE_NAMES,
  NIGHT_SHIFT_EMAIL_ITEM_ID,
  OPEN_SOURCE_DISPLAY_NAMES,
  OPEN_SOURCE_IDS,
  ROADSHOW_EMAIL_ITEM_ID,
  achievementEmailEntries,
  buildAgentFleetToggleEmail,
  buildEmployeeUnlockedEmail,
  buildEmployeeVisibleEmail,
  buildFarmNewTypeEmail,
  buildFarmPurchasedEmail,
  buildFarmUnlockedEmail,
  buildFarmVisibleEmail,
  buildFreelanceProjectUnlockedEmail,
  buildFreelanceProjectVisibleEmail,
  buildNightShiftUnlockedEmail,
  buildNightShiftVisibleEmail,
  buildOpenSourceLevelEmail,
  buildOpenSourceUnlockedEmail,
  buildOpenSourceVisibleEmail,
  buildRoadshowReadyEmail,
  buildStarRewardEmail,
  starEffectFlavor,
  findAchievement,
  nightShiftLevelOf,
  roadshowEmailTriggerKey,
  roadshowReadyMilestone,
  sanitizeEmailTarget,
  sanitizeEmailTrophies,
  starEffectName,
  starRewardDetail,
} from "../../../shared/game-balance.js";
import {
  getUnlockProgress,
  getUnlockProgressForFarm,
  getUnlockProgressForFreelanceProject,
  getUnlockProgressForNightShift,
  getUnlockProgressForOpenSource,
  hasCrossedUnlockThreshold,
  isFarmUnlockMet,
  isNightShiftUnlockMet,
} from "../utils/unlockProgress.js";
import { formatCondition } from "../utils/formatCondition.js";
import { workModeUnlocked } from "../utils/workMode.js";

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
 * A unique id for one golden star claim. The star email is keyed by it
 * (`star-reward:<claimId>`), so every claim is its own trigger event.
 * GoldenStar stamps it on each claim it rolls; resolveStarClaim stays
 * pure (tests call it with an injected rng).
 */
export function newStarClaimId() {
  return newEmailId();
}

/**
 * Add one email to the inbox. Deduped by triggerKey: if an email with
 * that key already exists, the inbox is returned unchanged. Past the
 * cap, the oldest emails are dropped (the array is chronological).
 * Returns `{ emails, added }` where `added` is the new entry or null.
 *
 * The content's optional `target` and `trophies` (issue #173) are
 * copied only when valid (the shared sanitizers), so a builder bug can
 * never store a link the server's shape check would reject. A missing
 * or bad one just means no link.
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
  const target = sanitizeEmailTarget(content.target);
  if (target) entry.target = target;
  const trophies = sanitizeEmailTrophies(content.trophies);
  if (trophies) entry.trophies = trophies;
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
 * Teaser emails are the "visible" (10% progress) mails: an employee,
 * open-source project, or freelance project the player can see but
 * has not unlocked yet. Everything else (unlocks, level-ups, star
 * rewards, farm mail) is a done deal. The notification bar uses this
 * to label teasers so they do not read as an available hire.
 */
const TEASER_TRIGGER_PREFIXES = [
  "employee-visible:",
  "opensource-visible:",
  "freelance-visible:",
  "farm-visible:",
  "night-shift-visible:",
];

export function isTeaserEmail(email) {
  const triggerKey = email?.triggerKey;
  if (typeof triggerKey !== "string") return false;
  return TEASER_TRIGGER_PREFIXES.some((prefix) =>
    triggerKey.startsWith(prefix)
  );
}

/** Max preview length for the inbox list snippet (issue #108). */
export const EMAIL_PREVIEW_MAX_LENGTH = 60;

/**
 * Truncate text at a word boundary: if it fits, return it unchanged;
 * otherwise cut to maxLength, back up to the last space, and append
 * an ellipsis. A single word longer than maxLength is cut hard (there
 * is no boundary to back up to). The ellipsis is part of the string,
 * so the visible cut always lands after a complete word instead of
 * mid-word the way the CSS `truncate` ellipsis does on its own.
 */
export function truncateAtWordBoundary(text, maxLength) {
  const value = text ?? "";
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed}…`;
}

/**
 * First non-empty line of a body, the list preview snippet. When the
 * first line starts with the subject (the teaser mails repeat it:
 * "We found a Senior Developer! They're interested..."), the subject
 * is stripped so the preview shows the body instead of repeating the
 * subject. If stripping leaves nothing, the next non-empty line is
 * used. Returns "" when the body has no usable line.
 */
export function emailSnippet(body, subject) {
  const lines = (body ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  for (const line of lines) {
    if (subject && line.startsWith(subject)) {
      const rest = line.slice(subject.length).trim();
      if (rest !== "") return rest;
      continue;
    }
    return line;
  }
  return "";
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
        buildEmployeeUnlockedEmail({ employeeName: config, employeeType: type }),
        `employee-unlocked:${type}`
      );
    } else if (
      !isUnlocked &&
      hasCrossedUnlockThreshold("employee", type, newState)
    ) {
      send(
        buildEmployeeVisibleEmail({
          employeeName: config,
          employeeType: type,
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
        buildOpenSourceUnlockedEmail({ projectName: config, projectId }),
        `opensource-unlocked:${projectId}`
      );
    } else if (
      !isUnlocked &&
      hasCrossedUnlockThreshold("openSource", projectId, newState)
    ) {
      send(
        buildOpenSourceVisibleEmail({
          projectName: config,
          projectId,
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
        buildOpenSourceLevelEmail({ projectName: config, level, projectId }),
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
        buildFreelanceProjectUnlockedEmail({ projectName: config, projectKey }),
        `freelance-unlocked:${projectKey}`
      );
    } else if (
      !isUnlocked &&
      hasCrossedUnlockThreshold("freelanceProject", projectKey, newState)
    ) {
      send(
        buildFreelanceProjectVisibleEmail({
          projectName: config,
          projectKey,
          requirementText: describeUnlockRequirements(
            getUnlockProgressForFreelanceProject(projectKey, newState)
          ),
        }),
        `freelance-visible:${projectKey}`
      );
    }
  }

  // Shooting Stars is a Cookie Chain (issue #138): its clicks never
  // mail one by one; the whole chain sends one summary when it ends
  // (SHOOTING_STARS_CHAIN_END).
  if (starClaim && starClaim.effect !== "shootingStars") {
    const employeeTypeName =
      EMPLOYEE_DISPLAY_NAMES[starClaim.employeeType] ??
      starClaim.employeeType;
    send(
      buildStarRewardEmail({
        effectName: starEffectName(starClaim.effect, starClaim.good),
        rewardText: starRewardDetail(starClaim, employeeTypeName),
        good: starClaim.good,
        // Hype Train, AGI and their crashes tell their own story (#157).
        flavor: starEffectFlavor(starClaim.effect, starClaim.good),
      }),
      // A claim without an id still gets its own key: each claim is a
      // separate trigger event, never deduped against an older one.
      `star-reward:${starClaim.claimId ?? newStarClaimId()}`
    );
  }

  // Llama farm unlock (10 Senior Developers): a teaser when the goal
  // first becomes visible (the first Senior), and an unlock mail when
  // the requirement is met. Both fire only on a transition, so a
  // restored save never re-mails, and neither fires once the barn is
  // already owned.
  if (!(newState.farm?.owned ?? false)) {
    const farmWasUnlocked = isFarmUnlockMet(prevState);
    const farmIsUnlocked = isFarmUnlockMet(newState);
    if (!farmWasUnlocked && farmIsUnlocked) {
      send(buildFarmUnlockedEmail(), "farm-unlocked:barn");
    } else if (
      !farmIsUnlocked &&
      !hasCrossedUnlockThreshold("farm", null, prevState) &&
      hasCrossedUnlockThreshold("farm", null, newState)
    ) {
      send(
        buildFarmVisibleEmail({
          requirementText: describeUnlockRequirements(
            getUnlockProgressForFarm(newState)
          ),
        }),
        "farm-visible:barn"
      );
    }
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

  // Night Shift discovery (issue #195): the farm's rules, on the
  // level 1 gate. A teaser when the gate first becomes visible (10% of
  // it: the first Junior, or 10 passive LOC/s), and an unlock mail when
  // it is met. Both fire only on a transition, so a restored save
  // (already past the gate) never mails, and neither fires once a shift
  // is hired (level 1 or more, the Night Shift Contract included). A
  // sale resets the level and the gate, and the fixed trigger keys
  // dedupe against the inbox, so a later company re-mails only once the
  // old mail has aged out of it, exactly like the farm's.
  if (nightShiftLevelOf(newState.nightShiftLevel) === 0) {
    const shiftWasUnlocked = isNightShiftUnlockMet(prevState);
    const shiftIsUnlocked = isNightShiftUnlockMet(newState);
    if (!shiftWasUnlocked && shiftIsUnlocked) {
      send(buildNightShiftUnlockedEmail(), "night-shift-unlocked:1");
    } else if (
      !shiftIsUnlocked &&
      !hasCrossedUnlockThreshold("nightShift", null, prevState) &&
      hasCrossedUnlockThreshold("nightShift", null, newState)
    ) {
      send(
        buildNightShiftVisibleEmail({
          requirementText: describeUnlockRequirements(
            getUnlockProgressForNightShift(newState)
          ),
        }),
        "night-shift-visible:1"
      );
    }
  }

  // IPO Roadshow (issue #266): one mail per milestone, when it is the
  // next one and its run LOC gate is met (no cash check: a heads-up,
  // not a receipt). Keyed by milestone and deduped against the inbox,
  // so every tick that finds it ready sends nothing new. It is not a
  // strict transition on purpose: a milestone is bought through the
  // server (a restore, which never mails), so the next milestone can be
  // ready the moment the purchase lands, and a save that loads at
  // Series C with the gate already met (an existing player) still gets
  // its first mail on the next tick.
  const readyMilestone = roadshowReadyMilestone(newState);
  if (readyMilestone > 0) {
    const mail = buildRoadshowReadyEmail(readyMilestone);
    if (mail) send(mail, roadshowEmailTriggerKey(readyMilestone));
  }

  return { emails, newEmailId };
}

/**
 * Agent Fleet, slice 1 (issue #267): the Write code / Manage agents
 * toggle's announcement. Added only at Series A or later, and deduped
 * by its fixed trigger key like every one-time mail. Returns addEmail's
 * `{ emails, added }`. The caller (the Footer, through the reducer)
 * asks once per device; see utils/workMode.js.
 */
export function addAgentFleetToggleEmail(emails, storeRanks, nowMs) {
  if (!workModeUnlocked(storeRanks)) {
    return { emails: emails ?? [], added: null };
  }
  return addEmail(
    emails,
    buildAgentFleetToggleEmail(),
    AGENT_FLEET_TOGGLE_EMAIL_TRIGGER_KEY,
    nowMs
  );
}

/** ===== Email links (issue #173): what the detail view renders ===== */

/** The display name of the item a target names, from the shared maps. */
function targetItemName(target) {
  switch (target.tab) {
    case "shop":
      return EMPLOYEE_DISPLAY_NAMES[target.itemId] ?? null;
    case "projects":
      return FREELANCE_PROJECT_DISPLAY_NAMES[target.itemId] ?? null;
    case "openSource":
      return OPEN_SOURCE_DISPLAY_NAMES[target.itemId] ?? null;
    case "achievements":
      return findAchievement(target.itemId)?.name ?? null;
    default:
      return null;
  }
}

/**
 * The link button text for an email's target. A teaser (the "visible"
 * mail) lands on the item's unlock progress, so it says so; an unlock
 * or level-up is a call to action (hire it, ship it, contribute).
 * Names come from the shared display maps, never from the email text.
 */
export function emailLinkLabel(email, target) {
  const name = targetItemName(target);
  const teaser = isTeaserEmail(email);
  switch (target.tab) {
    case "shop":
      // The Night Shift card (issue #195): the card's own button text.
      if (target.itemId === NIGHT_SHIFT_EMAIL_ITEM_ID) {
        return teaser
          ? "See the Night Shift requirements"
          : "Hire the night shift";
      }
      if (!name) return "Go to Hire";
      return teaser ? `See the ${name} unlock progress` : `Hire a ${name}`;
    case "projects":
      if (!name) return "Go to Projects";
      return teaser ? `See the ${name} unlock progress` : `Ship ${name}`;
    case "openSource":
      if (!name) return "Go to Open Source";
      return teaser
        ? `See the ${name} unlock progress`
        : `Contribute to ${name}`;
    case "farm":
      return teaser ? "See the Farm unlock progress" : "Go to the Farm";
    case "achievements":
      return name ? `See ${name} in the Trophy Case` : "Go to Trophies";
    case "settings":
      // The IPO Roadshow card (issue #266), under Sell the Company.
      return target.itemId === ROADSHOW_EMAIL_ITEM_ID
        ? "Open the IPO Roadshow"
        : "Go to Settings";
    default:
      return "Go there";
  }
}

/**
 * Everything the email detail view renders, from one email record:
 *   { body, trophies, outro, link }
 * - body: the body text to show (null for an achievement mail with a
 *   valid trophy list, which renders the list instead).
 * - trophies: achievementEmailEntries (one linked entry per trophy,
 *   names and flavor from the definitions), or null.
 * - outro: the shared closing line under the trophy list, or null.
 * - link: { target, label } for the email's own link, or null when the
 *   email has no target (an old email), a malformed one, or a trophy
 *   list (each trophy is its own link there).
 * Missing fields read as empty; this never throws on a partial record.
 */
export function emailDetailModel(email) {
  const record = email && typeof email === "object" ? email : {};
  const body = typeof record.body === "string" ? record.body : "";
  const entries = achievementEmailEntries(record.trophies);
  if (entries.length > 0) {
    return {
      body: null,
      trophies: entries,
      outro: ACHIEVEMENT_EMAIL_OUTRO,
      link: null,
    };
  }
  const target = sanitizeEmailTarget(record.target);
  return {
    body,
    trophies: null,
    outro: null,
    link: target ? { target, label: emailLinkLabel(record, target) } : null,
  };
}
