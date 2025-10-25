// Import the CSS styles for the FloatingText component
import "./FloatingText.css";

// FloatingText component displays animated text that floats up from a given position
// Props:
//   - text: The text content to display
//   - icon: Optional icon element to display next to the text
//   - x, y: The x and y coordinates where the text should appear
//   - onAnimationEnd: Callback function triggered when the animation completes
export function FloatingText({ text, icon, x, y, onAnimationEnd }) {
  return (
    <div
      // Tailwind classes: prevent selection, disable pointer events, position fixed,
      // apply float-up animation, bold font, green color, flex layout with gap
      className="select-none pointer-events-none 
      fixed animate-float-up 
      font-bold text-xl text-green-600 
      flex items-center gap-1"
      // Position the element at the calculated coordinates (offset by 30px up, 15px left)
      style={{ top: `${y - 30}px`, left: `${x - 15}px` }}
      // Trigger callback when animation ends
      onAnimationEnd={onAnimationEnd}
    >
      {/* Display the main text content */}
      <span>{text}</span>
      {/* Conditionally render icon if provided */}
      {icon && <span className="flex items-center justify-center">{icon}</span>}
    </div>
  );
}
