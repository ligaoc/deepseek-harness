// @vitest-environment jsdom
/** OutputAlertRow behavior: title/description render, the checkbox reflects
 * the store, and toggling drives setEnabled. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { OutputAlertRow } from '../src/client/OutputAlertRow.tsx'
import type { OutputAlertRowComponentProps } from '../src/client/OutputAlertRow.tsx'
import { createOutputAlertRowStore } from '../src/client/settings-store.ts'

afterEach(cleanup)

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(enabled = true) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createOutputAlertRowStore().create()
  store.actions.sync(enabled, 0)
  const setEnabled = vi.fn()
  const props: OutputAlertRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => key === 'title' ? '会话完成提示音' : key === 'description' ? '离开页面时播放一声提示音' : key,
    setEnabled,
  }
  render(<OutputAlertRow {...props} />)
  return { store, setEnabled }
}

describe('OutputAlertRow', () => {
  it('shows the title and description and reflects the enabled state', () => {
    mount(true)
    expect(screen.getByText('会话完成提示音')).toBeDefined()
    expect(screen.getByText('离开页面时播放一声提示音')).toBeDefined()
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
  })

  it('toggles through setEnabled with the new checked value', () => {
    const b = mount(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(b.setEnabled).toHaveBeenCalledWith(false)
  })

  it('follows store changes; a stale revision is dropped', () => {
    const b = mount(false)
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
    // Equal revision: the mirror keeps its newer state.
    act(() => { b.store.actions.sync(true, 0) })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
    act(() => { b.store.actions.sync(true, 1) })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
  })
})
