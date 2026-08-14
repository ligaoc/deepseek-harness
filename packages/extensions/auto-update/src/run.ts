/**
 * The update pipeline: sync the fork's custom branch, then fetch the upstream
 * remote and merge its branch into the custom branch, run the
 * install/build/test gates, roll back on any failure, and push the merged
 * branch to the fork. Pure and injectable for tests — every external command
 * goes through the supplied `exec`, and conflict snapshots are written by the
 * supplied writer.
 *
 * Fork-first ordering keeps multi-machine forks convergent: each machine pulls
 * the other machine's pushed commits before merging upstream, so both sides
 * merge upstream from the same base and one push eventually carries everything.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpdateOutcome } from './types.ts'

/** One settled external command. */
export interface ExecResult {
  /** Process exit code; 1 for spawn/timeout failures that carry no code. */
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run one external command and settle with its output. The implementation
 * owns argv quoting, cwd, environment, timeout, and abort propagation.
 */
export type Exec = (
  cmd: string,
  args: readonly string[],
  opts: {
    readonly cwd: string
    readonly env?: Readonly<Record<string, string>>
    readonly timeoutMs: number
    readonly signal?: AbortSignal
  },
) => Promise<ExecResult>

/** Pipeline inputs resolved from plugin config at run time. */
export interface UpdatePipelineOptions {
  /** Repository root every git/pnpm command runs in. */
  readonly repoDir: string
  /** Remote name to fetch, conventionally `upstream`. */
  readonly remote: string
  /** Local branch the remote branch is merged into, conventionally `custom`. */
  readonly branch: string
  /** Merge `origin/<branch>` into the local branch before merging upstream. */
  readonly pullFork: boolean
  /** Push the merged branch to `origin` after every gate passes. */
  readonly autoPush: boolean
  /** Run `pnpm install` as the first gate. */
  readonly gateInstall: boolean
  /** Run `pnpm run build` as the second gate. */
  readonly gateBuild: boolean
  /** Run `pnpm run test` as the third gate. */
  readonly gateTest: boolean
  /** Directory conflict snapshots and the status file are written to. */
  readonly logDir: string
  /** Optional proxy URL applied to git and pnpm via HTTP(S)_PROXY. */
  readonly proxyUrl?: string
  /** Command runner; injectable for tests. */
  readonly exec: Exec
  /** Clock for snapshot filenames; injectable for tests. */
  readonly now?: () => number
}

/** One conflict snapshot's provenance: which remote's branch failed to merge. */
export type ConflictSource = 'fork' | 'upstream'

/** Long gate timeouts: installs and builds can legitimately take minutes. */
export const GATE_TIMEOUT_MS = 20 * 60_000
/** Test suites are the longest gate; give them a generous ceiling. */
export const TEST_TIMEOUT_MS = 30 * 60_000
/** Short git operations: fetch/merge/push on a warm proxy. */
export const GIT_TIMEOUT_MS = 10 * 60_000

/** pnpm resolves to a `.cmd` shim on Windows. */
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

/** yyyyMMdd-HHmmss stamp for one conflict snapshot filename. */
function stampOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** Environment with the optional proxy exported for git and pnpm. */
function envOf(options: UpdatePipelineOptions): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  if (options.proxyUrl !== undefined && options.proxyUrl !== '') {
    env.HTTP_PROXY = options.proxyUrl
    env.HTTPS_PROXY = options.proxyUrl
    env.npm_config_proxy = options.proxyUrl
    env.npm_config_https_proxy = options.proxyUrl
  }
  return env
}

/**
 * Run the full update pipeline. Every failure path leaves the repository on
 * the last successful merge (or untouched), so the running app keeps working
 * and a later manual or scheduled run can retry.
 *
 * @param options - resolved pipeline inputs.
 * @returns the settled outcome; no throw for command-level failures.
 */
