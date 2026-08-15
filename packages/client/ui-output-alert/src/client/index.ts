/**
 * Browser half of the output-completion alert: registers the completion-chime
 * row into the settings General section (the feature owns its settings
 * surface) and plays a synthesized chime when a root session finishes while
 * the user is away (page unfocused) and the chime is enabled. One short blip
 * per completion; misses are accepted by design.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  DEFAULT_ENABLED, ENABLED_FIELD, OUTPUT_ALERT_NAMESPACE, type OutputAlertSettings,
} from '../output-alert-settings.ts'
import { createChimePlayer } from './chime.ts'
import { en, zh, type OutputAlertLocaleKey } from './locales.ts'
import { OutputAlertRow, type OutputAlertRowInjected } from './OutputAlertRow.tsx'
import { createOutputAlertRowStore } from './settings-store.ts'

export type { OutputAlertRowComponentProps, OutputAlertRowInjected } from './OutputAlertRow.tsx'
export type { OutputAlertRowState } from './settings-store.ts'
export type { OutputAlertLocaleKey } from './locales.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.output-alert'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The completion-chime settings row's copy. */
    'settings.output-alert': OutputAlertLocaleKey
  }
}

/** The away gate: only a page the user is not looking at gets the chime. */
function isAway(): boolean {
  return typeof document === 'undefined' || !document.hasFocus()
}

/** Current enabled flag from the bound scope (default until the Host section lands). */
function enabledOf(snapshot: SettingsScopeSnapshot<OutputAlertSettings>): boolean {
  return snapshot.value?.enabled ?? DEFAULT_ENABLED
}

/** Required services: settings transport plus slots/locale for the row and sessions for idle edges. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope', 'sessions']

/**
 * Client plugin body: register the completion-chime row and the idle-edge
 * chime listener.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<OutputAlertSettings>({ namespace: OUTPUT_ALERT_NAMESPACE })
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-output-alert: settings row dictionaries')

  const store = createOutputAlertRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (): void => {
    const snapshot = host.getSnapshot()
    bound?.sync(enabledOf(snapshot), snapshot.revision ?? -1)
  }
  ctx.effect(() => host.subscribe(sync), 'ui-output-alert: settings scope mirror')
  const injected = (actions: BoundActions<typeof store>): OutputAlertRowInjected => {
    bound = actions
    // Re-sync from the getter so no scope update is lost between registration
    // and first render (the store's revision guard drops stale duplicates).
    sync()
    return {
      setEnabled: (enabled) => { void host.set(ENABLED_FIELD, enabled) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'output-alert',
    order: 30,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, OutputAlertRow))

  // The completion chime: root-session idle edges gated on the away state and
  // the enabled flag. The edge arrives through the object-layer microtask
  // path, so a hidden tab still hears it; the chime itself is one short blip.
  const chime = createChimePlayer()
  ctx.effect(() => ctx.sessions.onRootSessionIdle(() => {
    if (isAway() && enabledOf(host.getSnapshot())) chime.play()
  }), 'ui-output-alert: completion chime listener')
}
