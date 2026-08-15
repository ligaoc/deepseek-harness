// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-output-alert'
import { apply as clientApply, inject } from '@deepseek-ai/dsh-client-ui-output-alert/client'
import * as OutputAlertInvariant from '@deepseek-ai/dsh-client-ui-output-alert/invariant'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(OutputAlertInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply tolerates a Host without settings', () => {
    nodeApply(new Context())
  })

  it('client apply mounts the chime listener and the settings row', async () => {
    // The feature registers its own settings row, hence the slots edge.
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope', 'sessions'])
    const ctx = new Context()
    new SlotRegistry(ctx)
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    ctx.provide('locale', { register: () => () => {} } as never)
    const idleListeners = new Set<(sessionId: string) => void>()
    ctx.provide('sessions', {
      onRootSessionIdle: (listener: (sessionId: string) => void) => {
        idleListeners.add(listener)
        return () => { idleListeners.delete(listener) }
      },
    } as never)
    const fiber = ctx.plugin({ inject, apply: clientApply })
    await fiber.await()
    // A focused page must not chime (jsdom reports unfocused by default).
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const starts: number[] = []
    vi.stubGlobal('AudioContext', fakeAudioContext(starts))
    for (const listener of [...idleListeners]) listener('s1')
    expect(starts).toEqual([])
    // Away (unfocused) with the default-enabled flag must chime.
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    for (const listener of [...idleListeners]) listener('s1')
    expect(starts.length).toBe(2)
    await fiber.dispose()
  })
})

/** Minimal running AudioContext recording oscillator start times. */
function fakeAudioContext(starts: number[]) {
  return class {
    readonly state = 'running'
    readonly currentTime = 0
    readonly destination = {}
    resume(): Promise<void> { return Promise.resolve() }
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
}
