// Issue #231: the section title bars read as VS Code editor tabs again.
// Presentation pins only; the #228 behavior pins (picker, Info toggle,
// pinned bar, swap semantics) live in choosable-panes.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (path) =>
  readFileSync(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("the title bar is a tab strip with one lifted tab joined to the pane surface", () => {
  const bar = src("components/SectionTitleBar.jsx");
  // The strip: a 1px baseline in the theme's title-bar color, fixed heights.
  assert.match(bar, /className="pane-bar [^"]*h-11 lg:h-9[^"]*border-b border-\[var\(--title-bar-color\)\]/);
  // The tab: panel color, accent line on top, side edges, no bottom edge,
  // overlapping the baseline by 1px so it joins the surface.
  const tab = bar.match(/<h2 className="pane-tab ([^"]*)"/);
  assert.ok(tab, "the h2 is the tab");
  for (const cls of ["-mb-px", "bg-[var(--panel-background-color)]", "border-t-[#0078d4]", "border-x"]) {
    assert.ok(tab[1].split(" ").includes(cls), `tab has ${cls}`);
  }
  assert.ok(!/border-b/.test(tab[1]), "the tab has no bottom border");
  // GRQ is the file-type icon; the switch icon sits in the close-button slot.
  assert.match(bar, /pane-tab-icon[^"]*text-\[#c5c53f\]">GRQ</);
  assert.match(bar, /<HiArrowsRightLeft[^>]*aria-hidden="true"/);
  // Visible focus rings on both controls; mobile Info stays 40px tall.
  assert.equal((bar.match(/focus-visible:outline-\[#0078d4\]/g) || []).length, 2);
  assert.match(bar, /className="info-toggle [^"]*h-10 lg:min-w-8 lg:h-7/);
  // The pane surface the tab joins: same panel color, under the bar.
  const layout = src("components/SectionLayout.jsx");
  assert.match(layout, /className="pane-surface [^"]*bg-\[var\(--panel-background-color\)\]/);
});

test("the pinned-pane flash lights the tab, steady under reduced motion", () => {
  const css = src("index.css");
  assert.match(css, /\.pane-bar\.highlight-flash \{\s*animation: none;\s*outline: none;/);
  assert.match(css, /\.pane-bar\.highlight-flash \.pane-tab \{\s*animation: grq-tab-flash 1\.6s/);
  const reduced = css.slice(css.indexOf("@keyframes grq-tab-flash"));
  assert.match(reduced, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.pane-bar\.highlight-flash \.pane-tab \{\s*animation: none;/);
  for (const file of ["components/SectionTitleBar.jsx", "components/SectionLayout.jsx"]) {
    assert.ok(!/[—–]/.test(src(file)), `no em or en dash in ${file}`);
  }
});
