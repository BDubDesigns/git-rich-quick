import { NAV_TABS } from "../context/gameConfig.js";
import { useGameContext } from "../context/useGameContext.js";
import { unreadEmailCount } from "../email/email.js";
import { NavButton } from "./NavButton.jsx";
import { getReleaseManagerEconomics } from "../context/gameLogic.js";
import { farmUnseenBirths } from "../../../shared/game-balance.js";
import { isSectionOnScreen, paneOf } from "../navigation/panes.js";

export function NavBar() {
  const { state, dispatch } = useGameContext();
  const unreadEmails = unreadEmailCount(state.emails);
  // Issue #163: idle Release Managers badge the Projects tab, where
  // they are assigned. The badge only points; nothing auto-assigns.
  const unassignedManagers = getReleaseManagerEconomics(state).unassigned;
  // Issue #204: llamas born since the last Farm visit. Never shown while
  // the Farm is on screen (issue #174: in any pane; the reducer also
  // keeps it at 0 there).
  const unseenBirths = isSectionOnScreen(state, "farm")
    ? 0
    : farmUnseenBirths(state.farm);

  const handleTabClick = (tab) => {
    dispatch({ type: "SET_ACTIVE_TAB", payload: { tab } });
  };

  return (
    <div className="w-full flex justify-around lg:gap-3 lg:flex-1">
      {NAV_TABS.map(({ id, label, Icon, imageSrc }) => {
        const isActive = state.activeTab === id;
        // Issue #174: on desktop a section pinned in a side pane gets a
        // quieter "on screen" ring (tap it to find it); lit means the
        // center, plain means off screen. Mobile: one lit icon.
        const pane = paneOf(state, id);
        const isPinned = pane === "left" || pane === "right";
        return (
          <NavButton
            key={id}
            id={id}
            label={label}
            Icon={Icon}
            imageSrc={imageSrc}
            isActive={isActive}
            isPinned={isPinned}
            // Unread-mail badge on the Email tab only: a circle with the
            // unread count. It drops as mail is read and disappears at zero.
            // Projects tab: the count of unassigned Release Managers.
            // Farm tab: llamas born since the last visit (issue #204).
            badgeCount={
              id === "email"
                ? unreadEmails
                : id === "projects"
                  ? unassignedManagers
                  : id === "farm"
                    ? unseenBirths
                    : 0
            }
            onClick={() => handleTabClick(id)}
          />
        );
      })}
    </div>
  );
}
