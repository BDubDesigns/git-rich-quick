// Panel: the shared content-box component.
//
// Every content box in GRQ renders through this component, so the
// shared `.panel` class (theme variables, 1rem radius, in
// client/src/index.css) can never be missed by a builder writing
// hand-rolled Tailwind (the Farm tab shipped without it, PR #86
// fixed it). One place owns the panel class now; new boxes use
// <Panel> instead of a raw div with a copied class string.
//
// It renders a div by default; pass `as` for a different element
// (the Farm stalls are <button>s, the Settings sections are
// <section>s). The rendered class list is always `panel` plus the
// caller's classes, in the caller's order. No visual change, just
// one component that guarantees the panel class is there. Extra
// props (onClick, style, id, data-*, ...) pass straight through to
// the element.

/** A content box: a div (or `as`) with the shared `panel` class plus
 *  the caller's extra classes. */
export function Panel({ as: Tag = "div", className = "", children, ...props }) {
  // Alias so the prop counts as used: a destructured prop rendered
  // directly as a JSX tag is not counted as a reference by
  // no-unused-vars (same workaround as CosmeticsPanel.jsx).
  const TagComponent = Tag;
  const classes = className ? `panel ${className}` : "panel";
  return (
    <TagComponent className={classes} {...props}>
      {children}
    </TagComponent>
  );
}
