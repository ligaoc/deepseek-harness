/**
 * `@deepseek-ai/dsh-auto-update`: in-app upstream sync. A service plugin that
 * fetches the upstream remote on a schedule (startup check + daily interval),
 * merges its branch into the custom branch, runs install/build/test gates,
 * rolls back on any gate failure, snapshots merge conflicts before aborting,
 * and pushes the merged branch to the fork. The web GUI reads status and
 * triggers checks through the `autoUpdate` Remote namespace and receives
 * `auto-update/status` events.
 *
 * The plugin registers the `auto-update` user-settings section with the same
 * Config schema, so a `auto-update:` section in the user settings document —
 * edited from the web Plugins page — overrides any field without a restart.
 *
 * @module @deepseek-ai/dsh-auto-update
 */

import type { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { runUpdatePipeline, type Exec, type ExecResult } from './run.ts'
import type { AutoUpdatePhase, AutoUpdateSnapshot, UpdateOutcome } from './types.ts'

/** Settings namespace edited by the web Plugins page. */
export const AUTO_UPDATE_SETTINGS_NAMESPACE = settingsNamespace('auto-update')

/** Plugin config, also the settings-section schema. */
export interface Config {
  /** Master switch for scheduled checks. Defaults to true. */
  enabled?: boolean
  /** Hours between scheduled scans while the app runs. Defaults to 24. */
  intervalHours?: number
  /** Remote name to fetch. Defaults to `upstream`. */
  remote?: string
  /** Local branch the remote branch is merged into. Defaults to `custom`. */
  branch?: string
  /**
   * Merge `origin/<branch>` into the local branch before merging upstream, so
   * multi-machine forks converge (each machine pulls the other's pushed
   * commits first). Defaults to true.
   */
  pullFork?: boolean
  /** Push the merged branch to `origin` after all gates pass. Defaults to true. */
  autoPush?: boolean
  /** Run `pnpm install` as a gate. Defaults to true. */
  gateInstall?: boolean
  /** Run `pnpm run build` as a gate. Defaults to true. */
  gateBuild?: boolean
  /** Run `pnpm run test` as a gate. Defaults to true. */
  gateTest?: boolean
  /** Check for updates shortly after app start. Defaults to true. */
  checkOnStartup?: boolean
  /** Delay before the startup check. Defaults to 20 seconds. */
  startupDelaySeconds?: number
  /** Repository root; empty means the app's working directory. */
  repoDir?: string
  /** Directory for conflict snapshots and status.json; defaults to `<repoDir>/update`. */
  logDir?: string
  /** Optional proxy URL for git and pnpm; empty means direct connection. */
  proxyUrl?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  intervalHours: z.number().default(24),
  remote: z.string().default('upstream'),
  branch: z.string().default('custom'),
  pullFork: z.boolean().default(true),
  autoPush: z.boolean().default(true),
  gateInstall: z.boolean().default(true),
  gateBuild: z.boolean().default(true),
  gateTest: z.boolean().default(true),
  checkOnStartup: z.boolean().default(true),
  startupDelaySeconds: z.number().default(20),
  repoDir: z.string().default(''),
  logDir: z.string().default(''),
  proxyUrl: z.string().default(''),
})

/** Fully resolved pipeline inputs derived from the authoritative config. */
interface ResolvedOptions {
  readonly enabled: boolean
  readonly intervalHours: number
  readonly remote: string
  readonly branch: string
  readonly pullFork: boolean
  readonly autoPush: boolean
  readonly gateInstall: boolean
  readonly gateBuild: boolean
  readonly gateTest: boolean
  readonly checkOnStartup: boolean
  readonly startupDelaySeconds: number
  readonly repoDir: string
  readonly logDir: string
  readonly proxyUrl: string
}

/**
 * Project one config section into the resolved facts the service runs with.
 * @param config - the currently authoritative section.
 * @returns resolved facts for the next scheduled or manual run.
 */
function resolveOptions(config: Partial<Config>): ResolvedOptions {
  const repoDir = config.repoDir !== undefined && config.repoDir !== '' ? config.repoDir : process.cwd()
  return {
    enabled: config.enabled ?? true,
    intervalHours: config.intervalHours ?? 24,
    remote: config.remote ?? 'upstream',
    branch: config.branch ?? 'custom',
    pullFork: config.pullFork ?? true,
    autoPush: config.autoPush ?? true,
    gateInstall: config.gateInstall ?? true,
    gateBuild: config.gateBuild ?? true,
    gateTest: config.gateTest ?? true,
    checkOnStartup: config.checkOnStartup ?? true,
    startupDelaySeconds: config.startupDelaySeconds ?? 20,
    repoDir,
    logDir: config.logDir !== undefined && config.logDir !== '' ? config.logDir : join(repoDir, 'update'),
    proxyUrl: config.proxyUrl ?? '',
  }
}

/** Run one external command, settling with its output instead of throwing. */
const execCommand: Exec = (cmd, args, opts) => new Promise<ExecResult>((resolve) => {
  execFile(cmd, [...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    timeout: opts.timeoutMs,
    signal: opts.signal,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (error === null) {
      resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) })
      return
    }
    const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1
    resolve({ code, stdout: String(stdout), stderr: String(stderr) })
  })
})

/**
 * The in-app upstream sync service: status query and check trigger for the
 * web GUI (Remote namespace `autoUpdate`), plus the startup/daily schedule.
 */
