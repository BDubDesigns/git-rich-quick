/**
 * Farm info popups (Brandon, Nov 21: "Mood lighting and herd book should
 * be popups also like how breeding works and those 3 buttons should be
 * together in a panel at the bottom.").
 *
 * The Mood lighting legend and the herd book left the Farm tab and
 * became popups in the same InfoDialog shell as the breeding guide. The
 * three buttons that open them sit together in one panel under the
 * stalls. Source-text pins, like the other Farm card tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertCommitFloatLocked } from "./helpers/commit-float-lock.js";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const farm = src("components/Farm.jsx");
const shell = src("components/InfoDialog.jsx");
const guide = src("components/BreedingGuide.jsx");
const lighting = src("components/MoodLightingGuide.jsx");
const herdBook = src("components/HerdBook.jsx");

// The owned barn's render: from the return after the countdown to the end.
const owned = farm.slice(farm.indexOf("const breedCountdown = formatBreedCountdown("));
const gridStart = owned.indexOf('aria-label="Barn stalls"');
const panelStart = owned.indexOf('aria-label="Farm info"');
const infoPanel = owned.slice(panelStart, owned.indexOf("</Panel>", panelStart));
const BUTTONS = [
  ["guide", "How breeding works"],
  ["lighting", "Mood lighting"],
  ["herd", "Herd book"],
];

test("the three buttons sit together in one panel after the stall grid and the chip", () => {
  assert.ok(gridStart > 0 && panelStart > gridStart, "the info panel comes after the grid");
  // The chip lives inside the grid, so after the grid is after the chip.
  assert.ok(owned.indexOf('id="farm-stall-chip"') < panelStart);
  assert.ok(owned.indexOf("</div>", owned.indexOf('id="farm-stall-chip"')) < panelStart);
  // The shared Panel, a labelled group: the guide on its own row, the
  // other two side by side (monospace labels wrap three in a row).
  assert.match(owned, /<Panel\s+className="grid grid-cols-2 gap-2 p-3"\s+role="group"\s+aria-label="Farm info"\s*>/);
  // The three buttons, in order, all in this panel.
  let at = -1;
  for (const [, label] of BUTTONS) {
    const i = infoPanel.indexOf(`>\n          ${label}\n        </Button>`);
    assert.ok(i > at, `${label} is in the info panel, in order`);
    at = i;
  }
  assert.equal((infoPanel.match(/<Button\b/g) ?? []).length, 3);
  // Each label appears on exactly one Farm button.
  for (const [, label] of BUTTONS) {
    assert.equal(owned.split(`          ${label}\n        </Button>`).length - 1, 1, label);
  }
});

test("each button is the game's Button with a 40px tap target", () => {
  assert.equal((infoPanel.match(/className="(col-span-2 )?min-h-10 w-full leading-tight"/g) ?? []).length, 3);
  assert.match(infoPanel, /setInfoOpen\("guide"\)\}\s*className="col-span-2 min-h-10/);
  assert.match(farm, /import \{ Button \} from "\.\/Button\.jsx";/);
});

test("How breeding works left the top panel; Sell All, the pricing note and the countdown stay put", () => {
  const topPanel = owned.slice(0, gridStart);
  assert.ok(!topPanel.includes("How breeding works"));
  assert.ok(!topPanel.includes("setInfoOpen"));
  assert.match(topPanel, /onClick=\{handleSellAll\}/);
  assert.match(topPanel, /<PricingNote rate=\{pricingRate\} \/>/);
  assert.match(topPanel, /Next breeding check in \{breedCountdown\}\s*\{eligible\.length === 0 \? " \(nothing can breed yet\)" : ""\}/);
  assert.match(topPanel, /role="timer"/);
});

test("each button opens its own popup; one popup is open at a time", () => {
  assert.match(farm, /const \[infoOpen, setInfoOpen\] = useState\(null\);/);
  assert.match(farm, /const closeInfo = \(\) => setInfoOpen\(null\);/);
  for (const [key, label] of BUTTONS) {
    assert.match(
      infoPanel,
      new RegExp(`onClick=\\{\\(\\) => setInfoOpen\\("${key}"\\)\\}[^<]*>\\s*${label}\\s*<`),
      label
    );
  }
  assert.match(owned, /<BreedingGuide open=\{infoOpen === "guide"\} onClose=\{closeInfo\} \/>/);
  assert.match(owned, /<MoodLightingGuide open=\{infoOpen === "lighting"\} onClose=\{closeInfo\} \/>/);
  assert.match(owned, /<HerdBook\s+open=\{infoOpen === "herd"\}\s+onClose=\{closeInfo\}\s+unlockedTypes=\{farm\.unlockedTypes\}\s+pricingRate=\{pricingRate\}\s*\/>/);
});

test("all three popups share one dialog shell, with distinct titles", () => {
  const ids = [];
  for (const [file, id, title] of [
    [guide, "breeding-guide-title", /title="How breeding works"/],
    [lighting, "mood-lighting-title", /title="Mood lighting"/],
    [herdBook, "herd-book-title", /title=\{`Herd book \(\$\{unlockedTypes\.length\}\/\$\{LLAMA_TYPES\.length\} discovered\)`\}/],
  ]) {
    assert.match(file, /import \{ InfoDialog \} from "\.\/InfoDialog\.jsx";/);
    assert.match(file, new RegExp(`titleId="${id}"`));
    assert.match(file, title);
    // No popup builds its own dialog: the shell owns the behavior.
    assert.doesNotMatch(file, /<dialog\b|showModal|useRef/);
    ids.push(id);
  }
  assert.equal(new Set(ids).size, 3);
  // The shell: native modal dialog, labelled, Close focused on open,
  // focus back to the opener, Close, Got it and the backdrop close it.
  assert.match(shell, /dialog\.showModal\?\.\(\);\s*closeRef\.current\?\.focus\(\);/);
  assert.match(shell, /aria-labelledby=\{titleId\}/);
  assert.match(shell, /returnFocusRef\.current = document\.activeElement/);
  assert.match(shell, /if \(opener && typeof opener\.focus === "function"\) opener\.focus\(\);/);
  assert.equal((shell.match(/onClick=\{\(\) => dialogRef\.current\?\.close\(\)\}/g) ?? []).length, 2);
  assert.match(shell, /if \(event\.target === dialogRef\.current\) dialogRef\.current\.close\(\);/);
  assert.match(shell, /className="shrink-0 min-w-10 h-10 px-3/);
  assert.match(shell, /\{open && \(/);
});

test("the legend and the herd book are no longer rendered inline on the Farm tab", () => {
  assert.doesNotMatch(farm, /<p className="m-0 font-semibold">Mood lighting<\/p>/);
  assert.doesNotMatch(farm, /lighting\.newTypeChance|lighting\.kidChance/);
  assert.doesNotMatch(farm, /Mama Llama:<\/strong>/);
  assert.doesNotMatch(farm, /Herd book \(/);
  assert.doesNotMatch(farm, /\?\?\? \(undiscovered\)/);
  assert.doesNotMatch(farm, /herdBookHiddenHint|LLAMA_TYPE_DESCRIPTIONS/);
  assert.doesNotMatch(farm, /\{LLAMA_TYPES\.map/);
});

test("Mood lighting keeps every light's dot, name, flavour and odds, read from the constants", () => {
  assert.match(lighting, /\{FARM_LIGHTING_COLORS\.map\(\(colorId\) => \{\s*const lighting = FARM_LIGHTING\[colorId\];/);
  assert.match(lighting, /<span style=\{\{ color: lighting\.color \}\}>●<\/span>\{" "\}\s*<strong>\{lighting\.label\}:<\/strong> \{lighting\.description\}/);
  assert.match(lighting, /\(kid \{Math\.round\(lighting\.kidChance \* 100\)\}% per tick, new\s+type \{Math\.round\(lighting\.newTypeChance \* 100\)\}% of kids\)/);
  assert.match(lighting, /kids \{LLAMA_ECONOMY\.mamaKidChanceMultiplier\}x as often \(up to\{" "\}\s*\{Math\.round\(LLAMA_ECONOMY\.maxKidChance \* 100\)\}% per tick\)/);
  assert.match(lighting, /Her\s+kids take the other parent's type\. Breed fast, sell the kids\./);
  // No literal odds: every number is interpolated.
  assert.doesNotMatch(lighting.replace(/\* 100/g, ""), /\d+%/);
});

test("the herd book keeps every line and the ??? rules exactly", () => {
  assert.match(herdBook, /const discovered = unlockedTypes\.includes\(type\);/);
  assert.match(herdBook, /const forSale = llamaShopTypes\(unlockedTypes\)\.includes\(type\);/);
  const start = herdBook.indexOf("if (!forSale) {");
  const hidden = herdBook.slice(start, herdBook.indexOf("</p>", start));
  assert.match(hidden, /\{"· "\}\s*<strong>\?\?\? \(undiscovered\)<\/strong>\. Breed one to find it\./);
  assert.doesNotMatch(hidden, /formatMoney|llamaSellPriceCents|llamaBuyPriceCents|typeSeconds|LLAMA_TYPE_NAMES/);
  assert.match(herdBook, /\(buy\{" "\}\s*\{formatMoney\(llamaBuyPriceCents\(type, pricingRate\)\)\},\{" "\}\s*\{formatEstimateDuration\(LLAMA_ECONOMY\.typeSeconds\[type\]\)\} of\s+shipping; sells for\{" "\}\s*\{formatMoney\(llamaSellPriceCents\(type, pricingRate\)\)\}\)/);
  assert.match(herdBook, /\{discovered \? \(\s*<>: \{LLAMA_TYPE_DESCRIPTIONS\[type\]\}<\/>\s*\) : \(\s*", in the shop\. Buy one to meet it\."\s*\)\}/);
  assert.match(herdBook, /\{LLAMA_TYPES\.some\(\(type\) => !llamaShopTypes\(unlockedTypes\)\.includes\(type\)\) && \(\s*<p className="m-0 text-xs text-gray-400">\{herdBookHiddenHint\(\)\}<\/p>/);
});

test("no em or en dashes, no browser popups, no animation in the new files", () => {
  for (const file of [farm, shell, guide, lighting, herdBook]) {
    assert.doesNotMatch(file, /[–—]/);
    assert.doesNotMatch(file, /window\.(alert|confirm|prompt)/);
  }
  for (const file of [shell, lighting, herdBook]) {
    assert.doesNotMatch(file, /animate-|transition|@keyframes/);
  }
});

test("the Commit float's behavior is unchanged: its files have no diff", () => {
  assertCommitFloatLocked();
});
