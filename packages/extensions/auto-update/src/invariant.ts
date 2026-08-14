/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-auto-update`.
 * @module @deepseek-ai/dsh-auto-update/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-auto-update'

/** Cordis companion plugin name. */
export const name = 'auto-update-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the pipeline's event/file mirror (settled outcome →
 * `auto-update/status` event → status.json) is exercised by unit tests of
 * `runUpdatePipeline` and the service's settle path; there is no independent
 * host-side event sequence or mutable data relation to assert here.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
