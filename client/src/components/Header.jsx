import { useGameContext } from "../context/GameContext";

export function Header() {
  const { state } = useGameContext();

  return (
    <header className="text-center mt-0 mb-0">
      <h1 className="text-3xl font-bold">Git Rich Quick</h1>
    </header>
  );
}
