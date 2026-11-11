/**
 * Tiny synthesized sound effects for the golden star (issue #33).
 *
 * No audio assets: the chime is a short WebAudio oscillator arpeggio.
 * Volume is a device preference (issue #32): a 0–1 master volume plus a
 * mute flag, both persisted in localStorage (client-only, never in the
 * server save) and applied to every sound in this module. Sounds are
 * best-effort: if WebAudio is unavailable or the browser blocks audio
 * before a user gesture, they no-op instead of throwing.
 */

/** localStorage keys (same `grq:` prefix as the player id). */
const VOLUME_KEY = "grq:soundVolume";
const MUTED_KEY = "grq:soundMuted";

let muted = false;
let masterVolume = 1; // Master volume, 0–1. Scales every tone.
let audioContext = null;
let prefsLoaded = false;

function readStored(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    // Storage unavailable (e.g. private mode) — fall back to defaults.
    return null;
  }
}

function writeStored(key, value) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the in-memory value still applies.
  }
}

/** Load persisted volume/mute once; no-op in non-browser environments. */
function ensurePrefsLoaded() {
  if (prefsLoaded) return;
  prefsLoaded = true;
  const rawVolume = readStored(VOLUME_KEY);
  if (rawVolume !== null) {
    // Number(null) is 0, so only parse when a value was actually stored.
    const storedVolume = Number(rawVolume);
    if (Number.isFinite(storedVolume)) {
      masterVolume = Math.min(1, Math.max(0, storedVolume));
    }
  }
  muted = readStored(MUTED_KEY) === "1";
}

/** Set the master volume (0–1, clamped) and persist it. */
export function setSoundVolume(value) {
  ensurePrefsLoaded();
  masterVolume = Math.min(1, Math.max(0, Number(value) || 0));
  writeStored(VOLUME_KEY, String(masterVolume));
}

export function getSoundVolume() {
  ensurePrefsLoaded();
  return masterVolume;
}

/** Mute (or unmute) all sounds. Wired to the Settings volume UI (#32). */
export function setSoundMuted(value) {
  ensurePrefsLoaded();
  muted = !!value;
  writeStored(MUTED_KEY, muted ? "1" : "0");
}

export function isSoundMuted() {
  ensurePrefsLoaded();
  return muted;
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === "suspended") {
    // Resume is async and may fail before a user gesture; ignore it.
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function playTone({ frequency, startAt, duration, type = "sine", volume = 0.08 }) {
  ensurePrefsLoaded();
  // Mute and master volume are enforced here, the one place every
  // sound passes through — callers never check them themselves.
  const effectiveVolume = muted ? 0 : masterVolume * volume;
  if (effectiveVolume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const t0 = ctx.currentTime + startAt;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(effectiveVolume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(t0);
    oscillator.stop(t0 + duration + 0.05);
  } catch {
    // Audio is best-effort; never let a sound break the game.
  }
}

/** Sparkle arpeggio when a golden star spawns. */
export function playStarSpawnSound() {
  [880, 1174.66, 1567.98].forEach((frequency, index) => {
    playTone({ frequency, startAt: index * 0.07, duration: 0.35 });
  });
}

/** Chime when a star is clicked. Good = bright, bad = duller and lower. */
export function playStarClickSound(good) {
  if (good) {
    [1046.5, 1318.51, 1567.98].forEach((frequency, index) => {
      playTone({ frequency, startAt: index * 0.06, duration: 0.3 });
    });
  } else {
    [392, 311.13].forEach((frequency, index) => {
      playTone({
        frequency,
        startAt: index * 0.09,
        duration: 0.3,
        type: "triangle",
        volume: 0.06,
      });
    });
  }
}
