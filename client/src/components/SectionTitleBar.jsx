import { brandNodes } from "./BrandName.jsx";

export function SectionTitleBar({ title, isDescriptionVisible, onToggle }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[#1e1e1e] border-t border-[#0078d4] text-sm text-[#cccccc] w-fit">
      <span className="text-[#c5c53f]">GRQ</span>
      <h2 className="m-0">{brandNodes(title)}</h2>
      {/* Disclosure chevron, not a close/minimize mark: it expands or
          collapses the green description comment below this bar. The
          old x / + read as "close this panel" even though the panel
          stays open, so players thought the button was broken. */}
      <button
        className="ml-auto text-[#858585] hover:text-[#ffffff]"
        onClick={onToggle}
        aria-expanded={isDescriptionVisible}
        aria-label={
          isDescriptionVisible ? "Hide description" : "Show description"
        }
        title={
          isDescriptionVisible ? "Hide description" : "Show description"
        }
      >
        {isDescriptionVisible ? "▾" : "▸"}
      </button>
    </div>
  );
}
