import { z } from 'zod'

import type { ModelProvider } from '../ai-gateway'
import {
  asRecord,
  joinUrl,
  postProviderJson,
  postProviderSse,
  readNested,
  readNumber,
  readString,
} from './http'
import {
  AiProviderError,
  PROVIDER_SYSTEM_PROMPT,
  computeCostMicrousd,
  estimateTokens,
} from './types'
import type {
  ProviderDeps,
  ProviderProfile,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
  ProviderToolDef,
  ResolvedProviderConfig,
} from './types'

/**
 * OpenAI-shaped chat completions. OpenRouter, self-hosted gateways and local
 * runtimes all speak this shape; the differences are the base URL, the auth
 * header and OpenRouter's optional cost accounting.
 */

export type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface OpenAiCompatibleRequest {
  model: string
  messages: OpenAiMessage[]
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: ProviderToolDef['parameters']
    }
  }>
  tool_choice?: 'auto'
  max_tokens: number
  temperature: number
  stream: boolean
  stream_options?: { include_usage: true }
  usage?: { include: true }
}

/**
 * The context rides in the system message, so it stays pinned while the
 * conversation turns follow it. With no turns the context is the one user
 * message, as before.
 */
export function conversationMessages(
  request: ProviderRequest,
): OpenAiCompatibleRequest['messages'] {
  if (!request.messages || request.messages.length === 0) {
    return [
      { role: 'system', content: PROVIDER_SYSTEM_PROMPT },
      { role: 'user', content: request.prompt },
    ]
  }

  const system = [PROVIDER_SYSTEM_PROMPT, request.instructions, request.prompt]
    .filter(Boolean)
    .join('\n\n')

  return [
    { role: 'system', content: system },
    ...request.messages.map((turn): OpenAiMessage => {
      if (turn.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: turn.toolCallId,
          content: turn.content,
        }
      }

      if (turn.role === 'assistant' && 'toolCalls' in turn) {
        return {
          role: 'assistant',
          content: turn.content === '' ? null : turn.content,
          tool_calls: turn.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        }
      }

      return { role: turn.role, content: turn.content }
    }),
  ]
}

function promptChars(request: ProviderRequest): number {
  return (
    request.prompt.length +
    (request.instructions?.length ?? 0) +
    (request.tools ? JSON.stringify(request.tools).length : 0) +
    (request.messages ?? []).reduce(
      (n, turn) =>
        n +
        turn.content.length +
        ('toolCalls' in turn
          ? turn.toolCalls.reduce((m, call) => m + call.arguments.length, 0)
          : 0),
      0,
    )
  )
}

export function buildOpenAiCompatibleRequest(
  profile: ProviderProfile,
  request: ProviderRequest,
  options: { stream?: boolean } = {},
): OpenAiCompatibleRequest {
  const estimatedInputTokens = Math.max(1, Math.ceil(promptChars(request) / 4))

  const availableOutputTokens = Math.max(
    1,
    request.maxTokens - estimatedInputTokens,
  )

  const ceiling = profile.maxOutputTokens ?? availableOutputTokens
  const maxTokens = Math.min(availableOutputTokens, ceiling)

  if (!Number.isFinite(maxTokens) || maxTokens < 1) {
    throw new AiProviderError(
      'config_invalid',
      'The provider call has no positive token budget',
      { providerId: profile.id },
    )
  }

  const body: OpenAiCompatibleRequest = {
    model: profile.model,
    messages: conversationMessages(request),
    max_tokens: Math.floor(maxTokens),
    temperature: 0,
    stream: options.stream === true,
  }

  if (options.stream === true) body.stream_options = { include_usage: true }

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
    body.tool_choice = 'auto'
  }

  if (profile.kind === 'openrouter') body.usage = { include: true }

  return body
}

const contentSchema = z.union([z.string(), z.array(z.unknown())])

/** A chat message's `content`: plain text, or the multi-part form. */
type ReplyContent = z.infer<typeof contentSchema>

