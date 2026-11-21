/**
 * The store-only intermission (issue #188), client side.
 *
 * Brandon, Nov 19, right after his first sale: "It let me get LOC
 * before starting new game. It should bring up the store to spend
 * stuff on and nothing else in the future."
 *
 * While the post-sale intermission is open the client renders only the
 * permanent store and its start-the-next-company action (App.jsx), and
 * the reducer refuses every game action here, so a stray tick, a
 * keyboard commit, a star timer or a delayed handler can never move
 * the company. The server pins the same company-progress fields
 * (shared pinIntermissionProgress), so even a modified client's
 * intermission accrual never reaches the next company.
 *
 * Pure (no React), so the server test suite pins it directly.
 */
import { intermissionOpen } from "../../../shared/game-balance.js";

/**
 * The only reducer actions that run while the intermission is open:
 * adopting a server state (every store buy and the completion arrive
 * this way), and pure view preferences that change no progress.
 */
export const INTERMISSION_ALLOWED_ACTIONS = Object.freeze([
  "RESTORE_SAVE",
  "TOGGLE_SECTION_DESC_VISIBILITY",
  // Choosable panes (issue #174): pure view state, so a resize or a
  // pane choice during the intermission is never lost.
  "SET_LAYOUT_MODE",
  "CHOOSE_PANE_SECTION",
]);

/** Whether the reducer must ignore `action` because the intermission is open. */
export function isActionBlockedDuringIntermission(state, action) {
  if (!intermissionOpen(state)) return false;
  return !INTERMISSION_ALLOWED_ACTIONS.includes(action?.type);
}
