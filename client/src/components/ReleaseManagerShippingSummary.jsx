import { useGameContext } from "../context/useGameContext";
import { getReleaseManagerEconomics } from "../context/gameLogic";
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { Panel } from "./Panel.jsx";

/**
 * Release Manager shipping summary (issue #163), under the Release
 * Manager card on the Hire tab. The assignment controls live on the
 * project cards now; this strip is the fleet readout: passive LOC/s
 * in, the managers' LOC/s out, the net (green at zero or above, red in
 * a deficit), the cash/s they earn, and the unassigned count, with a
 * pointer to the Projects tab while any manager sits idle.
 *
 * Hidden while no manager is owned (nothing to summarize).
 */
export function ReleaseManagerShippingSummary() {
  const { state } = useGameContext();
  const owned = state.employees.releaseManager?.count ?? 0;
  if (owned <= 0) return null;

  const econ = getReleaseManagerEconomics(state);
  const netPositive = econ.net >= 0;
  const signed = (n) => `${n >= 0 ? "+" : "-"}${formatNumber(Math.abs(n))}`;

  return (
    <Panel className="px-3 py-2 flex flex-col gap-1 m-0 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          In: <span className="text-green-400">{signed(econ.passiveIn)}</span>{" "}
          LOC/s
        </span>
        <span>
          Out: <span className="text-red-400">-{formatNumber(econ.rmOut)}</span>{" "}
          LOC/s
        </span>
        <span>
          Net:{" "}
          <span
            className={`font-semibold ${netPositive ? "text-green-400" : "text-red-400"}`}
            data-testid="rm-net"
          >
            {signed(econ.net)}
          </span>{" "}
          LOC/s
        </span>
        <span>
          Cash:{" "}
          <span className="text-green-400">
            +{formatMoney(econ.cashPerSecond)}
          </span>
          /s
        </span>
        <span>Unassigned: {formatNumber(econ.unassigned)}</span>
      </div>
      {econ.unassigned > 0 && (
        <div className="text-xs text-yellow-300">
          {econ.unassigned === 1
            ? "1 manager is idle."
            : `${formatNumber(econ.unassigned)} managers are idle.`}{" "}
          Assign them on the Projects tab.
        </div>
      )}
      <div className="text-xs text-gray-400">
        Managers only ship when there is LOC to burn, so Out is the
        intended rate and Net is how fast your LOC would change if they
        could always ship.
      </div>
    </Panel>
  );
}
