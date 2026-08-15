/**
 * Completion-chime row slot store: a mirror of the output-alert settings
 * scope. The plugin's apply-world change listener is the only writer; the row
 * component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_ENABLED } from '../output-alert-settings.ts'

/** Store state mirrored from the settings scope. */
export interface OutputAlertRowState {
  /** Whether the away-completion chime plays. */
  enabled: boolean
  /** Settings-scope revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type OutputAlertRowActions = {
  sync: (draft: OutputAlertRowState, enabled: boolean, revision: number) => void
}

/**
 * Declares the completion-chime row state and write surface.
 * @returns the store handle.
 */
export function createOutputAlertRowStore(): EngineStoreHandle<OutputAlertRowState, OutputAlertRowActions> {
  return defineStore({
    init: (): OutputAlertRowState => ({ enabled: DEFAULT_ENABLED, revision: -1 }),
    actions: {
      sync: (d, enabled: boolean, revision: number) => {
        if (revision <= d.revision) return
        d.enabled = enabled
        d.revision = revision
      },
    },
  })
}
