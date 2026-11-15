/**
 * A bottom-nav tab button. A column: the blue circle (active: blue-400
 * fill, inactive: blue-900) with the tab's icon or image, and a small
 * text label under it (issue #103) so each tab is identifiable at a
 * glance. The people icon (Shop) and the rocket (Projects) are easy
 * to confuse without labels, and our own playtester mixed them up.
 * A tab with an `imageSrc` (the Email tab's GITMail logo) renders the
 * image inside that circle instead of a react-icon. The logo PNG is
 * transparent, so it sits on the blue like an icon; it is sized down
 * (w-9) with object-contain so the wide envelope fits without
 * clipping. The unread badge sits at the top-right corner of the
 * circle, pushed mostly outside it (-top-2 -right-2) so it clears the
 * envelope instead of overlapping it, ringed white so it reads
 * unmistakably as a badge. Hidden at zero.
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
      className="flex flex-col items-center gap-1 bg-transparent"
      title={label}
      aria-label={label}
    >
      <span
        className={`relative transition-all hover:scale-110 hover:shadow-[0_0_15px_5px_rgba(250,250,250,0.5)] w-12 h-12 rounded-full flex items-center justify-center ${
          isActive
            ? "bg-blue-400 text-white"
            : "bg-blue-900 text-gray-300 hover:bg-blue-800"
        }`}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={label}
            className="w-9 h-9 object-contain"
          />
        ) : (
          <IconComponent size={24} />
        )}
        {/* Unread count badge (Email tab): a circle over the button's
            corner, pushed mostly outside the circle so it clears the
            envelope image. Hidden at zero. */}
        {badgeCount > 0 && (
          <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] leading-5 text-center font-bold pointer-events-none ring-2 ring-white">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </span>
      {/* Text label under the circle (issue #103). Wraps to two lines
          for the longest label ("Open Source") on narrow phones. */}
      <span
        className={`text-[10px] leading-tight text-center max-w-14 ${
          isActive ? "text-white" : "text-gray-300"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
