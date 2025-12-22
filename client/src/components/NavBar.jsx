import { NAV_TABS, useGameContext } from "../context/GameContext.jsx";
import { NavButton } from "./NavButton.jsx";

export function NavBar() {
  const { state, dispatch } = useGameContext();

  const handleTabClick = (tab) => {
    dispatch({ type: "SET_ACTIVE_TAB", payload: { tab } });
  };

  return (
    <div className="w-full flex justify-around lg:gap-3 lg:flex-1">
      {NAV_TABS.map(({ id, label, Icon }) => {
        const isActive = state.activeTab === id;
        return (
          <NavButton
            key={id}
            id={id}
            label={label}
            Icon={Icon}
            isActive={isActive}
            onClick={() => handleTabClick(id)}
          />
        );
      })}
    </div>
  );
}
