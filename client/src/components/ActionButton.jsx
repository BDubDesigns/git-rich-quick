import { BouncyButton } from "./BouncyButton.jsx";

/**
 * ActionButton
 *
 * Wrapper component that centers a full-width BouncyButton inside a flex container.
 * Designed to be used as a footer/action control that can include an icon, optional
 * floating text, and children content (label or nodes). The visual style is controlled
 * by the `variant` prop which defaults to "blue".
 *
 * @param {Object} props - Component props.
 * @param {(event?: any) => void} [props.onClick] - Click handler invoked when the button is activated.
 * @param {boolean} [props.disabled=false] - If true, disables the button and prevents interaction.
 * @param {React.ReactNode} [props.children] - Content to render inside the button (text, elements).
 * @param {string} [props.floatText] - Optional floating text passed through to the BouncyButton.
 * @param {React.ReactNode} [props.icon] - Optional icon element to render inside the BouncyButton.
 * @param {string} [props.variant="blue"] - Visual variant name forwarded to the BouncyButton for styling.
 * @returns {JSX.Element} A centered, full-width action button wrapped in a container.
 */
export function ActionButton({
  onClick,
  disabled,
  children,
  floatText,
  icon,
  variant = "blue",
}) {
  return (
    <div className="flex justify-center w-full mt-auto">
      <BouncyButton
        onClick={onClick}
        disabled={disabled}
        floatText={floatText}
        icon={icon}
        variant={variant}
      >
        {children}
      </BouncyButton>
    </div>
  );
}