const contentPart = z.object({
  type: z.string().nullish(),
  text: z.string().nullish(),
})

function readMessageText(content: ReplyContent | null | undefined): string {
  const text = z.string().safeParse(content)

  if (text.success) return text.data

  const parts = (z.array(z.unknown()).safeParse(content).data ?? []).flatMap(
    (part) => {
      const decoded = contentPart.safeParse(part)

      return decoded.success &&
        decoded.data.type === 'text' &&
        decoded.data.text !== null &&
        decoded.data.text !== undefined
        ? [decoded.data.text]
        : []
    },
  )

  return parts.length > 0 ? parts.join('\n') : ''
}

const usageSchema = z.object({
  prompt_tokens: z.number().nullish(),
  input_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  cost: z.number().nullish(),
})

const replyChoiceSchema = z.object({
  message: z.object({ content: contentSchema.nullish() }).nullish(),
})

const replySchema = z.object({
  choices: z.array(z.unknown()).nullish(),
  usage: usageSchema.nullish(),
  model: z.string().nullish(),
})

/** A `data:` frame from the SSE stream, before it is trusted. */
function parseJsonFrame(
  frame: string,
): Parameters<typeof replySchema.safeParse>[0] {
  try {
    return JSON.parse(frame)
  } catch {
    return null
  }
}

const streamChunk = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: contentSchema.nullish(),
            tool_calls: z.array(z.unknown()).nullish(),
          })
          .nullish(),
      }),
    )
    .nullish(),
  usage: usageSchema.nullish(),
  model: z.string().nullish(),
})

/** One chat-completions reply, decoded from the provider's JSON. */
export type OpenAiCompatibleReply = z.infer<typeof replySchema>

/** Decode a provider reply; a non-object answer decodes to "no choices". */
export function decodeOpenAiCompatibleReply(
  body: Parameters<typeof replySchema.safeParse>[0],
): OpenAiCompatibleReply {
  const decoded = replySchema.safeParse(body)

  return decoded.success ? decoded.data : { choices: null }
}

export function parseOpenAiCompatibleResponse(
  profile: ProviderProfile,
  prompt: string,
  reply: OpenAiCompatibleReply,
): ProviderResponse {
  const choices = reply.choices

  if (!choices || choices.length === 0) {
    throw new AiProviderError(
      'response_invalid',
      'Provider response had no choices',
      { providerId: profile.id },
    )
  }

  const choice = replyChoiceSchema.safeParse(choices[0])

  const text = readMessageText(
    choice.success ? (choice.data.message?.content ?? null) : null,
  )

  if (text.trim() === '') {
    throw new AiProviderError(
      'response_invalid',
      'Provider response had no text',
      { providerId: profile.id },
    )
  }

  const usage = reply.usage

  const promptTokens =
    usage?.prompt_tokens ?? usage?.input_tokens ?? estimateTokens(prompt)

  const completionTokens =
    usage?.completion_tokens ?? usage?.output_tokens ?? estimateTokens(text)

  // OpenRouter reports authoritative USD cost when `usage.include` is set.
  // Use it when present; otherwise price the reported tokens at the profile's
  // published rates.
  const reportedUsd = usage?.cost ?? null

  const costMicrousd =
    reportedUsd !== null
      ? Math.max(0, Math.ceil(reportedUsd * 1_000_000))
      : computeCostMicrousd(profile.pricing, promptTokens, completionTokens)

  return {
    text,
    tokensUsed:
      Math.max(1, Math.floor(promptTokens)) +
      Math.max(1, Math.floor(completionTokens)),
    inputTokens: Math.max(1, Math.floor(promptTokens)),
    outputTokens: Math.max(1, Math.floor(completionTokens)),
    costMicrousd,
    reportedModel: reply.model ?? undefined,
  }
}

