/**
 * The auto-update card's state: the Host's update snapshot, projected onto
 * the card through a snapshot store, with the check trigger.
 */

import type { AutoUpdateSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Namespace of the auto-update plugin. Spelled here rather than imported: a
 * client package must not depend on a Host package.
 */
export const AUTO_UPDATE_NS = 'auto-update'

/** One Remote call's failure as the carrier reported it. */
export interface AutoUpdateRemoteFailure {
  readonly code: string
  readonly message: string
  readonly details: object
}

/** The Remote face the card needs; supplied by the plugin apply closure. */
export interface AutoUpdateRemoteFace {
  /** Read the Host's current update snapshot, wrapped in the Remote result. */
  status: () => Promise<
    { readonly ok: true; readonly value: AutoUpdateSnapshot }
    | { readonly ok: false; readonly error: AutoUpdateRemoteFailure }
  >
  /** Trigger one update run now. */
  check: () => Promise<unknown>
  /** Subscribe to Host `auto-update/status` events. */
  onStatus: (listener: (snapshot: AutoUpdateSnapshot) => void) => () => void
}

/** What the auto-update card renders. */
export interface AutoUpdateCardState {
  /** False until the Host answered the status query once. */
  available: boolean
  /** The latest Host snapshot; null before the first answer. */
  snapshot: AutoUpdateSnapshot | null
  /** True while a manual check is crossing the wire. */
  checking: boolean
}

/** The registration-side face the auto-update card's slot entry injects. */
export interface AutoUpdateCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useAutoUpdateCard. */
    autoUpdateCard: SnapshotStore<AutoUpdateCardState>
  }
  /** Trigger one update run now. */
  checkNow: () => void
}

/** Bridges the Host autoUpdate Remote namespace onto the card. */
export class AutoUpdateCardController {
  private readonly store: SnapshotStore<AutoUpdateCardState>
  private snapshot: AutoUpdateSnapshot | null = null
  private checking = false
  private available = false

  /**
   * @param remote - the Host Remote face the plugin apply closure supplies.
   */
  constructor(private readonly remote: AutoUpdateRemoteFace) {
    this.store = createSnapshotStore<AutoUpdateCardState>({
      available: false,
      snapshot: null,
      checking: false,
    })
    void this.read()
  }

  /**
   * Subscribe to Host status events. Called once from the plugin apply; the
   * returned disposer rides the owning fiber.
   * @returns the event subscription's disposer.
   */
  subscribe(): () => void {
    return this.remote.onStatus((snapshot) => {
      this.snapshot = snapshot
      this.available = true
      this.publish()
    })
  }

  /** Trigger one update run; in-flight runs are not duplicated. */
  async checkNow(): Promise<void> {
    if (this.checking) return
    this.checking = true
    this.publish()
    try {
      // The settled outcome arrives through the status event; the answer
      // itself is not projected (the pipeline can take minutes).
      await this.remote.check()
    } catch (_checkFailure) {
      // The Host is the only authority on the outcome; a failed trigger
      // settles through the status event or the next read.
    } finally {
      this.checking = false
      this.publish()
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot store and its check action.
   */
  inject(): AutoUpdateCardFace {
    return {
      hooks: { autoUpdateCard: this.store },
      checkNow: () => { void this.checkNow() },
    }
  }

  /** Read the Host snapshot once, marking the card available on success. */
  private async read(): Promise<void> {
    try {
      const result = await this.remote.status()
      if (result.ok) {
        this.snapshot = result.value
        this.available = true
      }
    } catch (_statusReadFailure) {
      // The Remote namespace may not be mounted yet; a later status event
      // flips the card available.
    }
    this.publish()
  }

  private publish(): void {
    this.store.set({
      available: this.available,
      snapshot: this.snapshot,
      checking: this.checking,
    })
  }
}
