/**
 * Pipeline tests: drive `runUpdatePipeline` with a scripted command runner
 * against a temp repository directory, asserting the command sequence, the
 * settled outcome, and the conflict-snapshot artifacts.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  runUpdatePipeline,
  type Exec,
  type ExecResult,
  type UpdatePipelineOptions,
} from '../src/run.ts'

/** One scripted command expectation. */
interface ScriptStep {
  readonly cmd: string
  readonly args: readonly string[]
  readonly result: ExecResult
}

/** Build a command runner that replays a script and records every call. */
function scripted(steps: readonly ScriptStep[]): { exec: Exec; calls: Array<{ cmd: string; args: readonly string[] }> } {
  const calls: Array<{ cmd: string; args: readonly string[] }> = []
  let index = 0
  const exec: Exec = (cmd, args, _opts) => {
    calls.push({ cmd, args })
    const step = steps[index]
    index += 1
    if (step === undefined || step.cmd !== cmd || step.args.join(' ') !== args.join(' ')) {
      return Promise.resolve({ code: 1, stdout: '', stderr: `unexpected command ${cmd} ${args.join(' ')}` })
    }
    return Promise.resolve(step.result)
  }
  return { exec, calls }
}

const OK = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' })

/** pnpm resolves to a `.cmd` shim on Windows, mirroring src/run.ts. */
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

