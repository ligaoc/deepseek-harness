/**
 * `dsh-vision-bridge` behavior: the `imageDegradation` activation service and
 * the `agent/pre-step` archiving itself — image blocks are written to the
 * workspace and replaced by path-bearing text, judged by the agent-scoped
 * model selection (never the options snapshot).
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { contentHasImage } from '@deepseek-ai/dsh-llm'
import type { StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { apply, Config, IMAGE_DEGRADATION_SERVICE, inject, name } from '../src/index.ts'

/** One step message carrying an image block. */
function imageMessage(content: Array<{ type: 'image' | 'text'; text?: string }>): UserMessage {
  return {
    id: 'm1',
    role: 'user',
    source: { kind: 'user' },
    content: content.map(block => block.type === 'image'
      ? { type: 'image', attachment: { attachmentId: 'sha256:att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }
      : { type: 'text', text: block.text ?? '' }),
  } as UserMessage
}

/** Dispatch one pre-step through the vision-bridge listener. */
async function runPreStep(
  ctx: Context,
  agent: Agent,
  messages: UserMessage[],
): Promise<{ kind: 'enter'; messages: UserMessage[] } | { kind: 'reject' }> {
  const signal = new AbortController().signal
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter', messages } as const),
  )
}

/** Register the bridge plus minimal host services; returns the live selection. */
async function harness(): Promise<{ ctx: Context; agent: Agent; selection: ModelSelectionRef; cwd: string }> {
  const ctx = new Context()
  ctx.provide('llm', {
    resolveModelInfo: vi.fn(() => Promise.resolve({
      provider: 'p', id: 'm', name: 'M', inputModalities: ['text'],
    })),
  } as never)
  ctx.provide('attachments', {
    readImage: vi.fn(() => Promise.resolve({
      ref: { attachmentId: 'sha256:att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
      data: Uint8Array.of(1, 2, 3),
    } as StoredImageAttachment)),
  } as never)
  const cwd = mkdtempSync(join(tmpdir(), 'vision-bridge-test-'))
  const agent = {
    id: 'session-test',
    options: { provider: 'seed', model: 'seed-model' },
    session: { header: { cwd }, append: vi.fn() },
    ctx,
  } as unknown as Agent
  const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
  installModelSelection(agent.ctx, selection)
  await ctx.plugin({ name, inject, Config, apply }, {})
  return { ctx, agent, selection, cwd }
}

/** Resolve the `imageDegradation` service without importing its runtime type. */
function serviceOf(ctx: Context): { isActive(): Promise<boolean> } {
  return ctx.get(IMAGE_DEGRADATION_SERVICE) as { isActive(): Promise<boolean> }
}

describe('imageDegradation service', () => {
  it('is active while mounted: archiving needs no external credential', async () => {
    const { ctx } = await harness()
    await expect(serviceOf(ctx).isActive()).resolves.toBe(true)
    await ctx.fiber.dispose()
  })
})

describe('agent/pre-step archiving', () => {
  it('writes images to the workspace and replaces blocks with path text', async () => {
    const { ctx, agent, cwd } = await harness()
    const messages = [imageMessage([{ type: 'image' }, { type: 'text', text: 'hi' }])]

    const decision = await runPreStep(ctx, agent, messages)
    expect(decision.kind).toBe('enter')
    const archived = (decision as { messages: UserMessage[] }).messages
    expect(contentHasImage(archived[0]!.content)).toBe(false)
    const text = archived[0]!.content[0]!
    expect(text.type).toBe('text')
    const label = (text as { text: string }).text
    // The path points under the session workspace's .dsh-images directory and
    // carries a sanitized file name (the `sha256:` prefix loses its colon).
    expect(label).toContain(join(cwd, '.dsh-images'))
    expect(label).toContain('sha256_att-1.png')
    expect(label).toContain('vision 技能')
    // The image bytes really landed on disk as a plain file.
    expect(existsSync(join(cwd, '.dsh-images', 'sha256_att-1.png'))).toBe(true)
    await ctx.fiber.dispose()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('numbers multiple images and keeps the original text block', async () => {
    const { ctx, agent } = await harness()
    const messages = [imageMessage([
      { type: 'image' }, { type: 'text', text: 'keep me' }, { type: 'image' },
    ])]

    const decision = await runPreStep(ctx, agent, messages)
    const blocks = (decision as { messages: UserMessage[] }).messages[0]!.content
    expect(blocks[0]!.type).toBe('text')
    expect((blocks[0] as { text: string }).text).toContain('第 1/2 张')
    expect(blocks[1]).toEqual({ type: 'text', text: 'keep me' })
    expect((blocks[2] as { text: string }).text).toContain('第 2/2 张')
    await ctx.fiber.dispose()
  })

  it('keeps raw images for a vision-capable model', async () => {
    const { ctx, agent, cwd } = await harness()
    ;(ctx.get('llm') as unknown as { resolveModelInfo: ReturnType<typeof vi.fn> }).resolveModelInfo.mockResolvedValue({
      provider: 'p', id: 'm', name: 'M', inputModalities: ['text', 'image'],
    })
    const messages = [imageMessage([{ type: 'image' }])]

    const decision = await runPreStep(ctx, agent, messages)
    expect(decision.kind).toBe('enter')
    expect(contentHasImage((decision as { messages: UserMessage[] }).messages[0]!.content)).toBe(true)
    expect(existsSync(join(cwd, '.dsh-images', 'sha256_att-1.png'))).toBe(false)
    await ctx.fiber.dispose()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('judges the agent-scoped model selection, not the options snapshot', async () => {
    const { ctx, agent, selection, cwd } = await harness()
    // The session was created on a vision-capable model, but the live
    // selection moved to a text-only model: archiving must follow the
    // selection the admission check used.
    ;(agent as { options: { provider: string; model: string } }).options = { provider: 'seed', model: 'vision-model' }
    selection.current = { provider: 'p', model: 'text-only-model' }

    const messages = [imageMessage([{ type: 'image' }])]
    const decision = await runPreStep(ctx, agent, messages)
    expect(decision.kind).toBe('enter')
    expect(contentHasImage((decision as { messages: UserMessage[] }).messages[0]!.content)).toBe(false)
    await ctx.fiber.dispose()
    rmSync(cwd, { recursive: true, force: true })
  })
})
