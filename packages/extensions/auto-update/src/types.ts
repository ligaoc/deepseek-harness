/**
 * Durable auto-update vocabulary and the service's Cordis event declaration,
 * shared with type-only consumers. Client-safe: nothing here reaches a
 * Host-only symbol, so a Client compilation face reads the same
 * `auto-update/status` signature the Host emits.
 *
 * @module @deepseek-ai/dsh-auto-update/types
 */

/** One live stage of the update pipeline. */
export type AutoUpdatePhase =
  | 'idle'
  | 'checking'
  | 'merging'
  | 'installing'
  | 'building'
  | 'testing'
  | 'pushing'
  | 'updated'
  | 'conflict'
  | 'failed'
  | 'skipped'

/**
 * Latest update state, as surfaced to the web GUI: a phase plus the facts
 * that phase carries. Emitted on every transition and returned by the
 * `autoUpdate/status` Remote method.
 */
export interface AutoUpdateSnapshot {
  /** The pipeline's current or last settled stage. */
  readonly phase: AutoUpdatePhase
  /** Whether scheduled checks are enabled right now. */
  readonly enabled: boolean
  /** Epoch ms of the last check attempt; absent before the first run. */
  readonly lastCheckAt?: number
  /** Commits the local branch was behind the remote branch at last fetch. */
  readonly behind: number
  /** HEAD short sha after a successful update. */
  readonly head?: string
  /** Human-readable detail for the current phase (Chinese product copy). */
  readonly message?: string
  /** Repo-relative path of the last conflict diff snapshot, when one exists. */
  readonly conflictLog?: string
}

/** A settled run of the update pipeline. */
export type UpdateOutcome =
  | { readonly kind: 'up-to-date'; readonly behind: 0 }
  | {
    readonly kind: 'skipped'
    readonly reason: 'wrong-branch' | 'dirty' | 'disabled'
    readonly message: string
  }
  | { readonly kind: 'updated'; readonly behind: number; readonly head: string }
  | {
    readonly kind: 'conflict'
    readonly behind: number
    readonly logPath: string
    readonly detail: string
  }
  | {
    readonly kind: 'failed'
    readonly stage: 'merge' | 'install' | 'build' | 'test' | 'push'
    readonly message: string
  }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The update pipeline moved to a new phase. Emitted after each transition
     * so GUI surfaces can re-project the current snapshot; the same payload
     * the `autoUpdate/status` Remote method returns.
     * @mode emit
     */
    'auto-update/status'(snapshot: AutoUpdateSnapshot): void
  }
}
