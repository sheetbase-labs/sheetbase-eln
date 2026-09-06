import { describe, expect, it, vi } from 'vitest'

import type { AiContextActor, AiContextEnvelope } from './ai-context'
import { AI_CONTEXT_VERSION, DEFAULT_AI_CONTEXT_BUDGETS } from './ai-context'
import type { AiCitation } from './ai-retrieval'
import {
  GATEWAY_EXCERPT_CHARS,
  MODEL_MICROUSD_PER_TOKEN,
  ModelGatewayError,
  StubModelProvider,
  buildGatewayPrompt,
  callModel,
  estimateTokensFromChars,
  hashPrompt,
  type CallModelInput,
  type ModelProvider,
} from './ai-gateway'
import { logger } from './logger'
import { createMetricsRegistry } from './metrics'

const WS = '20000000-0000-4000-8000-000000000001'
const ACTOR: AiContextActor = { kind: 'user', id: 'user-1' }
const SECRET = 'sk-live-planted-secret-abcdef-12345'

function baseEnvelope(overrides: Partial<AiContextEnvelope> = {}): AiContextEnvelope {
  const envelope: AiContextEnvelope = {
    version: AI_CONTEXT_VERSION,
    actor: ACTOR,
    workspace: { id: WS, project: null },
    objects: [
      {
        kind: 'record',
        id: 'rec-1',
        title: 'Visible experiment',
        deepLink: null,
        freshness: 'live',
        pins: [],
        truncated: false,
        sections: [
          { heading: 'Summary', body: 'Benign summary of the experiment.', truncated: false },
        ],
      },
    ],
    omissions: [],
    budgets: {
      applied: DEFAULT_AI_CONTEXT_BUDGETS,
      usage: { chars: 400, sections: 1, rows: 0, objects: 1 },
    },
  }
  return Object.assign(envelope, overrides)
}

function baseCitations(): AiCitation[] {
  return [
    {
      kind: 'record',
      stableId: '11111111-0000-4000-8000-000000000001',
      identifier: 'EXP-2026-0001',
      recordKind: 'experiment',
      title: 'Visible experiment',
      deepLink: '/records/rec-1',
      versionPin: null,
      freshness: 'live',
      archived: false,
      matchedContext: 'kinetics <b>assay</b>',
      matchedField: 'title',
      rank: 0.9,
    },
  ]
}

function baseInput(overrides: Partial<CallModelInput> = {}): CallModelInput {
  return {
    model: 'sheetbase-assist-1',
    tools: [],
    contextEnvelope: baseEnvelope(),
    citations: baseCitations(),
    limits: { maxTokens: 10_000, maxCostMicrousd: 1_000_000 },
    ...overrides,
  }
}

async function gatewayError(promise: Promise<unknown>): Promise<ModelGatewayError> {
  const outcome: unknown = await promise.then(
    () => null,
    (error: unknown) => error,
  )
  expect(outcome).toBeInstanceOf(ModelGatewayError)
  if (!(outcome instanceof ModelGatewayError)) throw new Error('unreachable')
  return outcome
}

