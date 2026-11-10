import "./Button.css";

/**
 * Button — the ONE shared button visual for the whole app (DRY/SSOT).
 *
 * Canonical blue (the BouncyButton/ActionButton blue, rgb(29, 78, 216)),
 * rounded corners, padding, font, and a grey disabled state. It is the
 * visual only: no bounce, no floating text. Those are game-action
 * behavior and live in BouncyButton, which renders this component.
 * Plain buttons (Settings, LOCKED cards, the bulk-buy selector) use
 * this directly and get no bounce or floating text.
 *
 * @param {Object} props
 * @param {(event: React.MouseEvent<HTMLButtonElement>) => void} [props.onClick]
 * @param {boolean} [props.disabled=false]
 * @param {React.ReactNode} props.children
 * @param {"button"|"submit"|"reset"} [props.type="button"]
 * @param {Object} [props.style] - Inline styles forwarded to the button.
 * @param {string} [props.className=""] - Extra classes (layout only, e.g.
 *   shrink-0, or game-button--inactive for an unselected toggle member).
 */
export function Button({
  onClick,
  disabled = false,
  children,
  type = "button",
  style,
  className = "",
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={`game-button ${
        disabled ? "game-button--disabled" : ""
      } ${className}`}
    >
      {children}
    </button>
  );
}
