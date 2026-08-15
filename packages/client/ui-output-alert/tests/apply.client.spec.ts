/** ui-output-alert apply wiring: row registration into the General section,
 * scope projection into the row store, face writes routed to the Host
 * settings transport, and the completion chime gated on the away state and
 * the enabled flag (node env: no document, so "away" holds). */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply, inject, SETTINGS_NS,
} from '@deepseek-ai/dsh-client-ui-output-alert/client'
import type { OutputAlertRowInjected } from '@deepseek-ai/dsh-client-ui-output-alert/client'
import { OUTPUT_ALERT_NAMESPACE, OutputAlertSettingsSchema } from '../src/output-alert-settings.ts'
import { en as enDict, zh as zhDict } from '../src/client/locales.ts'
import { OutputAlertRow } from '../src/client/OutputAlertRow.tsx'
import type { createOutputAlertRowStore } from '../src/client/settings-store.ts'

const SLOT = 'settings.general.item'

async function bench(gateDescribe?: Promise<void>) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  let enabled: boolean | undefined
  let revision = 0
  const namespace = () => ({
    ns: OUTPUT_ALERT_NAMESPACE,
    schema: OutputAlertSettingsSchema.toJSON(),
    value: enabled === undefined ? {} : { enabled },
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  const describe = vi.fn(async () => {
    if (gateDescribe !== undefined) await gateDescribe
    return {
      rpcId: 'alert-describe' as never,
      result: {
        ok: true as const,
        value: { writable: true, hasDocument: true, namespaces: [namespace()] },
      },
    }
  })
  const mutate = vi.fn(async (request: { ops: { value: unknown }[] }) => {
    enabled = request.ops[0]!.value as boolean
    revision += 1
    return {
      rpcId: 'alert-mutate' as never,
      result: { ok: true as const, value: namespace() },
    }
  })
  ctx.provide('connection', { api: { settings: { describe, mutate } }, isLoopback: true } as never)
  // The settings transport and the forwarded-event port the plugin injects.
  new TestRemote(ctx)
  await ctx.plugin(SettingsScopeBinder).await()
  // The sessions face: only the idle-edge seat is exercised here.
  const idleListeners = new Set<(sessionId: string) => void>()
  ctx.provide('sessions', {
    onRootSessionIdle: (listener: (sessionId: string) => void) => {
      idleListeners.add(listener)
      return () => { idleListeners.delete(listener) }
    },
  } as never)
  const register = vi.fn(() => () => {})
  ctx.provide('locale', { register } as never)
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, describe, mutate, idleListeners, register,
    setHostEnabled: (next: boolean | undefined) => { enabled = next; revision += 1 },
  }
}

/** Stand in for the settings shell: declare the General item slot from root. */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography: bake a real instance from the
 * declared handle and hand its actions to the entry's inject factory. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === OutputAlertRow)!
  const handle = entry.store as ReturnType<typeof createOutputAlertRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => OutputAlertRowInjected)(instance.actions)
  return { entry, instance, face }
}

/** A running AudioContext recording oscillator starts (node env has no DOM audio). */
function stubAudioContext() {
  const starts: number[] = []
  class FakeAudioContext {
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
  vi.stubGlobal('AudioContext', FakeAudioContext)
  return starts
}

function fireIdle(bench: { idleListeners: Set<(id: string) => void> }, id = 's1'): void {
  for (const listener of [...bench.idleListeners]) listener(id)
}

describe('ui-output-alert apply', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('declares the services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope', 'sessions'])
  })

  it('registers the row with dictionaries and the settings namespace (declaration before or after apply)', async () => {
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.register).toHaveBeenCalledWith(SETTINGS_NS, { zh: zhDict, en: enDict })
    const entry = before.slots.entries(SLOT).find(e => e.component === OutputAlertRow)!
    expect(entry.options).toMatchObject({ id: 'output-alert', order: 30 })
    expect(entry.locale).toBe(SETTINGS_NS)

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SLOT).some(e => e.component === OutputAlertRow)).toBe(true)
  })

  it('projects scope snapshots into the row store and routes face writes back', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { instance, face } = faceOf(b.slots)
    // The inject-time re-sync sealed the init window: the default is current.
    expect(instance.getSnapshot().enabled).toBe(true)
    face.setEnabled(false)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(instance.getSnapshot().enabled).toBe(false) })
  })

  it('syncs against the loading window before the first Host view lands', async () => {
    // Annotated binding (not withResolvers<void>()): the tests lint layer runs
    // no-invalid-void-type with default options, which rejects the explicit
    // type argument in call position but accepts the inferred form.
    const release: PromiseWithResolvers<void> = Promise.withResolvers()
    const b = await bench(release.promise)
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { instance } = faceOf(b.slots)
    // The loading window: no revision yet, the mirror stays at its init default.
    expect(instance.getSnapshot().enabled).toBe(true)
    expect(instance.getSnapshot().revision).toBe(-1)
    release.resolve()
    await vi.waitFor(() => { expect(instance.getSnapshot().revision).toBe(0) })
  })

  it('loads and refreshes the explicit Host preference after nonblocking activation', async () => {
    const b = await bench()
    b.setHostEnabled(false)
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { instance } = faceOf(b.slots)
    await vi.waitFor(() => { expect(instance.getSnapshot().enabled).toBe(false) })
    b.setHostEnabled(true)
    b.ctx.remote.$dispatch('settings/document-updated', [OUTPUT_ALERT_NAMESPACE, 0])
    await vi.waitFor(() => { expect(instance.getSnapshot().enabled).toBe(true) })
  })

  it('chimes on each root-session idle edge only while enabled and away', async () => {
    const starts = stubAudioContext()
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { instance } = faceOf(b.slots)
    // Node env: no document, so the away gate holds.
    fireIdle(b)
    expect(starts.length).toBe(2)
    fireIdle(b) // one chime per edge
    expect(starts.length).toBe(4)

    // Disabled: the edge is ignored.
    b.setHostEnabled(false)
    b.ctx.remote.$dispatch('settings/document-updated', [OUTPUT_ALERT_NAMESPACE, 0])
    await vi.waitFor(() => { expect(instance.getSnapshot().enabled).toBe(false) })
    fireIdle(b)
    expect(starts.length).toBe(4)
  })

  it('teardown removes the row and the chime listener; teardown without a declaration is quiet', async () => {
    const starts = stubAudioContext()
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    fireIdle(b)
    expect(starts).toEqual([])

    // Never-declared bench: the effect disposer's dispose arm stays undefined.
    const quiet = await bench()
    const f2 = quiet.ctx.plugin({ inject: [...inject], apply })
    await f2.await()
    await f2.dispose()
    expect(quiet.slots.entries(SLOT)).toHaveLength(0)
  })
})
