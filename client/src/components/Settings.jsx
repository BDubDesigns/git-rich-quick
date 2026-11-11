/**
 * Settings tab (Slice 3, issue #28): optional account + save linking.
 *
 * Guests stay the default — an account is only a way to keep a save when
 * browser data is cleared or to pick it up on another device. Sign-up
 * does NOT ask for email verification (Brandon, Nov 9): there is no
 * trading, so multiple accounts give no in-game advantage, and email is
 * only the password-reset safety net. An account links to ONE guest
 * playerId (v1 has no cross-platform save beyond that link).
 *
 * Volume controls live here too (issue #32): a slider + mute toggle that
 * scale all game sounds. Volume is a device preference — it lives in
 * localStorage, not in the server save.
 */

import { useCallback, useEffect, useState } from "react";
import {
  authClient,
  linkSaveToAccount,
  getLinkedPlayerId,
  unlinkSaveFromAccount,
  currentGuestPlayerId,
} from "../authClient.js";
import { PLAYER_ID_KEY } from "../save/api.js";
import { SectionLayout } from "./SectionLayout.jsx";
import { Button } from "./Button.jsx";
import {
  getSoundVolume,
  setSoundVolume,
  isSoundMuted,
  setSoundMuted,
} from "../utils/sound.js";

const { useSession, signUp, signIn, signOut } = authClient;

