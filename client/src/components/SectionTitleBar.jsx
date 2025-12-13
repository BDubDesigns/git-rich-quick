export function SectionTitleBar({ title, isDescriptionVisible, onToggle }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[#1e1e1e] border-t border-[#0078d4] text-sm text-[#cccccc] w-fit">
      <span className="text-[#c5c53f]">GRQ</span>
      <h2 className="m-0">{title}</h2>
      <button
        className="ml-auto text-[#858585] hover:text-[#ffffff]"
        onClick={onToggle}
      >
        {isDescriptionVisible ? "×" : "+"}
      </button>
    </div>
  );
}
