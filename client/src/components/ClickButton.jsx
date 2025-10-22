import { useGameContext } from "../context/GameContext";

export function ClickButton() {
  const { dispatch } = useGameContext();

  const handleClick = () => {
    dispatch({ type: "WRITE_CODE" });
  };

  return (
    <button
      onClick={handleClick}
      class="
    inline-flex items-center justify-center
    px-4 py-2
    border border-transparent
    text-sm font-medium leading-5
    rounded-md
    text-white
    bg-green-600
    hover:bg-green-700
    focus:outline-none 
    disabled:opacity-60 disabled:cursor-not-allowed
    transition ease-in-out duration-150
  "
    >
      Commit changes
    </button>
  );
}
