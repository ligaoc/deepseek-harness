/** Host registration for the browser output-completion chime preference. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  OUTPUT_ALERT_NAMESPACE, OutputAlertSettingsSchema,
} from './output-alert-settings.ts'

export {
  DEFAULT_ENABLED, ENABLED_FIELD, OUTPUT_ALERT_NAMESPACE,
  type OutputAlertSettings, OutputAlertSettingsSchema,
} from './output-alert-settings.ts'

const OUTPUT_ALERT_SCOPE = settingsNamespace(OUTPUT_ALERT_NAMESPACE)

/**
 * Register the durable output-alert section when the settings service is
 * composed.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(OUTPUT_ALERT_SCOPE, OutputAlertSettingsSchema)
  })
}
