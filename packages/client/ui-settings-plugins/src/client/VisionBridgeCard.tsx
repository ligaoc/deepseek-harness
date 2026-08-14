/**
 * The vision bridge's card: its endpoint, its vision model, the description
 * instruction, and the key — which is written through the credentials domain,
 * never into the settings section, so the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { VisionBridgeCardFace } from './vision-bridge-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the vision bridge card. */
export type VisionBridgeCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<VisionBridgeCardFace>

/**
 * Render the vision bridge card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function VisionBridgeCard(props: VisionBridgeCardProps) {
  const { t } = props
  const state = props.useVisionBridgeCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="visionTitle"
      descriptionKey="visionDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-vision-key"
        label={t('visionApiKey')}
        hint={t('visionApiKeyHint')}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; they are separate stores with separate refusals.
        // Its own writability is what disables this control — a key sourced
        // from the process environment cannot be written from here.
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('visionApiKeySet') : t('visionApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-vision-endpoint"
        label={t('visionBaseUrl')}
        hint={t('visionBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="plugin-config-vision-model"
        label={t('visionModel')}
        hint={t('visionModelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.model}
        onEdit={(text) => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
      <ValueField
        id="plugin-config-vision-prompt"
        label={t('visionPrompt')}
        hint={t('visionPromptHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.prompt}
        onEdit={(text) => { props.edit('prompt', text) }}
        onReset={() => { props.resetField('prompt') }}
      />
    </PluginCard>
  )
}
