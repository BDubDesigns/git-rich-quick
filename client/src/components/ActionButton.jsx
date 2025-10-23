export function ActionButton({ onClick, disabled, children }) {
  return (
    <div className="flex justify-center w-full mt-auto">
      <button
        onClick={onClick}
        disabled={disabled}
        className={`${
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "opacity-100 cursor-pointer"
        } p-1 border border-blue-800 rounded-md bg-blue-700 text-white hover:bg-blue-500 transition duration-150 ease-in-out`}
      >
        {children}
      </button>
    </div>
  );
}
