import { formatMoney } from "../utils/currency";

export function EmployeeCard({
  config,
  currentCost,
  ownedCount,
  canAfford,
  onPurchase,
}) {
  return (
    <div className="panel p-3 flex items-center gap-4">
      {/* Left: Icon + Name + Count */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className="text-2xl">{config.icon}</div>
        <div className="text-xs font-bold text-center">{config.name}</div>
        <div className="text-xs text-gray-400">x{ownedCount}</div>
      </div>

      {/* Center: Description */}
      <div className="flex-1">
        <p className="text-xs text-gray-300">{config.description}</p>
      </div>

      {/* Right: Button with Price */}
      <button
        onClick={onPurchase}
        disabled={!canAfford}
        className={`flex flex-col items-center gap-1 flex-shrink-0 px-3 py-2 rounded font-bold text-xs whitespace-nowrap ${
          canAfford
            ? "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
            : "bg-gray-700 text-gray-500 cursor-not-allowed"
        }`}
      >
        <div>{formatMoney(currentCost)}</div>
        <div>Hire</div>
      </button>
    </div>
  );
}
