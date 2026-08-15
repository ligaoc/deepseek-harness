/**
 * Synthesized completion chime: two soft sine blips, no audio asset. The
 * AudioContext is created lazily and armed on the first page gesture
 * (autoplay policy); once armed it keeps playing in background tabs, which is
 * exactly the away state the chime is for. A chime attempted while the
 * context is still suspended is skipped — the "missed chime is accepted"
 * contract of the feature.
 */

/** Peak gain of one blip (fixed per the product decision; no volume setting).
 *  Chosen audible on laptop speakers while staying soft — the earlier 0.15
 *  peak was inaudible in practice. */
const CHIME_GAIN = 0.35

/** AudioContext construction surface (the browser global; stubbed in tests). */
type AudioContextCtor = typeof AudioContext

/** A chime player: plays one short two-tone blip when armed. */
export interface ChimePlayer {
  /** Play one completion blip; no-ops when audio is unavailable or suspended. */
  play(): void
}

/**
 * Create a chime player bound to the current page.
 * @returns the player.
 */
export function createChimePlayer(): ChimePlayer {
  let context: AudioContext | null = null
  const acquire = (): AudioContext | null => {
    if (context !== null) return context
    // The DOM lib types AudioContext as always present; browsers without it
    // (and node/jsdom) expose neither global, hence the optional-typed holder.
    const holder = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
    const Ctor = holder.AudioContext ?? holder.webkitAudioContext
    if (Ctor === undefined) return null
    context = new Ctor()
    return context
  }
  const arm = (): void => {
    const ctx = acquire()
    if (ctx !== null && ctx.state === 'suspended') void ctx.resume()
  }
  // Autoplay policy: a context created outside a gesture starts suspended and
  // cannot resume without one. The first pointer/key interaction with the
  // page (nearly always the prompt send that starts the session) arms it;
  // later edge chimes then play while the tab is hidden.
  if (typeof document !== 'undefined') {
    const gesture = (): void => { arm() }
    document.addEventListener('pointerdown', gesture, { capture: true, once: true })
    document.addEventListener('keydown', gesture, { capture: true, once: true })
  }
  return {
    play(): void {
      const ctx = acquire()
      // Unarmed or policy-suspended: skip (a missed chime is accepted).
      if (ctx === null || ctx.state === 'suspended') return
      const now = ctx.currentTime
      const tone = (frequency: number, at: number, duration: number): void => {
        const oscillator = ctx.createOscillator()
        const gain = ctx.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.exponentialRampToValueAtTime(CHIME_GAIN, at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
        oscillator.connect(gain)
        gain.connect(ctx.destination)
        oscillator.start(at)
        oscillator.stop(at + duration + 0.05)
      }
      tone(880, now, 0.18)
      tone(660, now + 0.16, 0.22)
    },
  }
}