export default class AutoUpdateService extends TypertRemoteService {
  private current = (): Partial<Config> => ({})
  private phase: AutoUpdatePhase = 'idle'
  private lastCheckAt: number | undefined
  private behind = 0
  private head: string | undefined
  private message: string | undefined
  private conflictLog: string | undefined
  private running: Promise<UpdateOutcome> | null = null
  private stopSchedule: () => void = () => {}
  private disposed = false

  constructor(ctx: Context, config: Partial<Config>) {
    super(ctx, 'autoUpdate')
    installSettingsSection(ctx, AUTO_UPDATE_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        this.current = source
      },
      // A committed change re-arms the schedule with the new cadence.
      onChange: () => this.reschedule(),
    })
    this.reschedule()
    ctx.effect(() => () => {
      this.disposed = true
      this.stopSchedule()
    }, 'auto-update: schedule disposal')
  }

  /**
   * Current update state for the web GUI.
   * @returns the latest snapshot, mirroring the last `auto-update/status` event.
   */
  @Remote('status')
  status(): AutoUpdateSnapshot {
    return this.snapshot()
  }

  /**
   * Trigger one update run now. Concurrent calls share the in-flight run.
   * @returns the settled outcome of the run.
   */
  @Remote('check')
  async check(): Promise<UpdateOutcome> {
    if (this.running !== null) return this.running
    const run = this.runOnce()
    this.running = run.finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Fire-and-forget scheduled run; in-flight runs are never duplicated. */
  private async runScheduled(): Promise<void> {
    if (this.running !== null) return
    const run = this.runOnce()
    this.running = run.finally(() => {
      this.running = null
    })
    try {
      await run
    } catch (error) {
      this.ctx.logger.warn(`auto-update scheduled run failed: ${String(error)}`)
    }
  }

  /** Run the pipeline once and settle the snapshot, status file, and event. */
  private async runOnce(): Promise<UpdateOutcome> {
    const resolved = resolveOptions(this.current())
    if (!resolved.enabled) {
      const outcome: UpdateOutcome = {
        kind: 'skipped',
        reason: 'disabled',
        message: '自动更新已关闭',
      }
      this.settle(outcome, resolved)
      return outcome
    }
    this.phase = 'checking'
    this.emit(resolved)
    const outcome = await runUpdatePipeline({
      ...resolved,
      exec: execCommand,
      now: Date.now,
    })
    this.settle(outcome, resolved)
    return outcome
  }

  /** Project one outcome onto the snapshot, the status file, and the event. */
  private settle(outcome: UpdateOutcome, resolved: ResolvedOptions): void {
    switch (outcome.kind) {
      case 'up-to-date':
        this.phase = 'idle'
        this.message = '已是最新'
        break
      case 'skipped':
        this.phase = 'skipped'
        this.message = outcome.message
        break
      case 'updated':
        this.phase = 'updated'
        this.head = outcome.head
        this.message = `更新完成，请重启应用生效（${outcome.head}）`
        break
      case 'conflict':
        this.phase = 'conflict'
        this.conflictLog = relative(resolved.repoDir, outcome.logPath).split('\\').join('/')
        this.message = `合并冲突，已回滚；冲突日志 ${this.conflictLog}`
        break
      case 'failed':
        this.phase = 'failed'
        this.message = outcome.message
        break
    }
    this.lastCheckAt = Date.now()
    this.behind = 'behind' in outcome ? outcome.behind : this.behind
    this.emit(resolved)
  }

  /** Persist the snapshot and emit the status event. */
  private emit(resolved: ResolvedOptions): void {
    const snapshot = this.snapshot()
    void mkdir(resolved.logDir, { recursive: true }).then(() =>
      writeFile(join(resolved.logDir, 'status.json'), JSON.stringify(snapshot, null, 2)),
    ).catch((error: unknown) => {
      this.ctx.logger.warn(`auto-update status.json write failed: ${String(error)}`)
    })
    this.ctx.emit('auto-update/status', snapshot)
  }

  /** The current public snapshot. */
  private snapshot(): AutoUpdateSnapshot {
    return {
      phase: this.phase,
      enabled: resolveOptions(this.current()).enabled,
      behind: this.behind,
      ...(this.lastCheckAt !== undefined ? { lastCheckAt: this.lastCheckAt } : {}),
      ...(this.head !== undefined ? { head: this.head } : {}),
      ...(this.message !== undefined ? { message: this.message } : {}),
      ...(this.conflictLog !== undefined ? { conflictLog: this.conflictLog } : {}),
    }
  }

  /** Re-arm the startup check and daily interval from the current config. */
  private reschedule(): void {
    this.stopSchedule()
    if (this.disposed) return
    const resolved = resolveOptions(this.current())
    if (!resolved.enabled) return
    const disposers: Array<() => void> = []
    if (resolved.checkOnStartup) {
      const timer = setTimeout(
        () => void this.runScheduled(),
        resolved.startupDelaySeconds * 1000,
      )
      disposers.push(() => clearTimeout(timer))
    }
    const interval = setInterval(
      () => void this.runScheduled(),
      resolved.intervalHours * 3_600_000,
    )
    disposers.push(() => clearInterval(interval))
    this.stopSchedule = () => {
      for (const dispose of disposers) dispose()
    }
  }
}
