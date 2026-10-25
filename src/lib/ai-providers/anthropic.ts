import type { ModelProvider } from '../ai-gateway'
import {
  asRecord,
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
 * Anthropic Messages API. Kept as a native adapter rather than routing Claude
 * through an OpenAI-compatible shim: the request and usage shapes differ, and
 * a shim would hide provider-specific errors during evaluation.
 */

export interface AnthropicRequest {
  model: string
  max_tokens: number
  temperature: number
  system: string
  messages: Array<{ role: 'user'; content: string }>
}

export function buildAnthropicRequest(
  profile: ProviderProfile,
  request: ProviderRequest,
): AnthropicRequest {
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
    max_tokens: Math.floor(maxTokens),
    temperature: 0,
    system: PROVIDER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: request.prompt }],
  }
}

export function anthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/v1')
    ? `${trimmed}/messages`
    : `${trimmed}/v1/messages`
}

function readAnthropicText(root: Record<string, unknown> | null): string {
  const content = root?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const record = asRecord(part)
      return record?.type === 'text' && typeof record.text === 'string'
        ? record.text
        : null
    })
    .filter((part): part is string => part !== null)
    .join('\n')
}

export function parseAnthropicResponse(
  profile: ProviderProfile,
  prompt: string,
  json: unknown,
): ProviderResponse {
  const root = asRecord(json)
  const text = readAnthropicText(root)
  if (text.trim() === '') {
    throw new AiProviderError(
      'response_invalid',
      'Provider response had no text',
      { providerId: profile.id },
    )
  }
  const usage = readNested(root, 'usage')
  const inputTokens =
    readNumber(usage, 'input_tokens') ?? estimateTokens(prompt)
  const outputTokens =
    readNumber(usage, 'output_tokens') ?? estimateTokens(text)

  return {
    text,
    tokensUsed:
      Math.max(1, Math.floor(inputTokens)) +
      Math.max(1, Math.floor(outputTokens)),
    inputTokens: Math.max(1, Math.floor(inputTokens)),
    outputTokens: Math.max(1, Math.floor(outputTokens)),
    costMicrousd: computeCostMicrousd(
      profile.pricing,
      Math.max(1, Math.floor(inputTokens)),
      Math.max(1, Math.floor(outputTokens)),
    ),
    reportedModel: readString(root, 'model') ?? undefined,
  }
}

export class AnthropicProvider implements ModelProvider {
  readonly name: string

  constructor(
    private readonly config: ResolvedProviderConfig,
    private readonly deps: ProviderDeps = {},
  ) {
    this.name = config.id
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const body = buildAnthropicRequest(this.config, request)
    const json = await postProviderJson(
      this.config.id,
      {
        url: anthropicMessagesUrl(this.config.baseUrl),
        headers: {
          'x-api-key': this.config.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body,
      },
      this.deps,
    )
    return parseAnthropicResponse(this.config, request.prompt, json)
  }
}
