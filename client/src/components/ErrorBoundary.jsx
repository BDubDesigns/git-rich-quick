/**
 * ErrorBoundary — the app's crash screen.
 *
 * Brandon reported a grey screen while playing that only a refresh
 * fixes: the app had no error boundary, so any uncaught render error
 * blanked the whole page. This boundary wraps the app root (outside
 * the providers, in main.jsx) so it still renders when a provider
 * crashes, and shows a friendly message + Reload instead of grey.
 *
 * The fallback never depends on GameContext or any provider state:
 * it reads the player id straight from localStorage and the session
 * straight from the auth client. componentDidCatch also logs to the
 * console, so the error shows in devtools even when the dump is
 * hidden. The dump holds only the error message, component stack,
 * version, timestamp, and player id: no tokens, no save state.
 */

import { Component, useEffect, useState } from "react";
import { authClient, currentGuestPlayerId } from "../authClient.js";
import { Panel } from "./Panel.jsx";
import { Button } from "./Button.jsx";
import {
  buildErrorDump,
  copyTextToClipboard,
  resolveSessionState,
} from "./errorDump.js";

/**
 * The crash screen itself: a Panel with the friendly message, a
 * Reload button, and (when showDump) the error report with a Copy
 * button. A plain function component so it can be rendered on its
 * own; it reads nothing from context, so it renders even when the
 * providers are the thing that crashed. No em dashes in the copy.
 */
export function ErrorFallback({
  error,
  errorInfo,
  errorAt,
  showDump,
  onReload = () => window.location.reload(),
}) {
  const playerId = currentGuestPlayerId();
  const dump = showDump
    ? buildErrorDump({ error, errorInfo, errorAt, playerId })
    : null;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  async function handleCopy() {
    if (!dump) return;
    try {
      await copyTextToClipboard(dump);
      setCopied(true);
    } catch {
      // Copy failed (no clipboard, no execCommand): the dump stays
      // visible so the player can still read or screenshot it.
    }
  }

  return (
    <div className="flex min-h-screen justify-center p-4 pt-16">
      <Panel className="flex w-full max-w-xl flex-col gap-3 p-4 text-sm">
        <h2 className="m-0 text-lg">Something broke.</h2>
        <p className="m-0">
          Your save is safe on the server. Reload to keep playing.
        </p>
        <div>
          <Button onClick={onReload}>Reload</Button>
        </div>
        {showDump && (
          <>
            <p className="m-0 text-xs">Error details:</p>
            <pre className="m-0 max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-left text-xs">
              {dump}
            </pre>
            <div>
              <Button onClick={handleCopy}>
                {copied ? "Copied." : "Copy error details"}
              </Button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorAt: null,
      // "pending" | "brandon" | "other" | "unknown". The dump shows
      // for every state except "other" (fail-open: a slow or failed
      // identity check must never hide it from Brandon).
      sessionState: "pending",
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
      errorAt: new Date().toISOString(),
    };
  }

  componentDidCatch(error, errorInfo) {
    // Log to the console so the error shows in devtools even when
    // the dump is hidden for another signed-in account.
    console.error("Git Rich Quick crashed:", error, errorInfo);
    this.setState({ errorInfo });
    // Identify the signed-in account for the dump gate. Only a
    // positively identified other account hides the dump; no session
    // or a failed check keeps showing it.
    resolveSessionState(() => authClient.getSession()).then(
      (sessionState) => {
        this.setState({ sessionState });
      }
    );
  }

  render() {
    const { hasError, error, errorInfo, errorAt, sessionState } = this.state;
    if (!hasError) return this.props.children;
    return (
      <ErrorFallback
        error={error}
        errorInfo={errorInfo}
        errorAt={errorAt}
        showDump={sessionState !== "other"}
      />
    );
  }
}
