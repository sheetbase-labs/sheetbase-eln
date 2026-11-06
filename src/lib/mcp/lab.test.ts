import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import { AI_FEATURE_FLAGS } from '../ai-feature-flags'
import type { AiFeatureFlags } from '../ai-feature-flags'
import { LAB_RPCS } from '../lab-api-surface'
import { handleMcpMessage } from './handler'
import type { McpContext } from './handler'
import { LAB_ACT_TOOL_NAME } from './lab'

const ORDER_ID = '33333333-3333-4333-8333-333333333333'

const flags = Object.fromEntries(
  AI_FEATURE_FLAGS.map((flag) => [flag.key, true]),
) as AiFeatureFlags

function client(rpc = vi.fn(async () => ({ id: ORDER_ID }))): DataClient {
  return {
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    rpc,
    insert: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
  } as unknown as DataClient
}

function ctx(overrides: Partial<McpContext> = {}): McpContext {
  return {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    actor: { kind: 'user', id: 'user-1' },
    scopes: ['lab:write', 'lab:read'],
    flags,
    client: client(),
    credentialId: 'credential-1',
    ...overrides,
  }
}

async function call(args: Record<string, unknown>, context: McpContext) {
  const response = (await handleMcpMessage(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: LAB_ACT_TOOL_NAME, arguments: args },
    },
    context,
  )) as unknown as {
    result: { isError?: boolean; content: { text: string }[] }
  }
  return response.result
}

async function toolNames(context: McpContext): Promise<string[]> {
  const response = (await handleMcpMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    context,
  )) as unknown as { result: { tools: { name: string }[] } }
  return response.result.tools.map((tool) => tool.name)
}

describe('MCP lab actions', () => {
  it('is offered to a personal token with a lab scope and the workspace flag', async () => {
    expect(await toolNames(ctx())).toContain(LAB_ACT_TOOL_NAME)
  })

  it('is hidden without the flag, a lab scope or a person', async () => {
    expect(
      await toolNames(ctx({ flags: { ...flags, mcp_lab: false } })),
    ).not.toContain(LAB_ACT_TOOL_NAME)
    expect(await toolNames(ctx({ scopes: ['projects:read'] }))).not.toContain(
      LAB_ACT_TOOL_NAME,
    )
    expect(
      await toolNames(
        ctx({ actor: { kind: 'service_credential', id: 'svc' } }),
      ),
    ).not.toContain(LAB_ACT_TOOL_NAME)
  })

  it('calls the matching RPC with validated arguments', async () => {
    const rpc = vi.fn(async () => ({ id: ORDER_ID }))
    const result = await call(
      {
        action: 'cancel_reagent_order',
        arguments: { p_order_id: ORDER_ID, p_reason: 'duplicate' },
      },
      ctx({ client: client(rpc) }),
    )
    expect(result.isError).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('cancel_reagent_order', {
      p_order_id: ORDER_ID,
      p_reason: 'duplicate',
    })
  })

  it('rejects unknown arguments, bad ids and missing required ones', async () => {
    const rpc = vi.fn()
    const context = ctx({ client: client(rpc) })
    expect(
      (await call({ action: 'cancel_reagent_order', arguments: {} }, context))
        .isError,
    ).toBe(true)
    expect(
      (
        await call(
          { action: 'cancel_reagent_order', arguments: { p_order_id: 'nope' } },
          context,
        )
      ).isError,
    ).toBe(true)
    expect(
      (
        await call(
          {
            action: 'cancel_reagent_order',
            arguments: { p_order_id: ORDER_ID, extra: 1 },
          },
          context,
        )
      ).isError,
    ).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('needs the scope of the action: a read scope cannot write', async () => {
    const rpc = vi.fn()
    const result = await call(
      { action: 'cancel_reagent_order', arguments: { p_order_id: ORDER_ID } },
      ctx({ scopes: ['lab:read'], client: client(rpc) }),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('lab:write')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a service credential and a workspace that has not switched it on', async () => {
    const rpc = vi.fn()
    const service = await call(
      { action: 'cancel_reagent_order', arguments: { p_order_id: ORDER_ID } },
      ctx({
        actor: { kind: 'service_credential', id: 'svc' },
        client: client(rpc),
      }),
    )
    expect(service.isError).toBe(true)
    const off = await call(
      { action: 'cancel_reagent_order', arguments: { p_order_id: ORDER_ID } },
      ctx({ flags: { ...flags, mcp_lab: false }, client: client(rpc) }),
    )
    expect(off.isError).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lists every lab action in the tool description', async () => {
    const response = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      ctx(),
    )) as unknown as {
      result: { tools: { name: string; description: string }[] }
    }
    const tool = response.result.tools.find((t) => t.name === LAB_ACT_TOOL_NAME)
    for (const name of Object.keys(LAB_RPCS)) {
      expect(tool?.description).toContain(`- ${name}(`)
    }
  })
})
