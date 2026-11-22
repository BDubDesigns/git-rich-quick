import { InfoDialog } from "./InfoDialog.jsx";
import {
  BREEDING_GUIDE_HERD_BOOK_LINE,
  BREEDING_GUIDE_LIGHTING_INTRO,
  breedingGuideLightingRows,
  breedingGuideSections,
} from "../utils/breedingGuide.js";

/**
 * The Farm's breeding guide (issue #238): a popup that explains how a
 * kid is made, what each light does to both odds, the Mama Llama, and
 * how a new kind is discovered. Every number comes from the shared
 * balance file through utils/breedingGuide.js.
 *
 * It renders in InfoDialog, the shell the Mood lighting and Herd book
 * popups share, which owns the modal behavior: dialog role, focus kept
 * inside, Escape, Close, Got it and a backdrop tap close it, and focus
 * goes back to the opener. Nothing is animated.
 */
function renderSection(section) {
  return (
    <section key={section.heading} className="flex flex-col gap-1">
      <h3 className="m-0 text-sm font-semibold">{section.heading}</h3>
      {section.lines.map((line) => (
        <p key={line} className="m-0">
          {line}
        </p>
      ))}
    </section>
  );
}

export function BreedingGuide({ open, onClose }) {
  const rows = breedingGuideLightingRows();
  // Making kids and New kinds first, then the lighting table (the
  // discovery choice), then the Mama Llama.
  const sections = breedingGuideSections();

  return (
    <InfoDialog
      open={open}
      onClose={onClose}
      titleId="breeding-guide-title"
      title="How breeding works"
    >
      {sections.slice(0, 2).map(renderSection)}

      <section className="flex flex-col gap-1">
        <h3 className="m-0 text-sm font-semibold">Lighting</h3>
        <p className="m-0">{BREEDING_GUIDE_LIGHTING_INTRO}</p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-gray-400">
              <th scope="col" className="text-left font-normal py-1">Light</th>
              <th scope="col" className="text-right font-normal py-1">Kid per check</th>
              <th scope="col" className="text-right font-normal py-1">With a Mama</th>
              <th scope="col" className="text-right font-normal py-1">New kind</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[#3a3a3a]">
                <th scope="row" className="text-left font-normal py-1">
                  <span style={{ color: row.color }} aria-hidden="true">●</span>{" "}
                  {row.label}
                </th>
                <td className="text-right tabular-nums py-1">{row.kid}</td>
                <td className="text-right tabular-nums py-1">{row.kidWithMama}</td>
                <td className="text-right tabular-nums py-1">{row.newKind}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 text-xs text-gray-400">
          New kind: the chance a kid, once born, is a kind you have not found yet.
        </p>
        <p className="m-0">{BREEDING_GUIDE_HERD_BOOK_LINE}</p>
      </section>

      {sections.slice(2).map(renderSection)}
    </InfoDialog>
  );
}
