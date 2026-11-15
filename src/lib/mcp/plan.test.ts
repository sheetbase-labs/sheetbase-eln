import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { z } from 'zod'

import type { AiFeatureFlags } from '../ai-feature-flags'
import type { DataClient } from '../data-client'
import { handleMcpMessage } from './handler'
import type { McpContext } from './handler'
import { LAB_PLAN_TOOL_NAME, resolveReferences, runLabPlan } from './plan'
import type { LabPlanInput } from './plan'
import { testClient } from './test-transport'

const WS = '11111111-1111-4111-8111-111111111111'
const EXPERIMENT = '22222222-2222-4222-8222-222222222222'

const flags: AiFeatureFlags = {
  assistant: true,
  mcp_read: true,
  mcp_draft: true,
  mcp_workflow: true,
  mcp_admin_read: true,
  mcp_admin_propose: true,
  mcp_lab: true,
}

describe('resolveReferences', () => {
  const results = new Map<string, z.JSONType>([
    ['experiment', { id: EXPERIMENT, rows: [{ identifier: 'EXP-1' }] }],
  ])

  it('uses what an earlier step returned, anywhere in the arguments', () => {
    expect(
      resolveReferences(
        {
          p_record_id: { $ref: 'experiment.id' },
          p_items: [{ $ref: 'experiment.rows.0.identifier' }, 'plain'],
          p_count: 3,
        },
        results,
      ),
    ).toEqual({
      ok: true,
      value: {
        p_record_id: EXPERIMENT,
        p_items: ['EXP-1', 'plain'],
        p_count: 3,
      },
    })
  })

  it('names a step that has not run', () => {
    const resolved = resolveReferences({ $ref: 'later.id' }, results)

    expect(resolved.ok).toBe(false)
  })

  it('names a path that finds nothing', () => {
    expect(resolveReferences({ $ref: 'experiment.missing' }, results).ok).toBe(
      false,
    )
  })
})

describe('runLabPlan', () => {
  const plan: LabPlanInput = {
    steps: [
      { key: 'experiment', action: 'create_a', arguments: {} },
      {
        key: 'samples',
        action: 'create_b',
        arguments: { p_experiment: { $ref: 'experiment.id' } },
      },
      { key: 'analysis', action: 'create_c', arguments: {} },
    ],
  }

  it('runs the steps in order, feeding each result to the next', async () => {
    const run = vi.fn(
      (step: { action: string; arguments: { [name: string]: z.JSONType } }) =>
        Promise.resolve({
          ok: true as const,
          action: step.action,
          result: { id: EXPERIMENT },
        }),
    )

    const report = await runLabPlan(plan, run)

    expect(report.status).toBe('done')
    expect(run.mock.calls.map(([step]) => step.action)).toEqual([
      'create_a',
      'create_b',
      'create_c',
    ])

    expect(run.mock.calls[1][0].arguments).toEqual({ p_experiment: EXPERIMENT })
  })

  it('stops at a failure and says what did not run', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        action: 'create_a',
        result: { id: 'x' },
      })
      .mockResolvedValueOnce({
        ok: false,
        message: 'No such box.',
        code: 'bad',
      })

    const report = await runLabPlan(plan, run)

    expect(report.status).toBe('failed')
    expect(report.steps.map((step) => step.status)).toEqual([
      'done',
      'failed',
      'not_run',
    ])

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('stops when a step waits for a person to approve it', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        action: 'create_a',
        result: { id: 'x' },
      })
      .mockResolvedValueOnce({
        ok: 'waiting',
        action: 'create_b',
        message: 'waiting',
        request: { id: 'req-1', status: 'pending', level: 'ask' },
      })

    const report = await runLabPlan(plan, run)

    expect(report.status).toBe('waiting_for_approval')

    expect(report.steps[1]).toEqual({
      key: 'samples',
      status: 'waiting_for_approval',
      requestId: 'req-1',
    })

    expect(report.steps[2].status).toBe('not_run')
  })

  it('fails the plan on a reference it cannot resolve, without running it', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, action: 'create_a', result: {} })

    const report = await runLabPlan(plan, run)

    expect(report.status).toBe('failed')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('refuses two steps with the same key', async () => {
    const run = vi.fn()

    const report = await runLabPlan(
      {
        steps: [
          { key: 'same', action: 'a', arguments: {} },
          { key: 'same', action: 'b', arguments: {} },
        ],
      },
      run,
    )

    expect(report.status).toBe('failed')
    expect(run).not.toHaveBeenCalled()
  })
})

const ID1 = '33333333-3333-4333-8333-333333333333'

describe('sheetbase.lab.plan over MCP', () => {
  function ctx(
    rpc: Mock<DataClient['rpc']>,
    list?: Mock<DataClient['list']>,
  ): McpContext {
    return {
      workspaceId: WS,
      actor: { kind: 'user', id: 'user-1' },
      scopes: ['lab:write', 'lab:read', 'projects:write'],
      flags,
      client: testClient({
        rpc,
        list: list ?? vi.fn<DataClient['list']>().mockResolvedValue([]),
      }),
      credentialId: 'credential-1',
    }
  }

  async function call(
    args: { [name: string]: z.JSONType },
    context: McpContext,
  ) {
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: LAB_PLAN_TOOL_NAME, arguments: args },
      },
      context,
    )

    return z
      .object({
        result: z.object({
          isError: z.boolean().optional(),
          content: z.array(z.object({ text: z.string() })),
        }),
      })
      .parse(response).result
  }

  it('is listed with the lab action tool and not without lab actions', async () => {
    const names = async (context: McpContext) =>
      z
        .object({
          result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
        })
        .parse(
          await handleMcpMessage(
            { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
            context,
          ),
        )
        .result.tools.map((tool) => tool.name)

    const rpc = vi.fn<DataClient['rpc']>()

    expect(await names(ctx(rpc))).toContain(LAB_PLAN_TOOL_NAME)

    expect(
      await names({ ...ctx(rpc), flags: { ...flags, mcp_lab: false } }),
    ).not.toContain(LAB_PLAN_TOOL_NAME)
  })

  it('runs the steps through the agent permissions, one after the other', async () => {
    const rpc = vi.fn<DataClient['rpc']>().mockImplementation(async (name) => {
      if (name === 'request_agent_action') {
        return { id: 'req', status: 'approved', level: 'auto' }
      }

      return { id: EXPERIMENT }
    })

    const result = await call(
      {
        steps: [
          {
            key: 'one',
            action: 'archive_record',
            arguments: { p_record_id: ID1, p_expected_metadata_version: 1 },
          },
          {
            key: 'two',
            action: 'archive_record',
            arguments: {
              p_record_id: { $ref: 'one.id' },
              p_expected_metadata_version: 1,
            },
          },
        ],
      },
      ctx(rpc),
    )

    expect(result.isError).toBeUndefined()
    const report = JSON.parse(result.content[0].text)

    expect(report.status).toBe('done')
    const actions = rpc.mock.calls.filter(([name]) => name === 'archive_record')

    expect(actions[1][1]).toEqual({
      p_record_id: EXPERIMENT,
      p_expected_metadata_version: 1,
    })
  })

  it('refuses a plan with one step', async () => {
    const result = await call(
      { steps: [{ key: 'one', action: 'archive_record', arguments: {} }] },
      ctx(vi.fn<DataClient['rpc']>()),
    )

    expect(result.isError).toBe(true)
  })
})
