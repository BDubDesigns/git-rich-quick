/**
 * Displays a locked employee with unlock requirements and progress bars.
 * Read-only display component—no purchase logic.
 *
 * @param {Object} props
 * @param {Object} props.config - Employee config from EMPLOYEE_CONFIGS
 * @param {Array} props.progress - Array from getUnlockProgress(). Should never be empty,
 *   since LockedEmployeeCard is only rendered for locked employees. Locked employees always
 *   have unlock conditions, so progress array is always populated.
 */

// Number abbreviation (issue #42) — the shared formatter. formatMoney
// returns the string WITH the "$" attached, so the locked cost now shows
// "($25.00)" where it previously showed "(25.00)" with no $ sign.
import {
  formatMoney,
  formatNumber,
} from "../../../shared/formatNumber.js";
import { Button } from "./Button.jsx";
import {
  JsDocBlock,
  JsDocLine,
  JsDocUnlockRequirements,
} from "./JsDocBlock.jsx";

export function LockedEmployeeCard({ config, progress }) {
  return (
    <div className="panel px-3 pb-1 flex flex-col gap-1 m-0">
      <div className="flex items-center gap-4">
        {/* Left: JSDoc block — name, description, cost multiplier, LOC/s,
            then the unlock requirements. The description is new here (the
            old locked card did not show it); the other locked cards show
            theirs, so this one does too. */}
        <div className="flex-1">
          <JsDocBlock title={config.name} description={config.description}>
            <JsDocLine
              tag="@param"
              type="Cost"
              value={`x${formatNumber(config.costMultiplier)} per hire`}
            />
            <JsDocLine
              tag="@returns"
              type="LOC"
              value={`${formatNumber(config.locPerSecond)} LOC per Sec`}
              valueClassName="text-green-400"
            />
            <JsDocUnlockRequirements progress={progress} />
          </JsDocBlock>
        </div>

        {/* Right: Button with Price — always disabled; the shared
            Button's grey disabled state is the LOCKED look. */}
        <Button disabled className="shrink-0">
          <div>LOCKED</div>
          <div>(${formatMoney(config.baseCost)})</div>
        </Button>
      </div>
    </div>
  );
}
