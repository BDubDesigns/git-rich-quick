import { useGameContext } from "../context/GameContext";

const cpsColorClasses = {
  low: "text-green-500",
  medium: "text-orange-300",
  high: "text-red-400 font-semibold",
  critical: "text-red-600 font-bold",
};

function getCPSLevel(cps) {
  if (cps < 5) return "low";
  if (cps < 10) return "medium";
  if (cps < 15) return "high";
  return "critical";
}

export function CPSMeter() {
  const { state } = useGameContext();
  const level = getCPSLevel(state.currentCPS);
  const colorClass = cpsColorClasses[level];

  return (
    <div className="text-center font-mono text-sm text-gray-500">
      Clicks/sec:{" "}
      <span className={`text-lg ${colorClass}`}>{state.currentCPS}</span>
    </div>
  );
}
