// The rate line on a freelance project card (issue #176), shared by
// ProjectCard and LockedFreelanceProjectCard so the two can never
// drift apart: `@rate {Cents/LOC} 60¢/LOC`, plus a note saying what
// changed the rate (Client Network, a Hype Train), green when it is
// above base and red when a Derailment drags it below. The text
// comes from projectPayoutLines (utils/projectPayout.js); with no
// readout it renders nothing.
import { JsDocLine } from "./JsDocBlock.jsx";

export function ProjectRateLine({ payout }) {
  if (!payout?.rate) return null;
  return (
    <JsDocLine
      tag="@rate"
      type="Cents/LOC"
      value={payout.rate}
      suffix={payout.rateNote ?? null}
      suffixClassName={payout.rateTone === "loss" ? "text-red-400" : "text-green-400"}
    />
  );
}
