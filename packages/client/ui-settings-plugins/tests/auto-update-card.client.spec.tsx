// @vitest-environment jsdom
/**
 * The auto-update card: renders nothing until the Host answered, then shows
 * the status facts (phase message, last check, commits behind), the restart
 * and conflict hints, and the check trigger.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutoUpdateSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { AutoUpdateCard, type AutoUpdateCardProps } from '../src/client/AutoUpdateCard.tsx'
import type { AutoUpdateCardState } from '../src/client/auto-update-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** Drive the card with a live snapshot store, mirroring the renderer binding. */
function renderCard(state: AutoUpdateCardState, checkNow = vi.fn()) {
  const store = createSnapshotStore<AutoUpdateCardState>(state)
  const props = {
    t: (key: keyof typeof en) => en[key],
    useAutoUpdateCard: (selector: (snapshot: AutoUpdateCardState) => unknown) =>
      useSyncExternalStore(
        listener => store.subscribe(listener),
        () => selector(store.getSnapshot()),
      ),
    checkNow,
  } as unknown as AutoUpdateCardProps
  const view = render(<AutoUpdateCard {...props} />)
  return { view, store, checkNow }
}

/** Expand the collapsed card so its status body renders. */
function openCard(): void {
  fireEvent.click(screen.getByRole('button', { name: /Auto update/ }))
}

const IDLE: AutoUpdateSnapshot = { phase: 'idle', enabled: true, behind: 0, message: '已是最新' }
const UPDATED: AutoUpdateSnapshot = {
  phase: 'updated',
  enabled: true,
  behind: 3,
  head: 'abc123',
  lastCheckAt: 1_700_000_000_000,
  message: '更新完成，请重启应用生效（abc123）',
}
const CONFLICT: AutoUpdateSnapshot = {
  phase: 'conflict',
  enabled: true,
  behind: 2,
  conflictLog: 'update/conflict-20260101-000000.diff',
  message: '合并冲突，已回滚',
}

describe('AutoUpdateCard', () => {
  it('renders nothing until the Host answered once', () => {
    const { view } = renderCard({ available: false, snapshot: null, checking: false })
    expect(view.container.textContent).toBe('')
  })

  it('renders the status facts from the snapshot', () => {
    renderCard({ available: true, snapshot: UPDATED, checking: false })
    openCard()
    expect(screen.getByText('Auto update')).toBeTruthy()
    expect(screen.getByText(/更新完成，请重启应用生效/)).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText(new Date(1_700_000_000_000).toLocaleString())).toBeTruthy()
  })

  it('reports never when no check ran yet', () => {
    renderCard({ available: true, snapshot: IDLE, checking: false })
    openCard()
    expect(screen.getByText('Never')).toBeTruthy()
    expect(screen.queryByText(/Restart the app/)).toBeNull()
  })

  it('shows the conflict hint with the snapshot path', () => {
    renderCard({ available: true, snapshot: CONFLICT, checking: false })
    openCard()
    expect(screen.getByText(/update\/CONFLICT_PROMPT\.md/)).toBeTruthy()
    expect(screen.getByText(/update\/conflict-20260101-000000\.diff/)).toBeTruthy()
  })

  it('falls back to the phase and zero when facts are absent', () => {
    renderCard({
      available: true,
      // The Host always sends `behind`; the fallbacks exist for defensive reads.
      snapshot: { phase: 'checking', enabled: true } as unknown as AutoUpdateSnapshot,
      checking: false,
    })
    openCard()
    expect(screen.getByText('checking')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.getByText('Never')).toBeTruthy()
  })

  it('renders placeholders while no snapshot has arrived', () => {
    renderCard({ available: true, snapshot: null, checking: false })
    openCard()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
  })

  it('triggers a check and disables the button while one is in flight', () => {
    const checkNow = vi.fn()
    const { store } = renderCard({ available: true, snapshot: IDLE, checking: false }, checkNow)
    openCard()

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(checkNow).toHaveBeenCalledTimes(1)

    act(() => { store.set({ available: true, snapshot: IDLE, checking: true }) })
    const button = screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
