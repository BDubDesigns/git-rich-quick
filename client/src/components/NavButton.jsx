/**
 * A bottom-nav tab button. Every tab renders in the same blue circle
 * (active: blue-400 fill, inactive: blue-900) — a tab with an
 * `imageSrc` (the Email tab's GITMail logo) renders the image inside
 * that circle instead of a react-icon. The logo PNG is transparent,
 * so it sits on the blue like an icon; it is sized down (w-10) with
 * object-contain so the wide envelope fits without clipping. The
 * unread badge is identical for every tab: a red count circle at the
 * top-right corner, ringed white so it reads unmistakably as a badge
 * even where it overlaps the red envelope. Hidden at zero.
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
      {imageSrc ? (
        <img src={imageSrc} alt={label} className="w-10 h-10 object-contain" />
      ) : (
        <IconComponent size={24} />
      )}
      {/* Unread count badge (Email tab): a circle over the button's
          corner. Hidden at zero. */}
      {badgeCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] leading-5 text-center font-bold pointer-events-none ring-2 ring-white">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </button>
  );
}
