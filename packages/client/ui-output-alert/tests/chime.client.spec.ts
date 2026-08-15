// @vitest-environment jsdom
/** ChimePlayer behavior: gesture arming, the suspend/unavailable skips, the
 * webkit fallback, and the two-tone synthesis. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChimePlayer } from '../src/client/chime.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A controllable fake AudioContext recording oscillator start times. */
function installAudio(state: 'running' | 'suspended' = 'running') {
  const starts: number[] = []
  const fake = { state }
  const resume = vi.fn(async () => { fake.state = 'running' })
  class FakeAudioContext {
    state = state
    readonly currentTime = 0
    readonly destination = {}
    resume = resume
    createOscillator() {
      const gain = this.createGain()
      return {
        type: '',
        frequency: { value: 0 },
        connect: () => gain,
        start: (at: number) => { starts.push(at) },
        stop: () => {},
      }
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      }
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
  return { starts, resume, ctor: FakeAudioContext }
}

describe('chime player', () => {
  it('no-ops without an AudioContext global', () => {
    const player = createChimePlayer()
    player.play()
  })

  it('plays two tones when armed and running', () => {
    const { starts } = installAudio()
    const player = createChimePlayer()
    player.play()
    expect(starts).toEqual([0, 0.16])
  })

  it('falls back to webkitAudioContext', () => {
    const { starts, ctor } = installAudio()
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', ctor)
    const player = createChimePlayer()
    player.play()
    expect(starts.length).toBe(2)
  })
})
