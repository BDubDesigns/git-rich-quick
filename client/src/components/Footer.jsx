import { NAV_TABS, useGameContext } from "../context/GameContext";
import { ClickButton } from "./ClickButton";
import { CPSMeter } from "./CPSMeter";

export function Footer() {
  const { state, dispatch } = useGameContext();

  const handleTabClick = (tab) => {
    dispatch({ type: "SET_ACTIVE_TAB", payload: { tab } });
  };

  return (
    <>
      <div className="panel flex justify-evenly gap-4 py-4 bg-[#181818]">
        {NAV_TABS.map(({ id, label, Icon }) => {
          const isActive = state.activeTab === id;
          return (
            <button
              key={id}
              onClick={() => handleTabClick(id)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                isActive
                  ? "bg-blue-400 text-white"
                  : "bg-blue-900 text-gray-300 hover:bg-blue-800"
              }`}
              title={label}
            >
              <Icon size={24} />
            </button>
          );
        })}
      </div>
      <div className="text-center mt-5 pb-5 panel">
        <CPSMeter />
        <ClickButton />
      </div>
    </>
  );
}