describe('ai-gateway allowlist', () => {
  it('serves an allowlisted model through the stub and echoes citations', async () => {
    const registry = createMetricsRegistry()
    const input = baseInput()
    const result = await callModel(ACTOR, input, { registry })

    expect(result.model).toBe('sheetbase-assist-1')
    expect(result.text).toContain('sheetbase-assist-1')
    expect(result.text).toContain(input.citations?.[0]?.stableId ?? '')
    expect(result.citations).toEqual(input.citations)
    expect(result.usage.tokensUsed).toBe(estimateTokensFromChars(result.text.length))
    expect(result.usage.costMicrousd).toBe(
      result.usage.tokensUsed * MODEL_MICROUSD_PER_TOKEN['sheetbase-assist-1'],
    )
  })

  it('is deterministic for identical inputs', async () => {
    const registry = createMetricsRegistry()
    const first = await callModel(ACTOR, baseInput(), { registry })
    const second = await callModel(ACTOR, baseInput(), { registry })
    expect(second.text).toBe(first.text)
    expect(second.usage).toEqual({ ...first.usage, latencyMs: expect.any(Number) as number })
  })

  it('rejects an unknown model fail-closed without touching the provider', async () => {
    const registry = createMetricsRegistry()
    let providerCalls = 0
    const provider: ModelProvider = {
      name: 'counting',
      async complete() {
        providerCalls += 1
        return { text: 'x', tokensUsed: 1, costMicrousd: 1 }
      },
    }
    const error = await gatewayError(
      callModel(ACTOR, baseInput({ model: 'gpt-evil-9' }), { registry, provider }),
    )
    expect(error.code).toBe('model_not_allowed')
    expect(providerCalls).toBe(0)
    expect(registry.render()).toContain(
      'sheetbase_model_errors_total{model="other",code="model_not_allowed"} 1',
    )
  })

  it('rejects an unknown tool fail-closed', async () => {
    const registry = createMetricsRegistry()
    let providerCalls = 0
    const provider: ModelProvider = {
      name: 'counting',
      async complete() {
        providerCalls += 1
        return { text: 'x', tokensUsed: 1, costMicrousd: 1 }
      },
    }
    const error = await gatewayError(
      callModel(ACTOR, baseInput({ tools: ['sheetbase.dataset_rows.commit', 'shell.exec'] }), {
        registry,
        provider,
      }),
    )
    expect(error.code).toBe('tool_not_allowed')
    expect(providerCalls).toBe(0)
  })

  it('accepts every canonical workflow tool', async () => {
    const registry = createMetricsRegistry()
    const result = await callModel(
      ACTOR,
      baseInput({ tools: ['sheetbase.dataset_rows.commit'] }),
      { registry },
    )
    expect(result.model).toBe('sheetbase-assist-1')
  })

  it('rejects context assembled for a different actor', async () => {
    const registry = createMetricsRegistry()
    const envelope = baseEnvelope({ actor: { kind: 'user', id: 'user-2' } })
    const error = await gatewayError(
      callModel(ACTOR, baseInput({ contextEnvelope: envelope }), { registry }),
    )
    expect(error.code).toBe('actor_mismatch')
  })
})

describe('ai-gateway budgets', () => {
  it('rejects estimated tokens beyond the call cap', async () => {
    const registry = createMetricsRegistry()
    const envelope = baseEnvelope()
    envelope.budgets.usage.chars = 40_000 // ~10k tokens
    const error = await gatewayError(
      callModel(ACTOR, baseInput({ contextEnvelope: envelope, limits: { maxTokens: 100, maxCostMicrousd: 1_000_000 } }), {
        registry,
      }),
    )
    expect(error.code).toBe('budget_exhausted')
  })

  it('counts prior usage against the caps', async () => {
    const registry = createMetricsRegistry()
    const error = await gatewayError(
      callModel(
        ACTOR,
        baseInput({ limits: { maxTokens: 120, maxCostMicrousd: 1_000_000, usedTokens: 100 } }),
        { registry },
      ),
    )
    expect(error.code).toBe('budget_exhausted')
  })

  it('rejects estimated cost beyond the call cap', async () => {
    const registry = createMetricsRegistry()
    const error = await gatewayError(
      callModel(
        ACTOR,
        baseInput({ limits: { maxTokens: 10_000, maxCostMicrousd: 1 } }),
        { registry },
      ),
    )
    expect(error.code).toBe('budget_exhausted')
  })

  it('rejects actual provider usage that overruns the budget', async () => {
    const registry = createMetricsRegistry()
    const greedy: ModelProvider = {
      name: 'greedy',
      async complete() {
        return { text: 'oversized', tokensUsed: 50_000, costMicrousd: 50 }
      },
    }
    const error = await gatewayError(
      callModel(
        ACTOR,
        baseInput({ limits: { maxTokens: 500, maxCostMicrousd: 1_000_000 } }),
        { registry, provider: greedy },
      ),
    )
    expect(error.code).toBe('budget_exhausted')
  })
})

