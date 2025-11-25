// Displays a code comment styled as a code block with line numbers
// Used for narrative/instructional text throughout the game UI
export const CodeComment = ({ children, startLine = 1 }) => {
  return (
    <div className="font-mono text-xs md:text-sm bg-gray-900/80 border border-gray-700 rounded-md overflow-hidden shadow-sm mb-4 p-2">
      {/* Line number gutter */}
      <div className="flex gap-3">
        <div className="select-none text-right text-gray-600 border-r border-gray-700/50 bg-gray-900/50 px-2 shrink-0">
          {startLine}
        </div>

        <div className="comment-text italic whitespace-pre-wrap break-word">
          // {children}
        </div>
      </div>
    </div>
  );
};
