import { describe, expect, it, vi } from 'vitest'

import {
  AnthropicProvider,
  anthropicMessagesUrl,
  buildAnthropicRequest,
  parseAnthropicResponse,
} from './ai-providers/anthropic'
import {
  buildOpenAiCompatibleRequest,
  OpenAiCompatibleProvider,
  parseOpenAiCompatibleResponse,
} from './ai-providers/openai-compatible'
import {
  assertProviderProfile,
  createModelProvider,
  estimatedMicrousdPerToken,
  parseProviderProfiles,
} from './ai-providers/profiles'
import { AiProviderError } from './ai-providers/types'
import type { ProviderProfile } from './ai-providers/types'

const profile: ProviderProfile = {
  id: 'openrouter-default',
  label: 'OpenRouter',
  kind: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'anthropic/claude-sonnet-4.5',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  pricing: {
    inputMicrousdPerMillionTokens: 3_000_000,
    outputMicrousdPerMillionTokens: 15_000_000,
  },
}

const localProfile: ProviderProfile = {
  id: 'local-ollama',
  label: 'Local Ollama',
  kind: 'local',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'llama3.1:8b',
  pricing: {
    inputMicrousdPerMillionTokens: 0,
    outputMicrousdPerMillionTokens: 0,
  },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('provider profiles', () => {
  it('accepts the documented array and object forms', () => {
    expect(parseProviderProfiles(JSON.stringify([profile]))).toHaveLength(1)
    expect(
      parseProviderProfiles(JSON.stringify({ profiles: [profile] })),
    ).toHaveLength(1)
  })

  it('returns no profiles for an unset value', () => {
    expect(parseProviderProfiles(undefined)).toEqual([])
    expect(parseProviderProfiles('   ')).toEqual([])
  })

  it('rejects a cloud provider on plain HTTP', () => {
    expect(() =>
      assertProviderProfile({
        ...profile,
        baseUrl: 'http://openrouter.ai/api',
      }),
    ).toThrowError(AiProviderError)
  })

  it('allows a local provider on plain HTTP', () => {
    expect(() => assertProviderProfile(localProfile)).not.toThrow()
  })

  it('rejects credentials in a base URL', () => {
    expect(() =>
      assertProviderProfile({
        ...profile,
        baseUrl: 'https://user:pass@openrouter.ai/api/v1',
      }),
    ).toThrowError(/must not carry credentials/)
  })

  it('rejects a duplicate profile id', () => {
    expect(() =>
      parseProviderProfiles(JSON.stringify([profile, { ...profile }])),
    ).toThrowError(/duplicate id/)
  })

  it('rejects a cloud profile without an apiKeyEnv', () => {
    expect(() =>
      parseProviderProfiles(
        JSON.stringify([{ ...profile, apiKeyEnv: undefined }]),
      ),
    ).toThrowError(AiProviderError)
  })

  it('estimates the conservative per-token rate', () => {
    expect(estimatedMicrousdPerToken(profile.pricing)).toBe(15)
  })

  it('refuses to construct a cloud provider without a key', () => {
    expect(() => createModelProvider(profile, undefined)).toThrowError(
      /no resolved API key/,
    )
  })
})

describe('OpenAI-compatible request', () => {
  it('builds a bounded chat-completions request with the shared system rule', () => {
    const body = buildOpenAiCompatibleRequest(
      { ...profile, maxOutputTokens: 500 },
      { prompt: 'Summarise this notebook.', maxTokens: 800, citationIds: [] },
    )
    expect(body.model).toBe('anthropic/claude-sonnet-4.5')
    expect(body.max_tokens).toBe(500)
    expect(body.temperature).toBe(0)
    expect(body.stream).toBe(false)
    expect(body.messages[0]?.role).toBe('system')
    expect(body.messages[1]?.content).toBe('Summarise this notebook.')
  })

  it('reserves the estimated prompt tokens inside the call budget', () => {
    const body = buildOpenAiCompatibleRequest(profile, {
      prompt: 'x'.repeat(400),
      maxTokens: 200,
      citationIds: [],
    })
    // ~100 input tokens, so at most 100 output tokens remain under the cap.
    expect(body.max_tokens).toBe(100)
  })

  it('parses text and provider-reported OpenRouter cost', () => {
    const parsed = parseOpenAiCompatibleResponse(profile, 'prompt', {
      model: 'anthropic/claude-sonnet-4.5',
      choices: [
        { message: { role: 'assistant', content: 'Grounded answer.' } },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.00042 },
    })
    expect(parsed.text).toBe('Grounded answer.')
    expect(parsed.inputTokens).toBe(10)
    expect(parsed.outputTokens).toBe(20)
    expect(parsed.costMicrousd).toBe(420)
    expect(parsed.reportedModel).toBe('anthropic/claude-sonnet-4.5')
  })

  it('prices reported tokens when the provider omits cost', () => {
    const parsed = parseOpenAiCompatibleResponse(profile, 'prompt', {
      choices: [{ message: { content: 'Answer.' } }],
      usage: { prompt_tokens: 1_000, completion_tokens: 1_000 },
    })
    // 1,000 × 3 µUSD + 1,000 × 15 µUSD = 18,000 µUSD.
    expect(parsed.costMicrousd).toBe(18_000)
  })

  it('rejects a response with no choices', () => {
    expect(() =>
      parseOpenAiCompatibleResponse(profile, 'prompt', { choices: [] }),
    ).toThrowError(/no choices/)
  })
})

describe('Anthropic request', () => {
  it('joins /v1 without duplicating it', () => {
    expect(anthropicMessagesUrl('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
    expect(anthropicMessagesUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
  })

  it('builds a native Messages request and parses its content blocks', () => {
    const config = {
      ...profile,
      kind: 'anthropic' as const,
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
    }
    const body = buildAnthropicRequest(config, {
      prompt: 'Explain the validation error.',
      maxTokens: 400,
      citationIds: [],
    })
    expect(body.system).toContain('Use only the supplied Sheetbase context')
    expect(body.messages).toEqual([
      { role: 'user', content: 'Explain the validation error.' },
    ])
    const parsed = parseAnthropicResponse(config, 'prompt', {
      model: 'claude-sonnet-4-5',
      content: [
        { type: 'text', text: 'First.' },
        { type: 'text', text: 'Second.' },
      ],
      usage: { input_tokens: 12, output_tokens: 34 },
    })
    expect(parsed.text).toBe('First.\nSecond.')
    expect(parsed.costMicrousd).toBe(546)
  })
})

describe('provider transports', () => {
  it('sends the OpenRouter request to the right URL with the key and usage flag', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        model: 'anthropic/claude-sonnet-4.5',
        choices: [{ message: { content: 'Answer.' } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    )
    const fetchImpl = fetchMock as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider(
      { ...profile, apiKey: 'test-key-not-real' },
      { fetchImpl },
    )
    const result = await provider.complete({
      prompt: 'Prompt.',
      maxTokens: 100,
      citationIds: [],
    })

    expect(result.text).toBe('Answer.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer test-key-not-real')
    expect(headers.get('x-title')).toBe('Sheetbase ELN')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.usage).toEqual({ include: true })
    expect(body.model).toBe('anthropic/claude-sonnet-4.5')
  })

  it('sends the Anthropic key in x-api-key, never in the URL', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        content: [{ type: 'text', text: 'Answer.' }],
        usage: { input_tokens: 3, output_tokens: 4 },
      }),
    )
    const fetchImpl = fetchMock as unknown as typeof fetch

    const provider = new AnthropicProvider(
      {
        ...profile,
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        apiKey: 'test-key-not-real',
      },
      { fetchImpl },
    )
    await provider.complete({
      prompt: 'Prompt.',
      maxTokens: 100,
      citationIds: [],
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(new Headers(init.headers).get('x-api-key')).toBe('test-key-not-real')
  })

  it('turns a non-2xx response into an HTTP error without reading the body', async () => {
    const cancel = vi.fn()
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('should not be read'))
            },
            cancel,
          }),
          { status: 429 },
        ),
    ) as unknown as typeof fetch
    const provider = new OpenAiCompatibleProvider(
      { ...profile, apiKey: 'test-key-not-real' },
      { fetchImpl },
    )
    await expect(
      provider.complete({ prompt: 'Prompt.', maxTokens: 10, citationIds: [] }),
    ).rejects.toMatchObject({ code: 'http', status: 429 })
  })

  it('rejects a malformed JSON body', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not-json', { status: 200 }),
    ) as unknown as typeof fetch
    const provider = new OpenAiCompatibleProvider(
      { ...profile, apiKey: 'test-key-not-real' },
      { fetchImpl },
    )
    await expect(
      provider.complete({ prompt: 'Prompt.', maxTokens: 10, citationIds: [] }),
    ).rejects.toMatchObject({ code: 'response_invalid' })
  })

  it('allows a local provider with no key', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: 'Local answer.' } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    )
    const fetchImpl = fetchMock as unknown as typeof fetch
    const provider = new OpenAiCompatibleProvider(localProfile, { fetchImpl })
    const result = await provider.complete({
      prompt: 'Prompt.',
      maxTokens: 100,
      citationIds: [],
    })
    expect(result.text).toBe('Local answer.')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('authorization')).toBeNull()
  })
})
