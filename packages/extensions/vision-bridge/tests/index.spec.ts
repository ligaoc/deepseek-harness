/**
 * `dsh-vision-bridge` behavior: the `imageDegradation` activation service,
 * the `agent/pre-step` degradation itself, and the model-selection source
 * (the agent-scoped `modelSelection` service, never the options snapshot).
 */

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
      ? { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }
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
async function harness(config: {
  apiKey?: string
  baseURL?: string
  model?: string
}): Promise<{
  ctx: Context
  agent: Agent
  selection: ModelSelectionRef
  append: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  ctx.provide('llm', {
    resolveModelInfo: vi.fn(() => Promise.resolve({
      provider: 'p', id: 'm', name: 'M', inputModalities: ['text'],
    })),
  } as never)
  ctx.provide('attachments', {
    readImage: vi.fn(() => Promise.resolve({
      ref: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
      data: Uint8Array.of(1),
    } as StoredImageAttachment)),
  } as never)
  const append = vi.fn()
  const agent = {
    id: 'session-test',
    options: { provider: 'seed', model: 'seed-model' },
    session: { append },
    ctx,
  } as unknown as Agent
  const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
  installModelSelection(agent.ctx, selection)
  await ctx.plugin({ name, inject, Config, apply }, {
    ...config.apiKey === undefined ? {} : { apiKey: config.apiKey },
    apiKeyEnv: 'VISION_API_KEY',
    ...config.baseURL === undefined ? {} : { baseURL: config.baseURL },
    ...config.model === undefined ? {} : { model: config.model },
  })
  return { ctx, agent, selection, append }
}

/** Resolve the `imageDegradation` service without importing its runtime type. */
function serviceOf(ctx: Context): { isActive(): Promise<boolean> } {
  return ctx.get(IMAGE_DEGRADATION_SERVICE) as { isActive(): Promise<boolean> }
}

describe('imageDegradation service', () => {
  it('reports active only when endpoint, model, and key are all present', async () => {
    const { ctx } = await harness({ apiKey: 'key', baseURL: 'https://vision', model: 'vl' })
    await expect(serviceOf(ctx).isActive()).resolves.toBe(true)
    await ctx.fiber.dispose()
  })

  it('stays dormant without an apiKey', async () => {
    const { ctx } = await harness({ baseURL: 'https://vision', model: 'vl' })
    await expect(serviceOf(ctx).isActive()).resolves.toBe(false)
    await ctx.fiber.dispose()
  })

  it('stays dormant without an endpoint or model', async () => {
    const { ctx } = await harness({ apiKey: 'key', model: 'vl' })
    await expect(serviceOf(ctx).isActive()).resolves.toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('agent/pre-step degradation', () => {
  it('replaces image blocks with vision descriptions when the model is text-only', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'a screenshot of a chart' } }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, agent, append } = await harness({ apiKey: 'key', baseURL: 'https://vision', model: 'vl' })
    const messages = [imageMessage([{ type: 'image' }, { type: 'text', text: 'hi' }])]

    const decision = await runPreStep(ctx, agent, messages)
    expect(decision.kind).toBe('enter')
    const degraded = (decision as { messages: UserMessage[] }).messages
    expect(contentHasImage(degraded[0]!.content)).toBe(false)
    expect(degraded[0]!.content[0]).toEqual({ type: 'text', text: '[图片描述] a screenshot of a chart' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledWith(
      'vision/describe',
      expect.objectContaining({ attachmentId: 'att-1' }),
    )
    vi.unstubAllGlobals()
    await ctx.fiber.dispose()
  })

  it('keeps raw images for a vision-capable model', async () => {
    const { ctx, agent, append } = await harness({ apiKey: 'key', baseURL: 'https://vision', model: 'vl' })
    ;(ctx.get('llm') as unknown as { resolveModelInfo: ReturnType<typeof vi.fn> }).resolveModelInfo.mockResolvedValue({
      provider: 'p', id: 'm', name: 'M', inputModalities: ['text', 'image'],
    })
    const messages = [imageMessage([{ type: 'image' }])]

    const decision = await runPreStep(ctx, agent, messages)
    expect(decision.kind).toBe('enter')
    expect(contentHasImage((decision as { messages: UserMessage[] }).messages[0]!.content)).toBe(true)
    expect(append).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('judges the agent-scoped model selection, not the options snapshot', async () => {
    const { ctx, agent, selection } = await harness({ apiKey: 'key', baseURL: 'https://vision', model: 'vl' })
    // The session was created on a vision-capable model, but the live
    // selection moved to a text-only model: degradation must follow the
    // selection the admission check used.
    ;(agent as { options: { provider: string; model: string } }).options = { provider: 'seed', model: 'vision-model' }
    selection.current = { provider: 'p', model: 'text-only-model' }
    ;(ctx.get('llm') as unknown as { resolveModelInfo: ReturnType<typeof vi.fn> }).resolveModelInfo.mockResolvedValue({
      provider: 'p', id: 'm', name: 'M', inputModalities: ['text'],
    })

    const messages = [imageMessage([{ type: 'image' }])]
    const decision = await runPreStep(ctx, agent, messages)
    expect(decision.kind).toBe('enter')
    const degraded = (decision as { messages: UserMessage[] }).messages
    expect(contentHasImage(degraded[0]!.content)).toBe(false)
    await ctx.fiber.dispose()
  })

  it('stays dormant for a text-only model when the bridge is unconfigured', async () => {
    const { ctx, agent, append } = await harness({ baseURL: 'https://vision', model: 'vl' })
    const messages = [imageMessage([{ type: 'image' }])]
    const decision = await runPreStep(ctx, agent, messages)
    expect(decision).toEqual({ kind: 'enter', messages })
    expect(append).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
