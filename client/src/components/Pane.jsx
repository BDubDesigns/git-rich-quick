import { useGameContext } from "../context/useGameContext.js";
import { PaneContext } from "../navigation/paneContext.js";
import { paneSections } from "../navigation/panes.js";
import { Shop } from "./Shop";
import { Projects } from "./Projects";
import { OpenSource } from "./OpenSource";
import { Farm } from "./Farm";
import { Achievements } from "./Achievements";
import { Settings } from "./Settings";
import { Email } from "./Email";

/** Every section a pane can show, by id (the PANE_SECTION_IDS). */
const SECTION_COMPONENTS = {
  email: Email,
  shop: Shop,
  projects: Projects,
  openSource: OpenSource,
  farm: Farm,
  achievements: Achievements,
  settings: Settings,
};

/**
 * One pane (issue #174): renders the section the pane holds, inside a
 * PaneContext so its title bar knows which pane it is in (and so what
 * the picker rearranges). Desktop has three (left / center / right,
 * from sidePanes and activeTab); mobile has one, the center. The
 * section is keyed by its id, so a pane that changes section starts a
 * fresh section at the top (and a fresh scroller for the scroll
 * arrows). The section owns its own scroll (SectionLayout).
 */
export function Pane({ position, desktop }) {
  const { state } = useGameContext();
  const sectionId = desktop ? paneSections(state)[position] : state.activeTab;
  const Section = SECTION_COMPONENTS[sectionId];
  if (!Section) return null;
  return (
    <PaneContext.Provider value={{ pane: desktop ? position : "center", desktop }}>
      <div className="h-full min-h-0" data-pane={desktop ? position : "mobile"}>
        <Section key={sectionId} />
      </div>
    </PaneContext.Provider>
  );
}
