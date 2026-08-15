/**
 * `@deepseek-ai/dsh-vision-bridge`: degrades image blocks to text before the
 * model request when the target model cannot take images. A function/namespace
 * plugin listening on the `agent/pre-step` waterfall — the same extension
 * point `dsh-tool-skill` uses to inject skill content — so the degradation is
 * transparent to the loop: the session log keeps the original image blocks,
 * and only the model-facing step messages carry the descriptions.
 *
 * The plugin registers the `vision-bridge` user-settings section (`ctx.settings`)
 * with the same Config schema and its cordis.yml entry as the composition base,
 * so a `vision-bridge:` section in the user settings document — edited from the
 * web Plugins page — overrides any field without a restart. The API key is a
 * secret-role field written through the credentials domain, resolved per step
 * from the same snapshot that supplies the endpoint.
 *
 * @module @deepseek-ai/dsh-vision-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { agentModelSelection } from '@deepseek-ai/dsh-agent'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { contentHasImage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'

/** Service name under which the bridge publishes its activation query. */
export const IMAGE_DEGRADATION_SERVICE = 'imageDegradation'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Activation query for the image-degradation capability this plugin provides. */
    imageDegradation: ImageDegradationService
  }
}

/** Query surface host admission preflights consult before refusing images. */
export interface ImageDegradationService {
  /** True when the bridge is configured and can describe images right now. */
  isActive(): Promise<boolean>
}

/** Default instruction sent to the vision model for every image. */
export const DEFAULT_PROMPT = '请用中文详细描述这张图片的内容，包括其中的文字、界面元素、图表与数据。'

/** Environment variable naming the vision API key when no literal is configured. */
export const DEFAULT_API_KEY_ENV = 'VISION_API_KEY'

/** Default directory under the session workspace that archived images are written to. */
export const DEFAULT_BASE_DIR = '.dsh-images'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'vision-bridge'

/** Services this plugin reads before `apply` runs. */
export const inject = ['attachments', 'llm']

/** Plugin config. */
export interface Config {
  /** Directory (under the session workspace) that archived images are written to. Defaults to `.dsh-images`. */
  baseDir?: string
  /** Legacy vision-endpoint fields, kept for config-surface compatibility; archiving never calls them. */
  apiKey?: string
  apiKeyEnv?: string
  baseURL?: string
  model?: string
  prompt?: string
}

export const Config: z<Config> = z.object({
  baseDir: z.string(),
  // Legacy vision-endpoint fields kept for config-surface compatibility.
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string(),
  prompt: z.string().default(DEFAULT_PROMPT),
})

/** Settings namespace edited by the web Plugins page. */
export const VISION_BRIDGE_SETTINGS_NAMESPACE = settingsNamespace('vision-bridge')

/** Resolved per-step archiving facts (the listener never touches raw config). */
interface ResolvedBridge {
  /** Directory under the session workspace that archived images are written to. */
  baseDir: string
}

/**
 * Project one resolved section into the facts the listener serves its next
 * step with.
 * @param config - the currently authoritative section.
 * @returns resolved facts for one pre-step.
 */
function resolveOptions(config: Config): ResolvedBridge {
  return { baseDir: config.baseDir ?? DEFAULT_BASE_DIR }
}

/** The outcome of one archiving pass. */
export interface ArchiveResult {
  /** The messages with image blocks replaced by path-bearing text. */
  messages: readonly UserMessage[]
}

/**
 * Archive every image block in a step's user messages to the workspace and
 * replace the block with a path-bearing text message, so a text-only model can
 * hand the file to a vision skill instead of receiving raw image bytes. Pure
 * and injectable for tests: the caller supplies the attachment reader and the
 * archiver.
 *
 * @param messages - the step messages as claimed by the pre-step waterfall.
 * @param readImage - resolves one image block's stored bytes.
 * @param archive - writes one stored image and returns its path.
 * @param signal - forwarded abort.
 * @returns the archiving outcome; `messages` is the original array when no
 *   block changed, and every failure degrades to an explicit failure text.
 */
