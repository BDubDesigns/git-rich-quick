/**
 * Tiny synthesized sound effects for the golden star (issue #33).
 *
 * No audio assets: the chime is a short WebAudio oscillator arpeggio.
 * There is no volume setting yet (issue #32 owns Settings volume), so
 * this module holds a module-level mute flag that #32 will wire to the
 * Settings UI. Sounds are best-effort: if WebAudio is unavailable or
 * the browser blocks audio before a user gesture, they no-op instead
 * of throwing.
 */

let muted = false;
let audioContext = null;

/** Mute (or unmute) all star sounds. Wired to Settings volume by #32. */
export function setSoundMuted(value) {
  muted = !!value;
}

export function isSoundMuted() {
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
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const t0 = ctx.currentTime + startAt;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
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
  if (muted) return;
  [880, 1174.66, 1567.98].forEach((frequency, index) => {
    playTone({ frequency, startAt: index * 0.07, duration: 0.35 });
  });
}

/** Chime when a star is clicked. Good = bright, bad = duller and lower. */
export function playStarClickSound(good) {
  if (muted) return;
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
