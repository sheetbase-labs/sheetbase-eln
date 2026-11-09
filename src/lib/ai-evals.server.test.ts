import { describe, expect, it, vi } from 'vitest'

import { EVAL_TASK_META } from './ai-eval-tasks'
import { toWireToolName } from './agent-tool-catalogue'
import {
  FIXTURE_WORKSPACE,
  createFixtureClient,
  evalTaskTool,
  runEvalTasks,
} from './ai-evals.server'
import type { ModelProvider } from './ai-gateway'

describe('checks for the assistant', () => {
  it('passes every check in tools mode against the fixture', async () => {
    const results = await runEvalTasks({ mode: 'tools' })
    expect(results.map((r) => r.taskKey)).toEqual(
      EVAL_TASK_META.map((t) => t.key),
    )
    const failed = results.filter((r) => r.status !== 'passed')
    expect(failed).toEqual([])
  })

  it('reports a check as failed when the answer is wrong', async () => {
    // A model that never looks anything up gets the lookups and cards wrong.
    const lazy: ModelProvider = {
      name: 'lazy',
      supportsTools: true,
      complete: vi.fn(),
      async *stream() {
        yield { type: 'text', delta: 'I do not know.' }
        yield { type: 'usage', tokensUsed: 5, costMicrousd: 0 }
      },
    }

    const results = await runEvalTasks({
      mode: 'model',
      harness: { deps: modelDeps(lazy) },
    })

    const byKey = new Map(results.map((r) => [r.taskKey, r]))
    expect(byKey.get('find.open-orders')?.status).toBe('failed')
    expect(byKey.get('propose.reagent-order')?.status).toBe('failed')
    // Guardrail checks do not depend on the model.
    expect(byKey.get('guardrails.always-off')?.status).toBe('passed')
  })

  it('passes in model mode when the model looks things up and answers from them', async () => {
    const careful: ModelProvider = {
      name: 'careful',
      supportsTools: true,
      complete: vi.fn(),
      async *stream(request) {
        const last = request.messages?.at(-1)

        if (last?.role === 'tool') {
          yield { type: 'text', delta: last.content }
        } else {
          const question = String(
            [...(request.messages ?? [])]
              .reverse()
              .find((m) => m.role === 'user')?.content,
          )

          const key = EVAL_TASK_META.find((t) => t.prompt === question)?.key
          const tool = key ? evalTaskTool(key) : undefined

          if (tool) {
            yield {
              type: 'tool_call',
              id: 'call-1',
              name: toWireToolName(tool.name),
              arguments: JSON.stringify(tool.args),
            }
          }
        }

        yield { type: 'usage', tokensUsed: 5, costMicrousd: 0 }
      },
    }

    const results = await runEvalTasks({
      mode: 'model',
      harness: { deps: modelDeps(careful) },
    })

    expect(results.filter((r) => r.status !== 'passed')).toEqual([])
  })
})

function modelDeps(provider: ModelProvider) {
  return {
    actor: { kind: 'user' as const, id: 'eval-fixture-user' },
    workspaceId: FIXTURE_WORKSPACE,
    settings: {
      enabled: true,
      providerProfile: 'p',
      model: 'sheetbase-assist-1' as const,
      cloudEgressEnabled: false,
      maxTokensPerCall: 100_000,
      maxCostMicrousdPerCall: 1_000_000,
      updatedByUserId: null,
      updatedAt: null,
    },
    profiles: [
      {
        id: 'p',
        label: 'P',
        kind: 'local' as const,
        model: 'm',
        dataClass: 'local' as const,
        keyAvailable: true,
      },
    ],
    providerConfigError: null,
    provider,
  }
}

describe('fixture client', () => {
  const client = createFixtureClient({
    things: [
      { id: 1, name: 'Alpha', status: 'open' },
      { id: 2, name: 'Beta', status: 'closed' },
      { id: 3, name: 'Gamma', status: 'open' },
    ],
  })

  it('filters, orders and limits like PostgREST', async () => {
    expect(
      await client.list('things', '?status=eq.open&order=name.desc'),
    ).toEqual([
      { id: 3, name: 'Gamma', status: 'open' },
      { id: 1, name: 'Alpha', status: 'open' },
    ])
    expect(await client.list('things', '?status=not.in.(open)')).toHaveLength(1)
    expect(
      await client.list('things', '?or=(name.ilike.*et*,id.eq.3)'),
    ).toHaveLength(2)
    expect(await client.list('things', '?limit=1')).toHaveLength(1)
  })

  it('is read-only', () => {
    expect(() => client.rpc('x', {})).toThrow('read-only')
  })
})