export async function runUpdatePipeline(options: UpdatePipelineOptions): Promise<UpdateOutcome> {
  const env = envOf(options)
  const branch = await git(options, ['rev-parse', '--abbrev-ref', 'HEAD'], env)
  if (branch.stdout.trim() !== options.branch) {
    return {
      kind: 'skipped',
      reason: 'wrong-branch',
      message: `当前分支 ${branch.stdout.trim()}，期望 ${options.branch}，跳过更新`,
    }
  }
  const dirty = await git(options, ['status', '--porcelain'], env)
  if (dirty.stdout.trim() !== '') {
    return { kind: 'skipped', reason: 'dirty', message: '工作区有未提交改动，跳过更新' }
  }

  // Gates roll back to the commit this run started from: a failed gate means
  // this update is rejected wholesale, fork sync included. The next run
  // re-fetches both remotes, so nothing is lost.
  const rollbackSha = (await git(options, ['rev-parse', 'HEAD'], env)).stdout.trim()
  let mergedAnything = false
  let behind = 0

  // Stage 1: sync the fork, so another machine's pushed commits land first.
  if (options.pullFork) {
    const fetchFork = await git(options, ['fetch', 'origin'], env)
    if (fetchFork.code !== 0) {
      return { kind: 'failed', stage: 'merge', message: `git fetch origin 失败: ${fetchFork.stderr.trim()}` }
    }
    const forkExists = await git(options, ['rev-parse', '--verify', `origin/${options.branch}`], env)
    if (forkExists.code === 0) {
      const behindForkRaw = await git(options, ['rev-list', '--count', `HEAD..origin/${options.branch}`], env)
      const behindFork = Number(behindForkRaw.stdout.trim())
      if (Number.isFinite(behindFork) && behindFork > 0) {
        const mergeFork = await git(options, ['merge', `origin/${options.branch}`], env)
        if (mergeFork.code !== 0) {
          const snapshot = await snapshotConflict(options, 'fork', behindFork, mergeFork.stderr, env)
          return { kind: 'conflict', behind: behindFork, ...snapshot }
        }
        mergedAnything = true
      }
    }
  }

  // Stage 2: sync the upstream remote.
  const fetch = await git(options, ['fetch', options.remote], env)
  if (fetch.code !== 0) {
    return { kind: 'failed', stage: 'merge', message: `git fetch ${options.remote} 失败: ${fetch.stderr.trim()}` }
  }
  const behindRaw = await git(options, ['rev-list', '--count', `HEAD..${options.remote}/${options.branch}`], env)
  behind = Number(behindRaw.stdout.trim())
  if (Number.isFinite(behind) && behind > 0) {
    const merge = await git(options, ['merge', `${options.remote}/${options.branch}`], env)
    if (merge.code !== 0) {
      const snapshot = await snapshotConflict(options, 'upstream', behind, merge.stderr, env)
      return { kind: 'conflict', behind, ...snapshot }
    }
    mergedAnything = true
  }

  // Neither the fork nor the upstream added commits: nothing to do.
  if (!mergedAnything) {
    return { kind: 'up-to-date', behind: 0 }
  }

  if (options.gateInstall) {
    const install = await pnpm(options, ['install'], GATE_TIMEOUT_MS, env)
    if (install.code !== 0) {
      await rollback(options, rollbackSha, env)
      return { kind: 'failed', stage: 'install', message: install.stderr.trim() || 'pnpm install 失败' }
    }
  }
  if (options.gateBuild) {
    const build = await pnpm(options, ['run', 'build'], GATE_TIMEOUT_MS, env)
    if (build.code !== 0) {
      await rollback(options, rollbackSha, env)
      return { kind: 'failed', stage: 'build', message: build.stderr.trim() || 'pnpm run build 失败' }
    }
  }
  if (options.gateTest) {
    const test = await pnpm(options, ['run', 'test'], TEST_TIMEOUT_MS, env)
    if (test.code !== 0) {
      await rollback(options, rollbackSha, env)
      return { kind: 'failed', stage: 'test', message: test.stderr.trim() || 'pnpm run test 失败' }
    }
  }

  if (options.autoPush) {
    const push = await git(options, ['push', 'origin', options.branch], env)
    if (push.code !== 0) {
      // The local merge stays: the app is usable, only the fork lags — and in
      // a multi-machine setup the other machine cannot pull until this lands.
      return { kind: 'failed', stage: 'push', message: push.stderr.trim() || `git push origin ${options.branch} 失败` }
    }
  }

  const finalHead = await git(options, ['rev-parse', 'HEAD'], env)
  return { kind: 'updated', behind, head: finalHead.stdout.trim().slice(0, 12) }
}

/**
 * Snapshot a failed merge (conflict markers plus metadata) and abort it, so
 * the repository stays usable and the snapshot is the sole record for a later
 * model-assisted resolution.
 *
 * @param options - resolved pipeline inputs.
 * @param source - which remote's merge failed.
 * @param behind - commits that merge was trying to bring in.
 * @param mergeStderr - the failed merge's stderr, kept in the snapshot metadata.
 * @param env - the command environment.
 * @returns the snapshot path and the conflict detail for the outcome.
 */
async function snapshotConflict(
  options: UpdatePipelineOptions,
  source: ConflictSource,
  behind: number,
  mergeStderr: string,
  env: Record<string, string>,
): Promise<{ logPath: string; detail: string }> {
  const now = options.now?.() ?? Date.now()
  const base = `conflict-${stampOf(new Date(now))}`
  const diff = await git(options, ['diff'], env)
  const unmerged = await git(options, ['diff', '--name-only', '--diff-filter=U'], env)
  await mkdir(options.logDir, { recursive: true })
  const logPath = join(options.logDir, `${base}.diff`)
  await writeFile(logPath, diff.stdout)
  await writeFile(join(options.logDir, `${base}.json`), JSON.stringify({
    source,
    remote: source === 'fork' ? 'origin' : options.remote,
    branch: options.branch,
    behind,
    at: new Date(now).toISOString(),
    files: unmerged.stdout.trim().split(/\r?\n/).filter(Boolean),
    mergeStderr: mergeStderr.trim(),
  }, null, 2))
  await git(options, ['merge', '--abort'], env)
  return {
    logPath,
    detail: unmerged.stdout.trim() === '' ? mergeStderr.trim() : unmerged.stdout.trim(),
  }
}

/** Run one git command and settle with its result. */
async function git(
  options: UpdatePipelineOptions,
  args: readonly string[],
  env: Record<string, string>,
): Promise<ExecResult> {
  return options.exec('git', args, { cwd: options.repoDir, env, timeoutMs: GIT_TIMEOUT_MS })
}

/** Run one pnpm command with an explicit gate timeout. */
async function pnpm(
  options: UpdatePipelineOptions,
  args: readonly string[],
  timeoutMs: number,
  env: Record<string, string>,
): Promise<ExecResult> {
  return options.exec(PNPM, args, { cwd: options.repoDir, env, timeoutMs })
}

/** Restore the last successful merge's commit after a gate failure. */
async function rollback(
  options: UpdatePipelineOptions,
  rollbackSha: string,
  env: Record<string, string>,
): Promise<void> {
  await git(options, ['reset', '--hard', rollbackSha], env)
}
