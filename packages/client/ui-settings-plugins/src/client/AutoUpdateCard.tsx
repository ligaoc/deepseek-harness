/**
 * The auto-update card: the Host's update status (phase, last check, commits
 * behind, conflict log) and a manual check trigger. Read-only status — the
 * configuration fields live in the section schema and are edited on the
 * settings document, not staged here.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AutoUpdateCardFace } from './auto-update-card-controller.ts'
import css from './PluginCard.module.css'

/** Props the renderer binds for the auto-update card. */
export type AutoUpdateCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<AutoUpdateCardFace>

/** One rendered status row: label and value. */
function StatusRow(props: { label: string; value: string }) {
  return (
    <p className={css.readOnly}>
      <span>{props.label}: </span>
      <span>{props.value}</span>
    </p>
  )
}

/**
 * Render the auto-update card.
 * @param props - locale copy, the card snapshot, and the check action.
 * @returns the card, or nothing until the Host answered once.
 */
export function AutoUpdateCard(props: AutoUpdateCardProps) {
  const { t } = props
  const state = props.useAutoUpdateCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null
  const snapshot = state.snapshot
  const lastCheck = snapshot?.lastCheckAt === undefined
    ? t('autoUpdateNever')
    : new Date(snapshot.lastCheckAt).toLocaleString()
  const behind = snapshot?.behind ?? 0
  const conflict = snapshot?.conflictLog
  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${props.t('autoUpdateTitle')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{props.t('autoUpdateTitle')}</span>
          <span className={css.description}>{props.t('autoUpdateDescription')}</span>
        </span>
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open
        ? (
          <div className={css.body}>
            <StatusRow label={t('autoUpdateStatus')} value={snapshot?.message ?? snapshot?.phase ?? '—'} />
            <StatusRow label={t('autoUpdateLastCheck')} value={lastCheck} />
            <StatusRow label={t('autoUpdateBehind')} value={String(behind)} />
            {snapshot?.phase === 'updated' ? (
              <p className={css.readOnly} role="status">{t('autoUpdateRestartHint')}</p>
            ) : null}
            {conflict !== undefined ? (
              <p className={css.failed} role="status">{t('autoUpdateConflictHint')}（{conflict}）</p>
            ) : null}
            <div className={css.footer}>
              <button
                type="button"
                className={css.save}
                disabled={state.checking}
                onClick={props.checkNow}
              >
                {t(state.checking ? 'autoUpdateChecking' : 'autoUpdateCheckNow')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