export async function archiveImages(
  messages: readonly UserMessage[],
  readImage: (block: Extract<ContentBlock, { type: 'image' }>, signal?: AbortSignal) => Promise<StoredImageAttachment>,
  archive: (image: StoredImageAttachment, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
): Promise<ArchiveResult> {
  let changed = false
  const result: UserMessage[] = []
  for (const message of messages) {
    if (!contentHasImage(message.content)) {
      result.push(message)
      continue
    }
    // Count the images first so every replacement can name its position.
    const imageCount = message.content.filter(block => block.type === 'image').length
    let index = 0
    const blocks: ContentBlock[] = []
    for (const block of message.content) {
      if (block.type !== 'image') {
        blocks.push(block)
        continue
      }
      changed = true
      index += 1
      try {
        const stored = await readImage(block, signal)
        const path = await archive(stored, signal)
        // The label tells the model the bytes are NOT available to it: the
        // file is binary, so it must call a vision skill to recognize it.
        const label = imageCount === 1
          ? `[用户上传的图片已保存到 ${path}（二进制，模型无法直接读取；如需查看请调用 vision 技能识别该文件）]`
          : `[用户上传的图片（第 ${index}/${imageCount} 张）已保存到 ${path}（二进制，模型无法直接读取；如需查看请调用 vision 技能识别该文件）]`
        blocks.push({ type: 'text', text: label })
      } catch (error: unknown) {
        blocks.push({ type: 'text', text: `[图片保存失败: ${String(error)}]` })
      }
    }
    result.push({ ...message, content: blocks })
  }
  return changed ? { messages: result } : { messages }
}

/** Register the pre-step listener that degrades images for non-vision models. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, VISION_BRIDGE_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The listener projects the section per step, so a committed change needs
    // no re-registration.
    onChange: () => {},
  })

  // Host admission preflights (the Web prompt/selectModel gateways) ask this
  // service before refusing an image: archiving needs no external credential,
  // so the bridge is always active while mounted, and this pre-step listener
  // performs the archiving instead of the model request carrying raw bytes.
  ctx.provide(IMAGE_DEGRADATION_SERVICE, { isActive: async () => true })

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const resolved = resolveOptions(current())

    // A vision-capable model keeps the raw image: archiving only applies when
    // the exact target model declares no image modality. Unknown modality
    // (absent metadata) archives - an undeclared model cannot be trusted to
    // accept images.
    // The agent-scoped selection is the same source the host admission check
    // used (never a creation-time options snapshot): a model switched from
    // the Web UI must not be judged by the one the session was created with.
    const selection = agentModelSelection(agent.ctx)
    const selected = selection?.current
    const provider = selected?.provider ?? agent.options.provider
    const model = selected?.model ?? agent.options.model
    const supportsImage = provider !== undefined && model !== undefined
      ? await ctx.llm.resolveModelInfo(provider, model, signal).then(
        info => info.inputModalities?.includes('image') ?? false,
        () => false,
      )
      : false
    if (supportsImage) return decision

    const archived = await archiveImages(
      decision.messages,
      (block, signal) => ctx.attachments.readImage(block.attachment, signal),
      async (image) => {
        const cwd = agent.session.header.cwd
        const dir = join(cwd ?? process.cwd(), resolved.baseDir)
        await mkdir(dir, { recursive: true })
        const ext = extensionOf(image.ref.mediaType)
        // Attachment ids carry a `sha256:` prefix; `:` is illegal in Windows
        // file names (NTFS would store the bytes as an alternate data stream),
        // so the id is sanitized before it becomes a file name.
        const safeId = String(image.ref.attachmentId).replace(/[^a-zA-Z0-9_-]/g, '_')
        const file = join(dir, `${safeId}.${ext}`)
        await writeFile(file, image.data)
        return file
      },
      signal,
    )
    if (archived.messages === decision.messages) return decision
    // readonly is compile-time only; the array is a fresh mutable build or the
    // original mutable instance, so the cast is safe at runtime.
    return { kind: 'enter', messages: archived.messages as UserMessage[] }
  })
}

/** File extension for one accepted image media type. */
function extensionOf(mediaType: string): string {
  switch (mediaType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'bin'
  }
}
