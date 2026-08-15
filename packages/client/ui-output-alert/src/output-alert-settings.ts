/** Durable output-alert preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the output-alert plugin. */
export const OUTPUT_ALERT_NAMESPACE = 'ui-output-alert'

/** Field carrying the completion-chime enabled flag. */
export const ENABLED_FIELD = 'enabled'

/** Default when the user-settings document has no override. */
export const DEFAULT_ENABLED = true

/** Durable section shared by the Host schema and the browser scope. */
export interface OutputAlertSettings {
  /** Whether the away-completion chime plays. */
  enabled: boolean
}

/** Durable output-alert schema; also the wire envelope the browser scope validates against. */
export const OutputAlertSettingsSchema: z<OutputAlertSettings> = z.object({
  [ENABLED_FIELD]: z.boolean().default(DEFAULT_ENABLED),
})
