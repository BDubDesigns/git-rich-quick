/**
 * A bottom-nav tab button. Most tabs render a react-icon (`Icon`) in a
 * blue circle; a tab with an `imageSrc` (the Email tab's GITMail logo)
 * renders the image instead. The logo PNGs have a black background, so
 * the image button is a black circle — a black rectangle inside the blue
 * circle would look bad. The active state is a blue ring, and the unread
 * badge overlays the corner exactly like the icon buttons.
 */
export function NavButton({
  id,
  label,
  Icon,
  imageSrc,
  isActive,
  badgeCount = 0,
  onClick,
}) {
  // Alias so the prop counts as used: a destructured prop rendered
  // directly as a JSX tag is not counted as a reference by no-unused-vars.
  const IconComponent = Icon;

  if (imageSrc) {
    return (
      <button
        key={id}
        onClick={onClick}
        className={`relative transition-all hover:scale-110 hover:shadow-[0_0_15px_5px_rgba(250,250,250,0.5)] w-12 h-12 rounded-full overflow-hidden bg-black flex items-center justify-center ${
          isActive ? "ring-2 ring-blue-400" : ""
        }`}
        title={label}
      >
        <img
          src={imageSrc}
          alt={label}
          className="w-full h-full object-contain"
        />
        {/* Unread count badge (Email tab): a circle over the button's
            corner. Hidden at zero. */}
        {badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] leading-5 text-center font-bold pointer-events-none">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      key={id}
      onClick={onClick}
      className={`relative transition-all hover:scale-110 hover:shadow-[0_0_15px_5px_rgba(250,250,250,0.5)] w-12 h-12 rounded-full flex items-center justify-center ${
        isActive
          ? "bg-blue-400 text-white"
          : "bg-blue-900 text-gray-300 hover:bg-blue-800"
      }`}
      title={label}
    >
      <IconComponent size={24} />
      {/* Unread count badge (Email tab): a circle over the button's
          corner. Hidden at zero. */}
      {badgeCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] leading-5 text-center font-bold pointer-events-none">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </button>
  );
}
