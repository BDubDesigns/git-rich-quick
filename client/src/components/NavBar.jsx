import { NAV_TABS } from "../context/gameConfig.js";
import { useGameContext } from "../context/useGameContext.js";
import { unreadEmailCount } from "../email/email.js";
import { NavButton } from "./NavButton.jsx";
import { getReleaseManagerEconomics } from "../context/gameLogic.js";

export function NavBar() {
  const { state, dispatch } = useGameContext();
  const unreadEmails = unreadEmailCount(state.emails);
  // Issue #163: idle Release Managers badge the Projects tab, where
  // they are assigned. The badge only points; nothing auto-assigns.
  const unassignedManagers = getReleaseManagerEconomics(state).unassigned;

  const handleTabClick = (tab) => {
    dispatch({ type: "SET_ACTIVE_TAB", payload: { tab } });
  };

  return (
    <div className="w-full flex justify-around lg:gap-3 lg:flex-1">
      {NAV_TABS.map(({ id, label, Icon, imageSrc }) => {
        const isActive = state.activeTab === id;
        return (
          <NavButton
            key={id}
            id={id}
            label={label}
            Icon={Icon}
            imageSrc={imageSrc}
            isActive={isActive}
            // Unread-mail badge on the Email tab only: a circle with the
            // unread count. It drops as mail is read and disappears at zero.
            // Projects tab: the count of unassigned Release Managers.
            badgeCount={
              id === "email"
                ? unreadEmails
                : id === "projects"
                  ? unassignedManagers
                  : 0
            }
            onClick={() => handleTabClick(id)}
          />
        );
      })}
    </div>
  );
}
