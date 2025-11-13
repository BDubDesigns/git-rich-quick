import { ActionButton } from "./ActionButton.jsx";
import { formatMoney } from "../utils/currency.js";
import { createElement } from "react";

/**
 * Displays a purchasable employee card.
 *
 * @param {Object} props
 * @param {string} props.employeeType - Key like "intern", "junior", "senior"
 * @param {Object} props.config - Employee config from EMPLOYEE_CONFIGS
 * @param {number} props.currentCost - Current cost in cents (from getEmployeeCost)
 * @param {number} props.ownedCount - Number of this employee type currently hired
 * @param {boolean} props.canAfford - Whether player has enough money to purchase
 * @param {Function} props.onPurchase - Callback when purchase button clicked
 */
export function EmployeeCard({
  employeeType,
  config,
  currentCost,
  ownedCount,
  canAfford,
  onPurchase,
}) {
  // Show celebration on first purchase (ownedCount === 0 means they're about to buy their first)
  const isFirstPurchase = ownedCount === 0;

  return (
    <div className="border rounded-md border-gray-300 p-4 pt-0 flex flex-col">
      {/* Celebration message on first purchase */}
      {isFirstPurchase && (
        <p className="text-center text-green-600 font-semibold mb-2">
          🎉 All requirements met!
        </p>
      )}
      {/* Employee name - tilted styling */}
      <h3 className="-rotate-3 text-red-700 font-semibold">{config.name}</h3>

      {/* Employee icon - larger size for readability */}
      <p className="flex justify-center w-full">
        {createElement(config.icon.type, {
          ...config.icon.props,
          size: 48,
        })}
      </p>

      {/* Stats section */}
      <p>Owned: {ownedCount}</p>
      <p>Production: {config.locPerSecond} LOC/sec</p>
      <p>Cost: ${formatMoney(currentCost)}</p>

      {/* Purchase button */}
      <ActionButton
        onClick={onPurchase}
        disabled={!canAfford}
        floatText="+1"
        icon={config.icon}
      >
        Hire 1 {config.name}
      </ActionButton>
    </div>
  );
}
