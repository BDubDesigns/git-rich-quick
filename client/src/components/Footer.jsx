import { ClickButton } from "./ClickButton";
import { CPSMeter } from "./CPSMeter";

export function Footer() {
  return (
    <div className="text-center">
      <CPSMeter />
      <ClickButton />
    </div>
  );
}
