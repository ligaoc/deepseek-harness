import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  OUTPUT_ALERT_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-ui-output-alert'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-output-alert host', () => {
  it('registers the durable enabled section with the Host settings lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(OUTPUT_ALERT_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ enabled: true }) // schema default materialized
    await ctx.settings.update(ns, { enabled: false })
    expect(ctx.settings.get(ns)).toEqual({ enabled: false })
    await expect(ctx.settings.update(ns, { enabled: 'yes' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('node-half apply tolerates a Host without settings', () => {
    apply(new Context())
  })
})