describe('ai-gateway logging policy', () => {
  it('logs hashes, sizes and citation IDs by default — never prompt text, excerpts or secrets', async () => {
    const registry = createMetricsRegistry()
    const info = vi.spyOn(logger, 'info')
    try {
      // Secret material in a known prompt field (section body) plus
      // secret-shaped keys where free-form content could carry them.
      const envelope = baseEnvelope()
      envelope.objects[0].sections = [
        {
          heading: 'Summary',
          body: `Benign summary of the experiment. Operator note ${SECRET}.`,
          truncated: false,
          ...{ apiToken: SECRET },
        },
      ]
      const citations = [{ ...baseCitations()[0], ...{ sessionToken: SECRET } }]
      const input = baseInput({ contextEnvelope: envelope, citations })
      await callModel(ACTOR, input, { registry })

      const logged = info.mock.calls.map((call) => JSON.stringify(call[1] ?? null)).join('\n')
      expect(logged).not.toContain(SECRET)

      const fullPrompt = buildGatewayPrompt(envelope, citations)
      // The test is only meaningful if the prompt really carries the secret.
      expect(fullPrompt).toContain(SECRET)
      expect(logged).not.toContain(fullPrompt)

      // No prompt material at all: not even benign body/title fragments.
      expect(logged).not.toContain('Benign summary of the experiment.')
      expect(logged).not.toContain('Visible experiment')

      const callRecord = info.mock.calls.find((call) => call[0] === 'ai.gateway.call')
      expect(callRecord).toBeDefined()
      const fields = callRecord?.[1] as Record<string, unknown>
      expect(Object.keys(fields).sort()).toEqual(
        [
          'model',
          'tools',
          'actorKind',
          'actorId',
          'promptHash',
          'promptChars',
          'estimatedTokens',
          'estimatedCostMicrousd',
          'citationIds',
        ].sort(),
      )
      expect(fields['promptHash']).toBe(hashPrompt(fullPrompt))
      expect(fields['promptChars']).toBe(fullPrompt.length)
      expect(fields).not.toHaveProperty('promptExcerpt')
      expect(fields).not.toHaveProperty('debugPromptExcerpt')
      expect(fields['citationIds']).toEqual(citations.map((citation) => citation.stableId))

      const resultRecord = info.mock.calls.find((call) => call[0] === 'ai.gateway.result')
      expect(resultRecord).toBeDefined()
      const resultFields = resultRecord?.[1] as Record<string, unknown>
      expect(resultFields['promptHash']).toBe(hashPrompt(fullPrompt))
      expect(resultFields).not.toHaveProperty('text')
      expect(resultFields).not.toHaveProperty('outputExcerpt')
      expect(resultFields).not.toHaveProperty('promptExcerpt')
      expect(resultFields).not.toHaveProperty('debugPromptExcerpt')
    } finally {
      info.mockRestore()
    }
  })

  it('emits a redacted, capped debug excerpt only with explicit per-call opt-in', async () => {
    const envelope = baseEnvelope()
    envelope.objects[0].sections = [
      { heading: 'Summary', body: `Operator note ${SECRET}. ${'x'.repeat(600)}`, truncated: false },
    ]
    const citations = baseCitations()
    const fullPrompt = buildGatewayPrompt(envelope, citations)
    expect(fullPrompt.length).toBeGreaterThan(GATEWAY_EXCERPT_CHARS)
    // The secret sits early enough to fall inside the excerpt window, so the
    // redaction assertion below is meaningful rather than vacuous.
    expect(fullPrompt.indexOf(SECRET)).toBeLessThan(GATEWAY_EXCERPT_CHARS)

    // Default (and explicit false): no excerpt field at all, no secret in logs.
    for (const includeDebugExcerpt of [undefined, false] as const) {
      const registry = createMetricsRegistry()
      const info = vi.spyOn(logger, 'info')
      try {
        await callModel(
          ACTOR,
          baseInput({ contextEnvelope: envelope, citations, includeDebugExcerpt }),
          { registry },
        )
        const callRecord = info.mock.calls.find((call) => call[0] === 'ai.gateway.call')
        const fields = callRecord?.[1] as Record<string, unknown>
        expect(fields).not.toHaveProperty('debugPromptExcerpt')
        expect(fields).not.toHaveProperty('promptExcerpt')
        const logged = info.mock.calls.map((call) => JSON.stringify(call[1] ?? null)).join('\n')
        expect(logged).not.toContain(SECRET)
      } finally {
        info.mockRestore()
      }
    }

    // Explicit opt-in: redacted, capped, clearly marked debug-only.
    {
      const registry = createMetricsRegistry()
      const info = vi.spyOn(logger, 'info')
      try {
        await callModel(
          ACTOR,
          baseInput({ contextEnvelope: envelope, citations, includeDebugExcerpt: true }),
          { registry },
        )
        const callRecord = info.mock.calls.find((call) => call[0] === 'ai.gateway.call')
        const fields = callRecord?.[1] as Record<string, unknown>
        const excerpt = fields['debugPromptExcerpt']
        expect(typeof excerpt).toBe('string')
        expect(String(excerpt).length).toBeLessThanOrEqual(GATEWAY_EXCERPT_CHARS)
        expect(String(excerpt)).toContain('[redacted]')
        expect(String(excerpt)).not.toContain(SECRET)
        const logged = info.mock.calls.map((call) => JSON.stringify(call[1] ?? null)).join('\n')
        expect(logged).not.toContain(SECRET)
      } finally {
        info.mockRestore()
      }
    }
  })
})