function shortId(id) {
  if (!id) return "—";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function Settings() {
  const { data: session, isPending } = useSession();
  const user = session?.user ?? null;

  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { kind: "ok" | "error", text }
  const [linkedPlayerId, setLinkedPlayerId] = useState(null);
  const [guestPlayerId, setGuestPlayerId] = useState(() =>
    currentGuestPlayerId()
  );

  // Sound volume (issue #32): a device preference, persisted in
  // localStorage by the sound module — never in the server save.
  const [volumePct, setVolumePct] = useState(() =>
    Math.round(getSoundVolume() * 100)
  );
  const [soundMuted, setSoundMutedState] = useState(() => isSoundMuted());

  function handleVolumeChange(event) {
    const pct = Number(event.target.value);
    setVolumePct(pct);
    setSoundVolume(pct / 100);
    // Dragging the slider up always produces sound again.
    if (pct > 0 && soundMuted) {
      setSoundMuted(false);
      setSoundMutedState(false);
    }
  }

  function handleMuteToggle() {
    const next = !soundMuted;
    setSoundMuted(next);
    setSoundMutedState(next);
  }

  const refreshLink = useCallback(async () => {
    if (!user) {
      setLinkedPlayerId(null);
      return;
    }
    setLinkedPlayerId(await getLinkedPlayerId());
  }, [user]);

  useEffect(() => {
    refreshLink();
  }, [refreshLink]);

  // The guest id can change (first run mints one); re-read it when the
  // tab becomes visible so the link button always uses the live one.
  useEffect(() => {
    const update = () => setGuestPlayerId(currentGuestPlayerId());
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result =
        mode === "signup"
          ? await signUp.email({ email, password, name: name || "Player" })
          : await signIn.email({ email, password });
      if (result.error) {
        setMessage({ kind: "error", text: result.error.message });
      } else {
        setMessage({
          kind: "ok",
          text:
            mode === "signup"
              ? "Account created — link your save below so it survives clearing browser data."
              : "Signed in.",
        });
        setPassword("");
      }
    } catch (err) {
      setMessage({ kind: "error", text: String(err?.message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleLink() {
    if (!guestPlayerId) {
      setMessage({
        kind: "error",
        text: "No guest save on this device yet — play a little first, then link it.",
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { status, data } = await linkSaveToAccount(guestPlayerId);
      if (status === 200) {
        setLinkedPlayerId(guestPlayerId);
        setMessage({
          kind: "ok",
          text: "Save linked to your account. Clearing browser data or switching devices will not lose it — sign in and load the linked save.",
        });
      } else if (status === 409 && data?.reason === "player-linked") {
        setMessage({
          kind: "error",
          text: "This save is already linked to a different account.",
        });
      } else if (status === 409 && data?.reason === "user-linked") {
        setMessage({
          kind: "error",
          text: "Your account already links to a different save. Unlink it first if you want to link this one instead.",
        });
      } else if (status === 404) {
        setMessage({
          kind: "error",
          text: "That save is not on the server. Refresh the page and try again.",
        });
      } else {
        setMessage({
          kind: "error",
          text: `Link failed (HTTP ${status}). Try again.`,
        });
      }
    } catch (err) {
      setMessage({ kind: "error", text: String(err?.message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink() {
    setBusy(true);
    setMessage(null);
    try {
      const { status } = await unlinkSaveFromAccount();
      if (status === 200) {
        setLinkedPlayerId(null);
        setMessage({ kind: "ok", text: "Save unlinked from your account." });
      } else {
        setMessage({
          kind: "error",
          text: `Unlink failed (HTTP ${status}). Try again.`,
        });
      }
    } catch (err) {
      setMessage({ kind: "error", text: String(err?.message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  function handleLoadLinked() {
    if (!linkedPlayerId) return;
    try {
      localStorage.setItem(PLAYER_ID_KEY, linkedPlayerId);
    } catch {
      setMessage({
        kind: "error",
        text: "Could not store the linked save id in this browser.",
      });
      return;
    }
    // Reload so the save engine boots from the linked playerId.
    window.location.reload();
  }

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    setLinkedPlayerId(null);
    setMessage(null);
    setBusy(false);
  }

  const linkedHere = linkedPlayerId && linkedPlayerId === guestPlayerId;
  const linkedElsewhere =
    linkedPlayerId && linkedPlayerId !== guestPlayerId;

  return (
    <SectionLayout sectionId="settings">
      {/* Account */}
      <section className="panel flex flex-col gap-2 p-3">
        <h3 className="m-0 text-sm text-[#cccccc]">Account</h3>
        <p className="m-0 text-xs">
          Optional. Guests play fine without one — an account just keeps
          your save if you clear browser data or switch devices. No email
          verification needed to sign up.
        </p>

        {isPending ? (
          <p className="m-0 text-xs">Checking session…</p>
        ) : !user ? (
          <form onSubmit={handleAuthSubmit} className="flex flex-col gap-2">
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
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              className="rounded border border-[#2d2d2d] bg-[#252526] px-2 py-1 text-sm text-[#cccccc] placeholder:text-[#858585]"
            />
            <Button type="submit" disabled={busy}>
              {busy
                ? "Working…"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </Button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setMode(mode === "signup" ? "signin" : "signup")
              }
              className="text-xs underline"
            >
              {mode === "signup"
                ? "Already have an account? Sign in"
                : "No account yet? Create one"}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs text-[#cccccc]">
              Signed in as <strong>{user.email}</strong>
            </p>
            <p className="m-0 text-xs">
              This device&apos;s save:{" "}
              <code>{shortId(guestPlayerId)}</code>
            </p>
            {linkedHere && (
              <p className="m-0 text-xs text-[#4ec9b0]">
                ✓ This save is linked to your account.
              </p>
            )}
            {linkedElsewhere && (
              <p className="m-0 text-xs text-[#dcdcaa]">
                Your account links to a different save (
                <code>{shortId(linkedPlayerId)}</code>) than this
                device&apos;s.
              </p>
            )}
            {!linkedPlayerId && (
              <p className="m-0 text-xs">
                No save linked to your account yet.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!linkedHere && (
                <Button
                  type="button"
                  disabled={busy || !guestPlayerId}
                  onClick={handleLink}
                >
                  Link this save
                </Button>
              )}
              {linkedElsewhere && (
                <Button type="button" disabled={busy} onClick={handleLoadLinked}>
                  Load linked save
                </Button>
              )}
              {linkedPlayerId && (
                <Button type="button" disabled={busy} onClick={handleUnlink}>
                  Unlink save
                </Button>
              )}
              <Button type="button" disabled={busy} onClick={handleSignOut}>
                Sign out
              </Button>
            </div>
          </div>
        )}

        {message && (
          <p
            className={`m-0 text-xs ${
              message.kind === "error" ? "text-[#f48771]" : "text-[#4ec9b0]"
            }`}
          >
            {message.text}
          </p>
        )}
      </section>

      {/* Sound — volume is a device preference, localStorage only. */}
      <section className="panel flex flex-col gap-2 p-3">
        <h3 className="m-0 text-sm text-[#cccccc]">Sound</h3>
        <p className="m-0 text-xs">
          Volume governs game sound, including the golden star chime. It
          is stored on this device only.
        </p>
        <label className="m-0 flex items-center gap-2 text-xs">
          Volume
          <input
            type="range"
            min={0}
            max={100}
            value={volumePct}
            onChange={handleVolumeChange}
            aria-label="Volume"
            className="w-full accent-[#0078d4]"
          />
          <span className="shrink-0 text-[#cccccc]">{volumePct}%</span>
        </label>
        <div>
          <Button type="button" onClick={handleMuteToggle}>
            {soundMuted ? "Unmute" : "Mute"}
          </Button>
        </div>
      </section>
    </SectionLayout>
  );
}
