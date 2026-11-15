// Brand word "GitNub" (issue #110): in Cascadia Code at small sizes the
// N is easily misread as H, so "GitNub" reads as "GitHub" at a glance.
// brandNodes splits a string on the exact brand word and wraps each
// occurrence in a letter-spaced span (see .brand-name in index.css), so
// the letters parse individually instead of autocorrecting to the
// familiar word. Text without the brand passes through unchanged, and
// the brand itself is never renamed. Use only where the brand appears
// as a name (section headers, card titles, email senders), never in
// body copy.
import { Fragment } from "react";

export function brandNodes(text) {
  if (typeof text !== "string" || !text.includes("GitNub")) return text;
  return text.split("GitNub").map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? <span className="brand-name">GitNub</span> : null}
      {part}
    </Fragment>
  ));
}