function requestHeaders(profile: ProviderProfile, apiKey: string | undefined) {
  const headers: [string, string][] = []

  if (apiKey) headers.push(['authorization', `Bearer ${apiKey}`])

  if (profile.kind === 'openrouter') {
    headers.push(['http-referer', 'https://sheetbase.co.uk'])
    headers.push(['x-title', 'Sheetbase ELN'])
  }

  return Object.fromEntries(headers)
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name: string
  readonly supportsTools = true

  constructor(
    private readonly config: ResolvedProviderConfig,
    private readonly deps: ProviderDeps = {},
  ) {
    this.name = config.id
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const body = buildOpenAiCompatibleRequest(this.config, request)

    const json = await postProviderJson(
      this.config.id,
      {
        url: joinUrl(this.config.baseUrl, 'chat/completions'),
        headers: requestHeaders(this.config, this.config.apiKey),
        body,
      },
      this.deps,
    )

    return parseOpenAiCompatibleResponse(
      this.config,
      request.prompt,
      decodeOpenAiCompatibleReply(json),
    )
  }

  async *stream(
    request: ProviderRequest,
  ): AsyncGenerator<ProviderStreamChunk, void, void> {
    const body = buildOpenAiCompatibleRequest(this.config, request, {
      stream: true,
    })

    let produced = ''
    let reported: ProviderStreamChunk | null = null

    // Tool calls arrive as fragments keyed by index; emit them whole at the end.
    const calls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >()

    for await (const data of postProviderSse(
      this.config.id,
      {
        url: joinUrl(this.config.baseUrl, 'chat/completions'),
        headers: requestHeaders(this.config, this.config.apiKey),
        body,
      },
      this.deps,
      request.signal,
    )) {
      if (data === '[DONE]') break

      const chunk = streamChunk.safeParse(parseJsonFrame(data))

      if (!chunk.success) {
        // Keep-alive comments and partial frames are not answers.
        continue
      }

      const root = chunk.data
      const delta = root.choices?.[0]?.delta

      if (delta?.tool_calls) {
        for (const raw of delta.tool_calls) {
          const fragment = asRecord(raw)
          const index = readNumber(fragment, 'index') ?? 0
          const fn = readNested(fragment, 'function')
          const call = calls.get(index) ?? { id: '', name: '', arguments: '' }
          call.id = readString(fragment, 'id') ?? call.id
          call.name += readString(fn, 'name') ?? ''
          call.arguments += readString(fn, 'arguments') ?? ''
          calls.set(index, call)
        }
      }

      const piece = readMessageText(delta?.content)

      if (piece !== '') {
        produced += piece
        yield { type: 'text', delta: piece }
      }

      const usage = root.usage

      if (usage) {
        const promptTokens =
          usage.prompt_tokens ?? estimateTokens(request.prompt)

        const completionTokens =
          usage.completion_tokens ?? estimateTokens(produced)

        const reportedUsd = usage.cost ?? null
        reported = {
          type: 'usage',
          tokensUsed:
            Math.max(1, Math.floor(promptTokens)) +
            Math.max(1, Math.floor(completionTokens)),
          costMicrousd:
            reportedUsd !== null
              ? Math.max(0, Math.ceil(reportedUsd * 1_000_000))
              : computeCostMicrousd(
                  this.config.pricing,
                  promptTokens,
                  completionTokens,
                ),
          reportedModel: root.model ?? undefined,
        }
      }
    }

    for (const [index, call] of [...calls.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      if (call.name === '') continue
      yield {
        type: 'tool_call',
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.arguments === '' ? '{}' : call.arguments,
      }
    }

    if (produced.trim() === '' && calls.size === 0) {
      throw new AiProviderError(
        'response_invalid',
        'Provider response had no text',
        { providerId: this.config.id },
      )
    }

    yield reported ?? {
      type: 'usage',
      tokensUsed: estimateTokens(request.prompt) + estimateTokens(produced),
      costMicrousd: 0,
    }
  }
}
