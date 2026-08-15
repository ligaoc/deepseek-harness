/**
 * Completion-chime preference row registered into the General section item
 * slot (figma 501:30011 'Setting-Cell'): title + description + checkbox.
 * Registered by this package — the output-alert feature owns its own settings
 * surface.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createOutputAlertRowStore } from './settings-store.ts'
import css from './OutputAlertRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface OutputAlertRowInjected {
  /** Persist the completion-chime enabled flag. */
  setEnabled: (enabled: boolean) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type OutputAlertRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createOutputAlertRowStore>>
  & PropsLocale<'settings.output-alert'> & OutputAlertRowInjected

/**
 * Render the completion-chime row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function OutputAlertRow({ t, setEnabled, useStore }: OutputAlertRowComponentProps) {
  const enabled = useStore(s => s.enabled)
  return (
    <label className={css.row}>
      <span className={css.rowText}>
        <span className={css.title}>{t('title')}</span>
        <span className={css.description}>{t('description')}</span>
      </span>
      <input
        type="checkbox"
        className={css.toggle}
        checked={enabled}
        onChange={(event) => { setEnabled(event.currentTarget.checked) }}
      />
    </label>
  )
}
