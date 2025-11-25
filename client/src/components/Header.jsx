import { StatBox } from "./StatBox";

export function Header() {
  return (
    <header className="text-center mt-0 mb-0">
      <h1 className="hidden md:block text-3xl font-bold">Git Rich Quick</h1>{" "}
      <StatBox />
    </header>
  );
}
