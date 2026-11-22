import { useEffect, useSyncExternalStore } from "react";
import { useGameContext } from "../context/useGameContext.js";
import { highlightMatches } from "../navigation/highlight.js";
import { hireCardsStore, isHireCardOpen } from "../utils/hireCards.js";

/** Every Hire tab card's open state (utils/hireCards.js), re-rendering
 *  when any card or the Collapse all control changes it. */
export function useHireCardsSnapshot() {
  return useSyncExternalStore(
    hireCardsStore.subscribe,
    hireCardsStore.getSnapshot,
    hireCardsStore.getSnapshot
  );
}

/**
 * One Hire tab card's open state and its chevron toggle.
 *
 * An email link that targets the card (tab "shop", item id cardId)
 * opens it during render, so the expanded card is already in the DOM
 * when the HighlightAnchor around it scrolls and flashes (its effect
 * runs after this commit, and the card's own effect runs first). The
 * effect then keeps it open for the session without changing the
 * remembered choice; only the chevron and Collapse all do that.
 */
export function useHireCardOpen(cardId) {
  const { state } = useGameContext();
  const cards = useHireCardsSnapshot();
  const targeted = highlightMatches(state.highlightTarget, "shop", cardId);
  useEffect(() => {
    if (targeted) hireCardsStore.openForSession(cardId);
  }, [targeted, cardId]);
  const open = targeted || isHireCardOpen(cards, cardId);
  const toggle = () => hireCardsStore.setOpen(cardId, !open);
  return [open, toggle];
}
