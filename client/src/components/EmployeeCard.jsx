import { formatMoney } from "../utils/currency";

export function EmployeeCard({
  config,
  currentCost,
  ownedCount,
  canAfford,
  onPurchase,
}) {
  return (
    <div className="panel px-3 pb-1 flex flex-col gap-1 m-0">
      {/* Top: Employee Name */}
      <div>
        <span className="text-sm font-bold">{config.name}</span>{" "}
        <span className="text-xs comment-text">
          {`// `}
          {config.locPerSecond} LOC per Sec
        </span>
      </div>

      {/* Row: Icon + Name + Count, Description, Button */}
      <div className="flex items-center gap-4">
        {/* Left: Icon + Name + Count */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <config.Icon size={36} color={config.color} />
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
          className={`flex flex-col items-center gap-1 shrink-0 px-3 py-2 rounded font-bold text-xs whitespace-nowrap ${
            canAfford
              ? "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
              : "bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
        >
          <div>Hire</div>
          <div>(${formatMoney(currentCost)})</div>
        </button>
      </div>
    </div>
  );
}
