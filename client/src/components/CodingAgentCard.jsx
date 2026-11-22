import { useId } from "react";
import { FaRobot } from "react-icons/fa";
import { formatMoney, formatNumber } from "../../../shared/formatNumber.js";
import { CODING_AGENT_CARD_ID } from "../../../shared/game-balance.js";
import { useGameContext } from "../context/useGameContext";
import { getBaseLocPerSecond } from "../context/gameLogic.js";
import { useHireCardOpen } from "../hooks/useHireCards.js";
import { codingAgentCardModel } from "../utils/agentFleetPanel.js";
import { BouncyButton } from "./BouncyButton.jsx";
import { CollapsedHireRow, ExpandedHireHeader } from "./HireCardToggle.jsx";
import { JsDocBlock, JsDocLine } from "./JsDocBlock.jsx";
import { Panel } from "./Panel.jsx";

/** The agent's color: the JSDoc type cyan the review panel uses. */
const AGENT_COLOR = "#4ec9b0";

/**
 * Agent Fleet (issue #267): the Coding Agent's Hire card, from Series
 * A. The same collapsible JSDoc card as the employees (PR #262): one
 * row collapsed (chevron, icon, name, count, Hire button with its
 * price at the selected quantity), the JSDoc block expanded, open or
 * collapsed from the Hire tab's one card store. Agents add no LOC/s;
 * the @returns lines say what they do instead (PRs, and the token
 * bill). Every number comes from the shared AGENT_FLEET_CONFIG.
 */
export function CodingAgentCard({ quantity = 1 }) {
  const { state, dispatch } = useGameContext();
  const [open, toggle] = useHireCardOpen(CODING_AGENT_CARD_ID);
  const detailId = useId();
  const model = codingAgentCardModel(state, getBaseLocPerSecond(state), quantity);
  const name = "Coding Agent";
  const hire = () => dispatch({ type: "HIRE_AGENT", payload: { quantity } });

  if (!open) {
    return (
      <CollapsedHireRow
        name={name}
        icon={
          <FaRobot size={22} color={AGENT_COLOR} className="shrink-0" aria-hidden="true" />
        }
        sub={`x${formatNumber(model.owned)}`}
        detailId={detailId}
        onToggle={toggle}
        action={
          <BouncyButton
            onClick={hire}
            disabled={!model.canAfford}
            floatText={`+${quantity}`}
            icon={<FaRobot size={20} color={AGENT_COLOR} />}
            className="shrink-0 whitespace-nowrap tap-target-40"
          >
            {model.hireLabel} ({formatMoney(model.priceCents)})
          </BouncyButton>
        }
      />
    );
  }

  return (
    <Panel className="px-3 pb-1 flex flex-col gap-1 m-0">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <JsDocBlock
            title={name}
            description="Opens pull requests around the clock. Writes no code you can bank until you review it."
            header={<ExpandedHireHeader name={name} detailId={detailId} onToggle={toggle} />}
            bodyId={detailId}
          >
            <JsDocLine tag="@param" type="Cost" value={model.costLine} />
            <JsDocLine
              tag="@returns"
              type="PR"
              value={model.prLine}
              valueClassName="text-green-400"
            />
            <JsDocLine
              tag="@returns"
              type="LOC"
              value={model.payoutLine}
              valueClassName="text-green-400"
            />
            <JsDocLine
              tag="@returns"
              type="Bill"
              value={model.billLine}
              valueClassName="text-amber-300"
              suffix={model.billSuffix || null}
              suffixClassName="text-gray-400"
            />
          </JsDocBlock>
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0 py-2">
          <FaRobot size={36} color={AGENT_COLOR} />
          <div className="text-xs text-gray-400">x{formatNumber(model.owned)}</div>
          <BouncyButton
            onClick={hire}
            disabled={!model.canAfford}
            floatText={`+${quantity}`}
            icon={<FaRobot size={20} color={AGENT_COLOR} />}
          >
            <div>{model.hireLabel}</div>
            <div>({formatMoney(model.priceCents)})</div>
          </BouncyButton>
        </div>
      </div>
    </Panel>
  );
}