describe('ai-gateway telemetry', () => {
  it('emits cost, latency and ok series for a successful call', async () => {
    const registry = createMetricsRegistry()
    const result = await callModel(ACTOR, baseInput(), { registry })

    const rendered = registry.render()
    expect(rendered).toContain(
      'sheetbase_model_calls_total{model="sheetbase-assist-1",outcome="ok"} 1',
    )
    expect(rendered).toContain(
      `sheetbase_model_cost_microusd_total{model="sheetbase-assist-1"} ${result.usage.costMicrousd}`,
    )
    expect(rendered).toContain(
      'sheetbase_model_duration_seconds_count{model="sheetbase-assist-1"} 1',
    )
  })

  it('emits the error series when the provider fails', async () => {
    const registry = createMetricsRegistry()
    const failing: ModelProvider = {
      name: 'failing',
      async complete() {
        throw new Error('boom')
      },
    }
    const error = await gatewayError(
      callModel(ACTOR, baseInput(), { registry, provider: failing }),
    )
    expect(error.code).toBe('provider_error')
    const rendered = registry.render()
    expect(rendered).toContain(
      'sheetbase_model_calls_total{model="sheetbase-assist-1",outcome="error"} 1',
    )
    expect(rendered).toContain(
      'sheetbase_model_errors_total{model="sheetbase-assist-1",code="provider_error"} 1',
    )
  })
})

describe('StubModelProvider', () => {
  it('charges fixture pricing deterministically', async () => {
    const stub = new StubModelProvider('sheetbase-summarise-1')
    const first = await stub.complete({ prompt: 'hello', maxTokens: 100, citationIds: ['a'] })
    const second = await stub.complete({ prompt: 'hello', maxTokens: 100, citationIds: ['a'] })
    expect(second).toEqual(first)
    expect(first.costMicrousd).toBe(
      first.tokensUsed * MODEL_MICROUSD_PER_TOKEN['sheetbase-summarise-1'],
    )
  })
})
