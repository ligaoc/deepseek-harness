/**
 * The auto-update card controller: the Host Remote face projected onto the
 * card's snapshot store, the status-event subscription, and the deduplicated
 * check trigger.
 */

import { describe, expect, it, vi } from 'vitest'
import type { AutoUpdateSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  AutoUpdateCardController,
  type AutoUpdateRemoteFace,
} from '../src/client/auto-update-card-controller.ts'

const SNAPSHOT: AutoUpdateSnapshot = { phase: 'idle', enabled: true, behind: 0, message: '已是最新' }
const UPDATED: AutoUpdateSnapshot = { phase: 'updated', enabled: true, behind: 3, head: 'abc123', message: '更新完成' }

/** A remote face whose status answer and events the test drives by hand. */
function remote(overrides: Partial<AutoUpdateRemoteFace> = {}) {
  const listeners: Array<(snapshot: AutoUpdateSnapshot) => void> = []
  const check = vi.fn(() => Promise.resolve({}))
  const emit = (snapshot: AutoUpdateSnapshot): void => {
    for (const listener of [...listeners]) listener(snapshot)
  }
  const base: AutoUpdateRemoteFace = {
    status: vi.fn(() => Promise.resolve({ ok: true as const, value: SNAPSHOT })),
    check,
    onStatus: (listener) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }
  return { ...base, ...overrides, check, emit }
}

describe('AutoUpdateCardController', () => {
  it('publishes the Host snapshot once the status read lands', async () => {
    const subject = new AutoUpdateCardController(remote())
    const state = () => subject.inject().hooks.autoUpdateCard.getSnapshot()
    await vi.waitFor(() => { expect(state().available).toBe(true) })

    expect(state().snapshot).toEqual(SNAPSHOT)
    expect(state().checking).toBe(false)
  })

  it('stays unavailable while the Host refuses the status read', async () => {
    const subject = new AutoUpdateCardController(remote({
      status: vi.fn(() => Promise.resolve({
        ok: false as const,
        error: { code: 'invocation-unavailable', message: 'no active Remote', details: {} },
      })),
    }))
    const state = () => subject.inject().hooks.autoUpdateCard.getSnapshot()
    await vi.waitFor(() => { expect(subject.inject().hooks.autoUpdateCard.getSnapshot().available).toBe(false) })
    expect(state().snapshot).toBeNull()
  })

  it('stays unavailable when the status read rejects', async () => {
    const subject = new AutoUpdateCardController(remote({
      status: vi.fn(() => Promise.reject(new Error('offline'))),
    }))
    await vi.waitFor(() => { expect(subject.inject().hooks.autoUpdateCard.getSnapshot().available).toBe(false) })
  })

  it('re-projects Host status events onto the card snapshot', async () => {
    const host = remote()
    const subject = new AutoUpdateCardController(host)
    const dispose = subject.subscribe()
    host.emit(UPDATED)
    expect(subject.inject().hooks.autoUpdateCard.getSnapshot().snapshot).toEqual(UPDATED)

    dispose()
    host.emit(SNAPSHOT)
    expect(subject.inject().hooks.autoUpdateCard.getSnapshot().snapshot).toEqual(UPDATED)
  })

  it('triggers one check and deduplicates in-flight triggers', async () => {
    const host = remote()
    const subject = new AutoUpdateCardController(host)
    const state = () => subject.inject().hooks.autoUpdateCard.getSnapshot()
    await vi.waitFor(() => { expect(state().available).toBe(true) })

    let release!: () => void
    host.check.mockImplementation(() => new Promise((resolve) => { release = () => resolve({}) }))
    const first = subject.checkNow()
    const second = subject.checkNow()
    expect(state().checking).toBe(true)
    expect(host.check).toHaveBeenCalledTimes(1)

    release()
    await Promise.all([first, second])
    expect(state().checking).toBe(false)
  })

  it('settles the checking flag when the trigger rejects', async () => {
    const host = remote()
    const subject = new AutoUpdateCardController(host)
    const state = () => subject.inject().hooks.autoUpdateCard.getSnapshot()
    await vi.waitFor(() => { expect(state().available).toBe(true) })

    host.check.mockImplementation(() => Promise.reject(new Error('offline')))
    await subject.checkNow()

    expect(state().checking).toBe(false)
  })

  it('exposes the store and the check action through the inject face', async () => {
    const host = remote()
    const subject = new AutoUpdateCardController(host)
    const face = subject.inject()
    expect(face.hooks.autoUpdateCard).toBeDefined()
    expect(typeof face.checkNow).toBe('function')

    face.checkNow()
    await vi.waitFor(() => { expect(host.check).toHaveBeenCalledTimes(1) })
  })
})
