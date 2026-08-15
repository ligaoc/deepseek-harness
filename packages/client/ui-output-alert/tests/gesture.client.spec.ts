// @vitest-environment jsdom
/** Gesture arming in isolation: one player, one document, so the dispatch
 * counts are exact (a shared document across files would let earlier players'
 * listeners pollute the counts). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChimePlayer } from '../src/client/chime.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chime player gestures', () => {
  it('skips while the context is suspended (unarmed) and arms on the first gesture', () => {
    const starts: number[] = []
    const resume = vi.fn(async function (this: { state: string }) { this.state = 'running' })
    class FakeAudioContext {
      state = 'suspended'
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
          gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
          connect: () => {},
        }
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)

    const player = createChimePlayer()
    player.play()
    expect(starts).toEqual([])
    // Dispatch on a child so the capture-phase listener on document fires
    // exactly once per event (an at-target dispatch can double-fire). The
    // first gesture arms the context; the second finds it already running.
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    document.body.dispatchEvent(new Event('keydown', { bubbles: true }))
    expect(resume).toHaveBeenCalledTimes(1)
    player.play()
    expect(starts).toEqual([0, 0.16])
  })
})
