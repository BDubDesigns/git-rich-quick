/**
 * The Farm's breeding guide (issue #238), as pure functions so the
 * server test suite can pin the copy to the real rules.
 *
 * Brandon, Nov 21: "I don't see how to breed different kinds. There
 * should be a wiki or at least a popup." Every number here is read from
 * shared/game-balance.js (FARM_CONFIG, FARM_LIGHTING, LLAMA_ECONOMY,
 * farmKidChance), never copied, so a retune updates the guide too.
 */
import {
  FARM_CONFIG,
  FARM_LIGHTING,
  FARM_LIGHTING_COLORS,
  LLAMA_ECONOMY,
  LLAMA_TYPE_NAMES,
  farmKidChance,
  formatEstimateDuration,
} from "../../../shared/game-balance.js";

/** A 0 to 1 chance as a whole percent string (0.08 reads as 8 percent). */
export function guidePercent(chance) {
  return `${Math.round(chance * 100)}%`;
}

/**
 * One row per light, in the game's lighting order: the chance a kid is
 * born on a check, the same chance with a Mama Llama next door (through
 * farmKidChance, so the multiplier and the cap are the real ones), and
 * the chance a born kid is a brand new kind.
 */
export function breedingGuideLightingRows() {
  return FARM_LIGHTING_COLORS.map((id) => {
    const lighting = FARM_LIGHTING[id];
    return {
      id,
      label: lighting.label,
      color: lighting.color,
      kid: guidePercent(farmKidChance(id, [])),
      kidWithMama: guidePercent(farmKidChance(id, ["mama"])),
      newKind: guidePercent(lighting.newTypeChance),
    };
  });
}

/** The guide's copy, section by section, with the numbers filled in. */
export function breedingGuideSections() {
  const seconds = FARM_CONFIG.breedingTickSeconds;
  const mama = LLAMA_TYPE_NAMES.mama;
  return [
    {
      heading: "Making kids",
      lines: [
        `Every ${seconds} seconds the barn runs a breeding check. The countdown above the stalls shows when the next one lands.`,
        "A kid can only appear in an EMPTY stall with at least 2 llamas right beside it: up, down, left or right. Diagonals do not count.",
        "Each empty stall rolls on its own, with its own lighting. The lights on the parents' stalls do not matter.",
        "A kid born on one check only counts as a neighbour from the next check.",
        closedStallsGuideLine(),
      ],
    },
    {
      heading: "New kinds",
      lines: [
        "Most kids copy one of the llamas beside them. Sometimes a kid is a brand new kind: one you have never bought or bred.",
        "Which new kind you get is pure luck. The parents do not decide it, so any nest can find any kind. Only the light changes the odds.",
        "The first one of a kind is a discovery. It goes in the herd book and joins the shop for good, even after you sell the company.",
        "Once you have found every kind, kids just copy their parents.",
      ],
    },
    {
      heading: `The ${mama}`,
      lines: [
        `The ${mama} is only sold in the shop. She is never bred: no kid and no discovery is ever a Mama.`,
        `An empty stall beside a ${mama} makes kids ${LLAMA_ECONOMY.mamaKidChanceMultiplier}x as often, up to ${guidePercent(LLAMA_ECONOMY.maxKidChance)} a check. Two Mamas do not stack.`,
        "Her kids copy a parent that is not a Mama. A stall with only Mamas beside it makes no kid.",
      ],
    },
  ];
}

/**
 * Issue #241: one line on closed stalls, with the counts and the
 * opening prices read from FARM_CONFIG and LLAMA_ECONOMY.
 */
export function closedStallsGuideLine() {
  const starter = FARM_CONFIG.starterStalls.length;
  const closed = FARM_CONFIG.stallCount - starter;
  const prices = LLAMA_ECONOMY.stallOpenSeconds.map(formatEstimateDuration);
  const priceList = `${prices.slice(0, -1).join(", ")}, then ${prices[prices.length - 1]}`;
  return `The barn opens ${starter} stalls. The ${closed} corners start closed: a closed stall holds no llama and is not a neighbour. Tap one to open it. Each costs more than the last: ${priceList} of shipping income.`;
}

/**
 * The light with the best new-kind odds (the discovery light), and the
 * herd book's hint for a ??? entry that names it.
 */
export function bestDiscoveryLighting() {
  return FARM_LIGHTING_COLORS.reduce((best, id) =>
    FARM_LIGHTING[id].newTypeChance > FARM_LIGHTING[best].newTypeChance ? id : best
  );
}

export function herdBookHiddenHint() {
  const light = FARM_LIGHTING[bestDiscoveryLighting()];
  return `A ??? kind joins the shop once you breed one. ${light.label} light finds new kinds most often.`;
}

/** The line above the lighting table: the tradeoff in one sentence. */
export const BREEDING_GUIDE_LIGHTING_INTRO =
  "Tap a stall, then Lighting, to change its light. The light on the EMPTY stall sets both odds: more kids, or more new kinds.";

/** The line under the lighting table, pointing at the herd book. */
export const BREEDING_GUIDE_HERD_BOOK_LINE =
  "The herd book below lists every kind. A ??? entry is still out there.";
