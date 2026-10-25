import type { ModelProvider } from '../ai-gateway'
import {
  asRecord,
  joinUrl,
  postProviderJson,
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
  ResolvedProviderConfig,
} from './types'

/**
 * OpenAI-shaped chat completions. OpenRouter, self-hosted gateways and local
 * runtimes all speak this shape; the differences are the base URL, the auth
 * header and OpenRouter's optional cost accounting.
 */

export interface OpenAiCompatibleRequest {
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  max_tokens: number
  temperature: number
  stream: false
  usage?: { include: true }
}

export function buildOpenAiCompatibleRequest(
  profile: ProviderProfile,
  request: ProviderRequest,
): OpenAiCompatibleRequest {
  const estimatedInputTokens = estimateTokens(request.prompt)
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
  return {
    model: profile.model,
    messages: [
      { role: 'system', content: PROVIDER_SYSTEM_PROMPT },
      { role: 'user', content: request.prompt },
    ],
    max_tokens: Math.floor(maxTokens),
    temperature: 0,
    stream: false,
    ...(profile.kind === 'openrouter' ? { usage: { include: true } } : {}),
  }
}

function readMessageText(message: Record<string, unknown> | null): string {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        const record = asRecord(part)
        return record?.type === 'text' && typeof record.text === 'string'
          ? record.text
          : null
      })
      .filter((part): part is string => part !== null)
    if (parts.length > 0) return parts.join('\n')
  }
  return ''
}

export function parseOpenAiCompatibleResponse(
  profile: ProviderProfile,
  prompt: string,
  json: unknown,
): ProviderResponse {
  const root = asRecord(json)
  const choices = root?.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AiProviderError(
      'response_invalid',
      'Provider response had no choices',
      { providerId: profile.id },
    )
  }
  const first = asRecord(choices[0])
  const message = readNested(first, 'message')
  const text = readMessageText(message)
  if (text.trim() === '') {
    throw new AiProviderError(
      'response_invalid',
      'Provider response had no text',
      { providerId: profile.id },
    )
  }

  const usage = readNested(root, 'usage')
  const promptTokens =
    readNumber(usage, 'prompt_tokens') ??
    readNumber(usage, 'input_tokens') ??
    estimateTokens(prompt)
  const completionTokens =
    readNumber(usage, 'completion_tokens') ??
    readNumber(usage, 'output_tokens') ??
    estimateTokens(text)

  // OpenRouter reports authoritative USD cost when `usage.include` is set.
  // Use it when present; otherwise price the reported tokens at the profile's
  // published rates.
  const reportedUsd = readNumber(usage, 'cost')
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
    reportedModel: readString(root, 'model') ?? undefined,
  }
}

function requestHeaders(
  profile: ProviderProfile,
  apiKey: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {}
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  if (profile.kind === 'openrouter') {
    headers['http-referer'] = 'https://sheetbase.co.uk'
    headers['x-title'] = 'Sheetbase ELN'
  }
  return headers
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name: string

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
    return parseOpenAiCompatibleResponse(this.config, request.prompt, json)
  }
}