describe('runUpdatePipeline', () => {
  let repoDir: string
  let logDir: string

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'auto-update-repo-'))
    logDir = join(repoDir, 'update')
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
  })

  function options(exec: Exec, patch: Partial<UpdatePipelineOptions> = {}): UpdatePipelineOptions {
    return {
      repoDir,
      remote: 'upstream',
      branch: 'custom',
      autoPush: true,
      gateInstall: true,
      gateBuild: true,
      gateTest: true,
      logDir,
      exec,
      now: () => 1_700_000_000_000,
      ...patch,
    }
  }

  it('skips when the checked-out branch is not the target branch', async () => {
    const { exec, calls } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('master') },
    ])
    const outcome = await runUpdatePipeline(options(exec))
    expect(outcome).toEqual({
      kind: 'skipped',
      reason: 'wrong-branch',
      message: '当前分支 master，期望 custom，跳过更新',
    })
    expect(calls).toHaveLength(1)
  })

  it('skips when the working tree is dirty', async () => {
    const { exec, calls } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('custom') },
      { cmd: 'git', args: ['status', '--porcelain'], result: OK(' M src/index.ts') },
    ])
    const outcome = await runUpdatePipeline(options(exec))
    expect(outcome).toEqual({ kind: 'skipped', reason: 'dirty', message: '工作区有未提交改动，跳过更新' })
    expect(calls).toHaveLength(2)
  })

  it('reports up-to-date when the remote branch adds no commits', async () => {
    const { exec, calls } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('custom') },
      { cmd: 'git', args: ['status', '--porcelain'], result: OK('') },
      { cmd: 'git', args: ['fetch', 'upstream'], result: OK() },
      { cmd: 'git', args: ['rev-list', '--count', 'HEAD..upstream/custom'], result: OK('0') },
    ])
    const outcome = await runUpdatePipeline(options(exec))
    expect(outcome).toEqual({ kind: 'up-to-date', behind: 0 })
    expect(calls.map(call => call.args.join(' '))).toEqual([
      'rev-parse --abbrev-ref HEAD',
      'status --porcelain',
      'fetch upstream',
      'rev-list --count HEAD..upstream/custom',
    ])
  })

  it('merges, runs every gate, pushes, and reports the new head', async () => {
    const { exec, calls } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('custom') },
      { cmd: 'git', args: ['status', '--porcelain'], result: OK('') },
      { cmd: 'git', args: ['fetch', 'upstream'], result: OK() },
      { cmd: 'git', args: ['rev-list', '--count', 'HEAD..upstream/custom'], result: OK('3') },
      { cmd: 'git', args: ['rev-parse', 'HEAD'], result: OK('abc123') },
      { cmd: 'git', args: ['merge', 'upstream/custom'], result: OK() },
      { cmd: PNPM, args: ['install'], result: OK() },
      { cmd: PNPM, args: ['run', 'build'], result: OK() },
      { cmd: PNPM, args: ['run', 'test'], result: OK() },
      { cmd: 'git', args: ['push', 'origin', 'custom'], result: OK() },
      { cmd: 'git', args: ['rev-parse', 'HEAD'], result: OK('def456789012') },
    ])
    const outcome = await runUpdatePipeline(options(exec))
    expect(outcome).toEqual({ kind: 'updated', behind: 3, head: 'def456789012' })
    expect(calls.map(call => `${call.cmd} ${call.args.join(' ')}`)).toEqual([
      'git rev-parse --abbrev-ref HEAD',
      'git status --porcelain',
      'git fetch upstream',
      'git rev-list --count HEAD..upstream/custom',
      'git rev-parse HEAD',
      'git merge upstream/custom',
      `${PNPM} install`,
      `${PNPM} run build`,
      `${PNPM} run test`,
      'git push origin custom',
      'git rev-parse HEAD',
    ])
  })

  it('skips disabled gates and push when configured off', async () => {
    const { exec, calls } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('custom') },
      { cmd: 'git', args: ['status', '--porcelain'], result: OK('') },
      { cmd: 'git', args: ['fetch', 'upstream'], result: OK() },
      { cmd: 'git', args: ['rev-list', '--count', 'HEAD..upstream/custom'], result: OK('1') },
      { cmd: 'git', args: ['rev-parse', 'HEAD'], result: OK('abc123') },
      { cmd: 'git', args: ['merge', 'upstream/custom'], result: OK() },
      { cmd: 'git', args: ['rev-parse', 'HEAD'], result: OK('def456789012') },
    ])
    const outcome = await runUpdatePipeline(options(exec, {
      autoPush: false,
      gateInstall: false,
      gateBuild: false,
      gateTest: false,
    }))
    expect(outcome).toEqual({ kind: 'updated', behind: 1, head: 'def456789012' })
    expect(calls.some(call => call.cmd === 'pnpm')).toBe(false)
    expect(calls.some(call => call.args[0] === 'push')).toBe(false)
  })

  it('snapshots a merge conflict, aborts the merge, and reports the log path', async () => {
    const conflictedDiff = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> upstream/custom\n'
    const { exec, calls } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('custom') },
      { cmd: 'git', args: ['status', '--porcelain'], result: OK('') },
      { cmd: 'git', args: ['fetch', 'upstream'], result: OK() },
      { cmd: 'git', args: ['rev-list', '--count', 'HEAD..upstream/custom'], result: OK('2') },
      { cmd: 'git', args: ['rev-parse', 'HEAD'], result: OK('abc123') },
      {
        cmd: 'git',
        args: ['merge', 'upstream/custom'],
        result: { code: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in src/index.ts' },
      },
      { cmd: 'git', args: ['diff'], result: OK(conflictedDiff) },
      { cmd: 'git', args: ['diff', '--name-only', '--diff-filter=U'], result: OK('src/index.ts') },
      { cmd: 'git', args: ['merge', '--abort'], result: OK() },
    ])
    const outcome = await runUpdatePipeline(options(exec))
    expect(outcome.kind).toBe('conflict')
    if (outcome.kind !== 'conflict') return
    expect(outcome.behind).toBe(2)
    expect(outcome.detail).toBe('src/index.ts')
    const diff = await readFile(outcome.logPath, 'utf8')
    expect(diff).toBe(conflictedDiff)
    const meta = JSON.parse(await readFile(outcome.logPath.replace(/\.diff$/, '.json'), 'utf8')) as {
      files: string[]
      behind: number
    }
    expect(meta.files).toEqual(['src/index.ts'])
    expect(meta.behind).toBe(2)
    // The abort must be the last git command before settling.
    expect(calls.at(-1)).toEqual({ cmd: 'git', args: ['merge', '--abort'] })
  })

  it('rolls back to the pre-merge commit when install fails', async () => {
    const { exec, calls } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('custom') },
      { cmd: 'git', args: ['status', '--porcelain'], result: OK('') },
      { cmd: 'git', args: ['fetch', 'upstream'], result: OK() },
      { cmd: 'git', args: ['rev-list', '--count', 'HEAD..upstream/custom'], result: OK('1') },
      { cmd: 'git', args: ['rev-parse', 'HEAD'], result: OK('abc123') },
      { cmd: 'git', args: ['merge', 'upstream/custom'], result: OK() },
      { cmd: PNPM, args: ['install'], result: { code: 1, stdout: '', stderr: 'ERESOLVE unable to resolve' } },
      { cmd: 'git', args: ['reset', '--hard', 'abc123'], result: OK() },
    ])
    const outcome = await runUpdatePipeline(options(exec))
    expect(outcome).toEqual({
      kind: 'failed',
      stage: 'install',
      message: 'ERESOLVE unable to resolve',
    })
    expect(calls.at(-1)).toEqual({ cmd: 'git', args: ['reset', '--hard', 'abc123'] })
  })

  it('rolls back when the test gate fails', async () => {
    const { exec } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('custom') },
      { cmd: 'git', args: ['status', '--porcelain'], result: OK('') },
      { cmd: 'git', args: ['fetch', 'upstream'], result: OK() },
      { cmd: 'git', args: ['rev-list', '--count', 'HEAD..upstream/custom'], result: OK('1') },
      { cmd: 'git', args: ['rev-parse', 'HEAD'], result: OK('abc123') },
      { cmd: 'git', args: ['merge', 'upstream/custom'], result: OK() },
      { cmd: PNPM, args: ['install'], result: OK() },
      { cmd: PNPM, args: ['run', 'build'], result: OK() },
      { cmd: PNPM, args: ['run', 'test'], result: { code: 1, stdout: '', stderr: 'FAIL tests/index.spec.ts' } },
      { cmd: 'git', args: ['reset', '--hard', 'abc123'], result: OK() },
    ])
    const outcome = await runUpdatePipeline(options(exec))
    expect(outcome).toEqual({ kind: 'failed', stage: 'test', message: 'FAIL tests/index.spec.ts' })
  })

  it('keeps the local merge when the push fails', async () => {
    const { exec, calls } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('custom') },
      { cmd: 'git', args: ['status', '--porcelain'], result: OK('') },
      { cmd: 'git', args: ['fetch', 'upstream'], result: OK() },
      { cmd: 'git', args: ['rev-list', '--count', 'HEAD..upstream/custom'], result: OK('1') },
      { cmd: 'git', args: ['rev-parse', 'HEAD'], result: OK('abc123') },
      { cmd: 'git', args: ['merge', 'upstream/custom'], result: OK() },
      { cmd: PNPM, args: ['install'], result: OK() },
      { cmd: PNPM, args: ['run', 'build'], result: OK() },
      { cmd: PNPM, args: ['run', 'test'], result: OK() },
      { cmd: 'git', args: ['push', 'origin', 'custom'], result: { code: 1, stdout: '', stderr: 'rejected' } },
    ])
    const outcome = await runUpdatePipeline(options(exec))
    expect(outcome).toEqual({ kind: 'failed', stage: 'push', message: 'rejected' })
    expect(calls.some(call => call.args[0] === 'reset')).toBe(false)
  })

  it('fails cleanly when fetch cannot reach the remote', async () => {
    const { exec } = scripted([
      { cmd: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], result: OK('custom') },
      { cmd: 'git', args: ['status', '--porcelain'], result: OK('') },
      { cmd: 'git', args: ['fetch', 'upstream'], result: { code: 128, stdout: '', stderr: 'could not resolve host' } },
    ])
    const outcome = await runUpdatePipeline(options(exec))
    expect(outcome).toEqual({ kind: 'failed', stage: 'merge', message: 'git fetch upstream 失败: could not resolve host' })
  })
})
