// Cosmetics (issue #11) — the equip UI for employee-icon skins.
//
// One group per employee type (one cosmetic slot each). Each group
// shows the Default icon plus every cosmetic for that slot: unlocked
// ones get an Equip button (or "Equipped" when active), locked ones
// are greyed out with the hire-count requirement, so the player can
// see what to aim for. Equipping is a plain Button, not a
// BouncyButton — it is a display preference, not a game action
// (no bounce, no floating text).
//
// Placed at the bottom of the Shop tab, where the employee icons
// live, so the effect of equipping is visible right above it.

import { useGameContext } from "../context/useGameContext.js";
import {
  COSMETICS_CONFIG,
  EMPLOYEE_CONFIGS,
} from "../context/gameConfig.js";
import { EMPLOYEE_DISPLAY_NAMES } from "../../../shared/game-balance.js";
import { Button } from "./Button.jsx";

export function CosmeticsPanel() {
  const { state, dispatch } = useGameContext();
  const unlockedCosmetics = state.unlockedCosmetics ?? [];
  const equippedCosmetics = state.equippedCosmetics ?? {};

  const handleEquip = (slot, cosmeticId) => {
    dispatch({
      type: "EQUIP_COSMETIC",
      payload: { slot, cosmeticId },
    });
  };

  return (
    <div className="panel px-3 pb-2 flex flex-col gap-2 m-0">
      <h3 className="m-0 text-sm font-bold">Cosmetics</h3>
      <p className="m-0 text-xs text-gray-400">
        Skins for your devs, earned by hiring. Equip one and the
        employee card wears it instead of the default icon.
      </p>
      {Object.entries(EMPLOYEE_CONFIGS).map(([employeeType, config]) => {
        const slot = config.cosmeticSlot;
        const equippedId = equippedCosmetics[slot] ?? null;
        return (
          <div key={employeeType} className="flex flex-col gap-1">
            <div className="text-xs font-semibold">
              {EMPLOYEE_DISPLAY_NAMES[employeeType]}
            </div>
            {/* Default icon — equipping nothing. */}
            <CosmeticRow
              Icon={config.Icon}
              color={config.color}
              name="Default"
              action={
                equippedId === null ? (
                  <span className="text-xs text-green-400">In use</span>
                ) : (
                  <Button onClick={() => handleEquip(slot, null)}>Use</Button>
                )
              }
            />
            {config.cosmeticUnlocks.map(({ triggerCount, cosmeticId }) => {
              const cosmetic = COSMETICS_CONFIG[cosmeticId];
              if (!cosmetic) return null;
              const unlocked = unlockedCosmetics.includes(cosmeticId);
              const equipped = equippedId === cosmeticId;
              return (
                <CosmeticRow
                  key={cosmeticId}
                  Icon={cosmetic.Icon}
                  color={cosmetic.color}
                  name={cosmetic.name}
                  locked={!unlocked}
                  lockedNote={`Hire ${triggerCount} ${EMPLOYEE_DISPLAY_NAMES[employeeType]}s to unlock`}
                  action={
                    unlocked ? (
                      equipped ? (
                        <span className="text-xs text-green-400">
                          Equipped
                        </span>
                      ) : (
                        <Button onClick={() => handleEquip(slot, cosmeticId)}>
                          Equip
                        </Button>
                      )
                    ) : null
                  }
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** One cosmetic row: icon, name, and the Equip / status action. */
function CosmeticRow({ Icon, color, name, locked, lockedNote, action }) {
  // Alias so the prop counts as used: a destructured prop rendered
  // directly as a JSX tag is not counted as a reference by
  // no-unused-vars (same workaround as NavButton.jsx).
  const IconComponent = Icon;
  return (
    <div
      className={`flex items-center gap-3 px-2 py-1 rounded ${
        locked ? "opacity-50" : ""
      }`}
    >
      <IconComponent size={28} color={color} />
      <div className="flex-1 flex flex-col">
        <span className="text-sm">{name}</span>
        {locked && lockedNote ? (
          <span className="text-xs text-gray-400">{lockedNote}</span>
        ) : null}
      </div>
      {action}
    </div>
  );
}
