import { useState } from "react";
import { Button } from "./Button.jsx";

/**
 * The email + password account form (issue #140), shared by the
 * Settings account section and the splash screen so both create and
 * sign in to accounts the same way. Owns its field state; the caller
 * owns the result. `onSubmit({ mode, email, password, name })` resolves
 * to true on success (the password field is then cleared) and false
 * otherwise (the caller shows its own message). No email verification
 * to create an account (Brandon, Nov 9).
 *
 * @param {Object} props
 * @param {"signin"|"signup"} [props.initialMode="signin"]
 * @param {boolean} props.busy - Disables the form while a request runs.
 * @param {(fields: Object) => Promise<boolean>} props.onSubmit
 * @param {(mode: string) => void} [props.onModeChange] - Told when the
 *   player flips between sign in and create account.
 */
export function AccountForm({
  initialMode = "signin",
  busy,
  onSubmit,
  onModeChange,
}) {
  const [mode, setModeState] = useState(initialMode); // "signin" | "signup"
  const setMode = (next) => {
    setModeState(next);
    if (onModeChange) onModeChange(next);
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    const ok = await onSubmit({ mode, email, password, name });
    if (ok) setPassword("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {mode === "signup" && (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          autoComplete="name"
          className="rounded border border-[#2d2d2d] bg-[#252526] px-2 py-1 text-sm text-[#cccccc] placeholder:text-[#858585]"
        />
      )}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
        autoComplete="email"
        className="rounded border border-[#2d2d2d] bg-[#252526] px-2 py-1 text-sm text-[#cccccc] placeholder:text-[#858585]"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (8+ characters)"
        required
        minLength={8}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        className="rounded border border-[#2d2d2d] bg-[#252526] px-2 py-1 text-sm text-[#cccccc] placeholder:text-[#858585]"
      />
      <Button type="submit" disabled={busy}>
        {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
      </Button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        className="text-xs underline"
      >
        {mode === "signup"
          ? "Already have an account? Sign in"
          : "No account yet? Create one"}
      </button>
    </form>
  );
}
