import "./FloatingText.css";

export function FloatingText({ text, x, y, onAnimationEnd }) {
  return (
    <div
      className="select-none fixed pointer-events-none animate-float-up font-bold text-xl text-green-600"
      style={{ top: `${y - 30}px`, left: `${x - 15}px` }}
      onAnimationEnd={onAnimationEnd}
    >
      {text}
    </div>
  );
}
