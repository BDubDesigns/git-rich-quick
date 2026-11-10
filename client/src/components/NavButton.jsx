export function NavButton({ id, label, Icon, isActive, onClick }) {
  // Alias so the prop counts as used: a destructured prop rendered
  // directly as a JSX tag is not counted as a reference by no-unused-vars.
  const IconComponent = Icon;
  return (
    <button
      key={id}
      onClick={onClick}
      className={`transition-all hover:scale-110 hover:shadow-[0_0_15px_5px_rgba(250,250,250,0.5)] w-12 h-12 rounded-full flex items-center justify-center ${
        isActive
          ? "bg-blue-400 text-white"
          : "bg-blue-900 text-gray-300 hover:bg-blue-800"
      }`}
      title={label}
    >
      <IconComponent size={24} />
    </button>
  );
}
