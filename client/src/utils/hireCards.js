/**
 * Which Hire tab cards are open (Brandon, Nov 21, after the collapsible
 * Night Shift card: "I wish we could do that with all the employees
 * too, collapse them as well and just show the image, buy button,
 * number you have, and the name of the employee. And maybe a collapse
 * all toggle as well would be great.").
 *
 * ONE store for every collapsible card on the Hire tab: each employee
 * card (by employee type) and the Night Shift card (by its email item
 * id, "nightShift"), so the Collapse all / Expand all control and the
 * cards can never disagree.
 *
 * - A device preference, never the save. Employee cards share one
 *   localStorage key, `grq:hireCardsOpen`, a JSON object mapping
 *   employee type to true (open) or false (collapsed). The Night Shift
 *   card keeps its own key from #261 (`grq:nightShiftOpen`, through
 *   utils/nightShiftCard.js), so its remembered choice carries over.
 * - Collapsed is the default: a type with nothing stored is collapsed,
 *   so a player who never taps a chevron sees one compact row per card.
 * - An email link opens its card for the session (openForSession)
 *   without changing the remembered choice, like #261. A chevron tap
 *   (setOpen) or Collapse all / Expand all (setAllOpen) is remembered,
 *   and drops that session open.
 * - Blocked, junk or throwing storage never breaks a card: reads fall
 *   back to collapsed and the in-memory state still works.
 *
 * Framework-free (no React) so the server tests can exercise it with a
 * fake storage; the React hooks are hooks/useHireCards.js.
 * Copy rules: no em or en dashes.
 */

import { NIGHT_SHIFT_EMAIL_ITEM_ID } from "../../../shared/game-balance.js";
import { readNightShiftOpen, writeNightShiftOpen } from "./nightShiftCard.js";

/** localStorage key for the employee cards' open/closed choices. */
export const HIRE_CARDS_OPEN_KEY = "grq:hireCardsOpen";

/** The Night Shift card's id in the store: its email link item id. */
export const NIGHT_SHIFT_CARD_ID = NIGHT_SHIFT_EMAIL_ITEM_ID;

function defaultStorage() {
  try {
    if (
      typeof globalThis.localStorage !== "undefined" &&
      globalThis.localStorage &&
      typeof globalThis.localStorage.getItem === "function"
    ) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage blocked (private mode): fall through to no storage.
  }
  return null;
}

/** The stored employee choices: only boolean entries survive. Missing,
 *  junk or blocked storage reads {} (every card collapsed). */
export function readHireCardsOpen(storage = defaultStorage()) {
  let parsed = null;
  try {
    parsed = storage ? JSON.parse(storage.getItem(HIRE_CARDS_OPEN_KEY)) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const open = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (typeof value === "boolean") open[id] = value;
  }
  return open;
}

/** Remember the employee choices. A throwing storage is ignored. */
export function writeHireCardsOpen(open, storage = defaultStorage()) {
  try {
    storage?.setItem(HIRE_CARDS_OPEN_KEY, JSON.stringify(open));
  } catch {
    // Quota or private mode: keep the in-memory state only.
  }
}

/** Whether a card is open in a store snapshot. */
export function isHireCardOpen(snapshot, cardId) {
  return Boolean(snapshot) && snapshot[cardId] === true;
}

/** Whether any of these cards is open (the bulk control's state). */
export function anyHireCardOpen(snapshot, cardIds) {
  return cardIds.some((id) => isHireCardOpen(snapshot, id));
}

/** A card disclosure's accessible name: "Show Intern details" /
 *  "Hide Intern details" (the Night Shift toggle's wording). */
export function hireCardToggleLabel(name, open) {
  return `${open ? "Hide" : "Show"} ${name} details`;
}

/** The bulk control's label: what a tap will do. */
export function collapseAllLabel(anyOpen) {
  return anyOpen ? "Collapse all" : "Expand all";
}

/**
 * A store over one storage. The app uses the shared hireCardsStore
 * below; tests make their own with a fake storage.
 */
export function createHireCardsStore(storage = defaultStorage()) {
  // Remembered choices, loaded on first read.
  let saved = null;
  // Link opens for this session only (never written).
  let session = {};
  let snapshot = null;
  const listeners = new Set();

  const load = () => {
    if (saved === null) {
      saved = {
        ...readHireCardsOpen(storage),
        [NIGHT_SHIFT_CARD_ID]: readNightShiftOpen(storage),
      };
    }
  };

  const emit = () => {
    snapshot = null;
    for (const listener of [...listeners]) listener();
  };

  const persist = (changedIds) => {
    const employees = {};
    for (const [id, value] of Object.entries(saved)) {
      if (id !== NIGHT_SHIFT_CARD_ID) employees[id] = value;
    }
    if (changedIds.some((id) => id !== NIGHT_SHIFT_CARD_ID)) {
      writeHireCardsOpen(employees, storage);
    }
    if (changedIds.includes(NIGHT_SHIFT_CARD_ID)) {
      writeNightShiftOpen(saved[NIGHT_SHIFT_CARD_ID], storage);
    }
  };

  /** A frozen { cardId: open } map, the same object until a change. */
  const getSnapshot = () => {
    load();
    if (snapshot === null) snapshot = Object.freeze({ ...saved, ...session });
    return snapshot;
  };

  /** A chevron tap: set and remember one card. */
  const setOpen = (cardId, open) => setAllOpen([cardId], open);

  /** Collapse all / Expand all: set and remember every card given. */
  const setAllOpen = (cardIds, open) => {
    load();
    saved = { ...saved };
    session = { ...session };
    for (const id of cardIds) {
      saved[id] = Boolean(open);
      delete session[id];
    }
    persist(cardIds);
    emit();
  };

  /** An email link: open the card for the session, not remembered. */
  const openForSession = (cardId) => {
    if (isHireCardOpen(getSnapshot(), cardId)) return;
    session = { ...session, [cardId]: true };
    emit();
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { getSnapshot, setOpen, setAllOpen, openForSession, subscribe };
}

/** The app's one store. */
export const hireCardsStore = createHireCardsStore();
