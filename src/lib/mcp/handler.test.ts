import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import { AI_FEATURE_FLAGS } from '../ai-feature-flags'
import type { AiFeatureFlags } from '../ai-feature-flags'
import { CONTEXT_TOOL_NAME, handleMcpMessage } from './handler'
import type { McpContext } from './handler'
import { JSON_RPC_ERRORS } from './protocol'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const DATASET_ID = '22222222-2222-4222-8222-222222222222'

function fakeClient(overrides: Partial<DataClient> = {}): DataClient {
  return {
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    rpc: vi.fn(async () => ({})),
    insert: vi.fn(async () => ({})),
    patch: vi.fn(async () => []),
    remove: vi.fn(async () => []),
    ...overrides,
  } as DataClient
}

const allFeatureFlags = Object.fromEntries(
  AI_FEATURE_FLAGS.map((flag) => [flag.key, true]),
) as AiFeatureFlags

function withFlags(overrides: Partial<AiFeatureFlags>): AiFeatureFlags {
  return { ...allFeatureFlags, ...overrides }
}

function context(
  scopes: McpContext['scopes'],
  client: DataClient = fakeClient(),
  actor: McpContext['actor'] = { kind: 'user', id: 'user-1' },
  flags: AiFeatureFlags = allFeatureFlags,
): McpContext {
  return {
    workspaceId: WORKSPACE_ID,
    actor,
    scopes,
    flags,
    client,
    credentialId: 'credential-1',
  }
}

interface TestResponse {
  result?: Record<string, unknown>
  error?: { code: number }
}

async function request(
  method: string,
  params: Record<string, unknown>,
  ctx: McpContext,
): Promise<TestResponse | null> {
  return (await handleMcpMessage(
    { jsonrpc: '2.0', id: 1, method, params },
    ctx,
  )) as unknown as TestResponse | null
}

describe('MCP initialize and discovery', () => {
  it('advertises the supported protocol, tools, resources and prompts', async () => {
    const response = await request('initialize', {}, context(['datasets:read']))
    expect(response).not.toBeNull()
    const result = response?.result as Record<string, unknown>
    expect(result.protocolVersion).toBe('2025-06-18')
    expect(result.serverInfo).toMatchObject({ name: 'sheetbase' })
    expect(result.instructions).toContain('propose_agent_operation')
    const capabilities = result.capabilities as Record<string, unknown>
    expect(capabilities).toHaveProperty('tools')
    expect(capabilities).toHaveProperty('resources')
    expect(capabilities).toHaveProperty('prompts')
  })

  it('lists only tools the credential can use', async () => {
    const readOnly = await request('tools/list', {}, context(['datasets:read']))
    const readTools = (readOnly?.result as { tools: Array<{ name: string }> })
      .tools
    expect(readTools.map((tool) => tool.name)).toContain(
      'sheetbase.dataset_rows.query',
    )
    expect(readTools.map((tool) => tool.name)).not.toContain(
      'sheetbase.pipeline_definition.draft',
    )
    expect(readTools.map((tool) => tool.name)).toContain(CONTEXT_TOOL_NAME)

    const writer = await request(
      'tools/list',
      {},
      context(['agent_operations:write', 'pipelines:write']),
    )
    const writeTools = (writer?.result as { tools: Array<{ name: string }> })
      .tools
    expect(writeTools.map((tool) => tool.name)).toContain(
      'sheetbase.pipeline_definition.draft',
    )
    expect(writeTools.map((tool) => tool.name)).not.toContain(CONTEXT_TOOL_NAME)

    const underScoped = await request(
      'tools/list',
      {},
      context(['agent_operations:write']),
    )
    const underScopedTools = (
      underScoped?.result as { tools: Array<{ name: string }> }
    ).tools
    expect(underScopedTools.map((tool) => tool.name)).not.toContain(
      'sheetbase.pipeline_definition.draft',
    )
  })

  it('publishes object-shaped JSON Schema for every tool', async () => {
    const response = await request(
      'tools/list',
      {},
      context(['datasets:read', 'agent_operations:write', 'pipelines:write']),
    )
    const tools = (
      response?.result as {
        tools: Array<{ inputSchema: Record<string, unknown> }>
      }
    ).tools
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
    }
  })
})

describe('MCP read tools', () => {
  it('maps the dataset read tool onto the canonical RPC arguments', async () => {
    const rpc = vi.fn(async () => ({
      rows: [],
      total: 0,
    })) as unknown as DataClient['rpc']
    const client = fakeClient({ rpc })
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.dataset_rows.query',
        arguments: { datasetId: DATASET_ID, limit: 10 },
      },
      context(['datasets:read'], client),
    )
    expect(rpc).toHaveBeenCalledWith('query_dataset_rows', {
      p_dataset_id: DATASET_ID,
      p_limit: 10,
      p_offset: 0,
    })
    expect(response?.result).toMatchObject({
      content: [{ type: 'text' }],
      structuredContent: { rows: [], total: 0 },
    })
  })

  it('refuses a tool the credential has no scope for', async () => {
    const client = fakeClient()
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.dataset_rows.query',
        arguments: { datasetId: DATASET_ID },
      },
      context(['projects:read'], client),
    )
    expect(client.rpc).not.toHaveBeenCalled()
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('rejects arguments that do not match the schema', async () => {
    const client = fakeClient()
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.dataset_rows.query',
        arguments: { datasetId: 'not-a-uuid' },
      },
      context(['datasets:read'], client),
    )
    expect(client.rpc).not.toHaveBeenCalled()
    expect(response?.result).toMatchObject({ isError: true })
  })
})

describe('MCP draft tools', () => {
  it('wraps a draft in propose_agent_operation with MCP provenance', async () => {
    const proposal = { id: 'proposal-1', status: 'pending' }
    const rpc = vi.fn(async () => proposal) as unknown as DataClient['rpc']
    const client = fakeClient({ rpc })
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.pipeline_definition.draft',
        arguments: {
          kind: 'pipeline_definition.create',
          workspaceId: WORKSPACE_ID,
          key: 'qc_check',
          name: 'QC check',
        },
        _meta: {
          clientName: 'Claude Code',
          modelProvider: 'anthropic',
          modelName: 'claude-sonnet-5',
          idempotencyKey: 'idem-1',
        },
      },
      context(['agent_operations:write', 'pipelines:write'], client),
    )

    expect(rpc).toHaveBeenCalledWith(
      'propose_agent_operation',
      expect.objectContaining({
        p_workspace_id: WORKSPACE_ID,
        p_idempotency_key: 'idem-1',
        p_operation: expect.objectContaining({
          kind: 'pipeline_definition.create',
          key: 'qc_check',
        }),
        p_provenance: expect.objectContaining({
          agentName: 'Claude Code',
          model: expect.objectContaining({
            provider: 'anthropic',
            name: 'claude-sonnet-5',
          }),
        }),
      }),
    )
    expect(response?.result).toMatchObject({
      structuredContent: proposal,
    })
  })

  it('refuses a draft when the token lacks the operation write scope', async () => {
    const client = fakeClient()
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.pipeline_definition.draft',
        arguments: {
          kind: 'pipeline_definition.create',
          workspaceId: WORKSPACE_ID,
          key: 'qc_check',
          name: 'QC check',
        },
      },
      context(['agent_operations:write'], client),
    )
    expect(client.rpc).not.toHaveBeenCalled()
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('lists the notebook block tool only with the projects write scope', async () => {
    const scoped = await request(
      'tools/list',
      {},
      context(['agent_operations:write', 'projects:write']),
    )
    expect(
      (scoped?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).toContain('sheetbase.notebook_block.insert')

    const underScoped = await request(
      'tools/list',
      {},
      context(['agent_operations:write']),
    )
    expect(
      (underScoped?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).not.toContain('sheetbase.notebook_block.insert')
  })

  it('wraps a notebook block insert in a proposal with its revision', async () => {
    const proposal = { id: 'proposal-notebook', status: 'pending' }
    const rpc = vi.fn(async () => proposal) as unknown as DataClient['rpc']
    const client = fakeClient({ rpc })
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.notebook_block.insert',
        arguments: {
          kind: 'notebook_block.insert',
          recordId: WORKSPACE_ID,
          afterBlockId: null,
          block: {
            type: 'paragraph',
            payload: { text: 'Prepared sample.' },
            payloadSchemaVersion: 1,
          },
          expectedRevision: 7,
        },
        _meta: { idempotencyKey: 'idem-notebook' },
      },
      context(['agent_operations:write', 'projects:write'], client),
    )

    expect(rpc).toHaveBeenCalledWith(
      'propose_agent_operation',
      expect.objectContaining({
        p_workspace_id: WORKSPACE_ID,
        p_idempotency_key: 'idem-notebook',
        p_operation: {
          kind: 'notebook_block.insert',
          recordId: WORKSPACE_ID,
          afterBlockId: null,
          block: {
            type: 'paragraph',
            payload: { text: 'Prepared sample.' },
            payloadSchemaVersion: 1,
          },
          expectedRevision: 7,
        },
      }),
    )
    expect(response?.result).toMatchObject({
      structuredContent: proposal,
    })
  })

  it('refuses a notebook block proposal without projects:write', async () => {
    const client = fakeClient()
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.notebook_block.insert',
        arguments: {
          kind: 'notebook_block.insert',
          recordId: WORKSPACE_ID,
          block: { type: 'paragraph', payload: {} },
          expectedRevision: 1,
        },
      },
      context(['agent_operations:write'], client),
    )
    expect(client.rpc).not.toHaveBeenCalled()
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('refuses an operation that targets another workspace', async () => {
    const client = fakeClient()
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.pipeline_definition.draft',
        arguments: {
          kind: 'pipeline_definition.create',
          workspaceId: '33333333-3333-4333-8333-333333333333',
          key: 'qc_check',
          name: 'QC check',
        },
      },
      context(['agent_operations:write'], client),
    )
    expect(client.rpc).not.toHaveBeenCalled()
    expect(response?.result).toMatchObject({ isError: true })
  })
})

describe('MCP workspace AI access flags', () => {
  it('hides and refuses read tools when mcp_read is off', async () => {
    const client = fakeClient()
    const flags = withFlags({ mcp_read: false })
    const list = await request(
      'tools/list',
      {},
      context(['datasets:read'], client, undefined, flags),
    )
    const names = (
      list?.result as { tools: Array<{ name: string }> }
    ).tools.map((tool) => tool.name)
    expect(names).not.toContain(CONTEXT_TOOL_NAME)
    expect(names).not.toContain('sheetbase.dataset_rows.query')

    const call = await request(
      'tools/call',
      {
        name: 'sheetbase.dataset_rows.query',
        arguments: { datasetId: DATASET_ID },
      },
      context(['datasets:read'], client, undefined, flags),
    )
    expect(client.rpc).not.toHaveBeenCalled()
    expect(call?.result).toMatchObject({ isError: true })
  })

  it('hides and refuses draft tools when mcp_draft is off', async () => {
    const client = fakeClient()
    const flags = withFlags({ mcp_draft: false })
    const scopes = ['agent_operations:write', 'pipelines:write'] as const
    const list = await request(
      'tools/list',
      {},
      context([...scopes], client, undefined, flags),
    )
    const names = (
      list?.result as { tools: Array<{ name: string }> }
    ).tools.map((tool) => tool.name)
    expect(names).not.toContain('sheetbase.pipeline_definition.draft')

    const call = await request(
      'tools/call',
      {
        name: 'sheetbase.pipeline_definition.draft',
        arguments: {
          kind: 'pipeline_definition.create',
          workspaceId: WORKSPACE_ID,
          key: 'qc_check',
          name: 'QC check',
        },
      },
      context([...scopes], client, undefined, flags),
    )
    expect(client.rpc).not.toHaveBeenCalledWith(
      'propose_agent_operation',
      expect.anything(),
    )
    expect(call?.result).toMatchObject({ isError: true })
  })

  it('hides workflow tools when mcp_workflow is off', async () => {
    const scopes = [
      'agent_operations:write',
      'schema:write',
      'pipelines:write',
      'datasets:write',
    ] as const
    const enabled = await request(
      'tools/list',
      {},
      context([...scopes], fakeClient(), undefined, allFeatureFlags),
    )
    expect(
      (enabled?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).toContain('sheetbase.agent.workflow_create')

    const disabled = await request(
      'tools/list',
      {},
      context(
        [...scopes],
        fakeClient(),
        undefined,
        withFlags({ mcp_workflow: false }),
      ),
    )
    expect(
      (disabled?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).not.toContain('sheetbase.agent.workflow_create')
  })

  it('hides and refuses admin reads when mcp_admin_read is off', async () => {
    const client = fakeClient()
    const flags = withFlags({ mcp_admin_read: false })
    const list = await request(
      'tools/list',
      {},
      context(['admin:read'], client, undefined, flags),
    )
    expect(
      (list?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).not.toContain('sheetbase.admin.read')

    const call = await request(
      'tools/call',
      {
        name: 'sheetbase.admin.read',
        arguments: { resource: 'workspace' },
      },
      context(['admin:read'], client, undefined, flags),
    )
    expect(client.rpc).not.toHaveBeenCalled()
    expect(call?.result).toMatchObject({ isError: true })
  })

  it('hides and refuses admin proposals when mcp_admin_propose is off', async () => {
    const client = fakeClient()
    const scopes = ['agent_operations:write', 'admin:write'] as const
    const flags = withFlags({ mcp_admin_propose: false })
    const list = await request(
      'tools/list',
      {},
      context([...scopes], client, undefined, flags),
    )
    expect(
      (list?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).not.toContain('sheetbase.workspace_ai_settings.update')

    const call = await request(
      'tools/call',
      {
        name: 'sheetbase.workspace_ai_settings.update',
        arguments: {
          kind: 'workspace_ai_settings.update',
          workspaceId: WORKSPACE_ID,
          enabled: true,
          providerProfile: 'local',
          model: 'sheetbase-assist-1',
          cloudEgressEnabled: false,
          maxTokensPerCall: 1000,
          maxCostMicrousdPerCall: 0,
        },
      },
      context([...scopes], client, undefined, flags),
    )
    expect(client.rpc).not.toHaveBeenCalledWith(
      'propose_agent_operation',
      expect.anything(),
    )
    expect(call?.result).toMatchObject({ isError: true })
  })

  it('does not let a flag substitute for a missing scope', async () => {
    const list = await request(
      'tools/list',
      {},
      context(['datasets:read'], fakeClient(), undefined, allFeatureFlags),
    )
    expect(
      (list?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).not.toContain('sheetbase.admin.read')
  })
})

describe('MCP canonical read', () => {
  it('lists and reads an allowlisted collection with its scope', async () => {
    const list = vi.fn(async () => [
      { id: 'ds-1', name: 'Growth' },
    ]) as unknown as DataClient['list']
    const client = fakeClient({ list })
    const tools = await request(
      'tools/list',
      {},
      context(['datasets:read'], client),
    )
    expect(
      (tools?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).toContain('sheetbase.canonical.read')

    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.canonical.read',
        arguments: { resource: 'datasets', limit: 5 },
      },
      context(['datasets:read'], client),
    )
    expect(list).toHaveBeenCalledWith(
      'datasets',
      expect.stringContaining('select='),
    )
    expect(response?.result).toMatchObject({
      structuredContent: { resource: 'datasets', returned: 1 },
    })
  })

  it('refuses a resource the credential has no read scope for', async () => {
    const client = fakeClient()
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.canonical.read',
        arguments: { resource: 'pipelines', limit: 5 },
      },
      context(['datasets:read'], client),
    )
    expect(client.list).not.toHaveBeenCalled()
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('refuses an unpublished filter column before querying', async () => {
    const client = fakeClient()
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.canonical.read',
        arguments: {
          resource: 'datasets',
          filters: { not_a_column: 'x' },
        },
      },
      context(['datasets:read'], client),
    )
    expect(client.list).not.toHaveBeenCalled()
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('refuses canonical reads when mcp_read is off', async () => {
    const client = fakeClient()
    const flags = withFlags({ mcp_read: false })
    const tools = await request(
      'tools/list',
      {},
      context(['datasets:read'], client, undefined, flags),
    )
    expect(
      (tools?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).not.toContain('sheetbase.canonical.read')

    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.canonical.read',
        arguments: { resource: 'datasets' },
      },
      context(['datasets:read'], client, undefined, flags),
    )
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('marks pipeline logs untrusted and redacts a connection string', async () => {
    const list = vi.fn(async () => [
      {
        sequence: 3,
        message: 'postgresql://user:pass@db/app failed',
        detail: { password: 'hunter2' },
      },
    ]) as unknown as DataClient['list']
    const client = fakeClient({ list })
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.canonical.read',
        arguments: {
          resource: 'pipeline_run_logs',
          filters: {
            run_id: '00000000-0000-4000-8000-000000000404',
          },
        },
      },
      context(['pipelines:read'], client),
    )
    expect(response?.result).toMatchObject({
      structuredContent: { resource: 'pipeline_run_logs', untrusted: true },
    })
    const text = JSON.stringify(response?.result)
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('postgresql://')
  })

  it('allows a service token with the read scope', async () => {
    const list = vi.fn(async () => [
      { id: 'ds-1' },
    ]) as unknown as DataClient['list']
    const client = fakeClient({ list })
    const tools = await request(
      'tools/list',
      {},
      context(['datasets:read'], client, {
        kind: 'service_credential',
        id: 'credential-1',
      }),
    )
    expect(
      (tools?.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).toContain('sheetbase.canonical.read')
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.canonical.read',
        arguments: { resource: 'datasets' },
      },
      context(['datasets:read'], client, {
        kind: 'service_credential',
        id: 'credential-1',
      }),
    )
    expect(response?.result).not.toMatchObject({ isError: true })
  })
})

describe('MCP administration tools', () => {
  const memberRow = (role: string) => ({
    user_id: 'user-1',
    name: 'User One',
    role,
    client_id: null,
    client_name: null,
  })

  function adminClient(role = 'owner'): DataClient {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'workspace_members_list') return [memberRow(role)]
      if (name === 'agent_admin_credentials') {
        return [
          {
            id: 'credential-1',
            name: 'Agent',
            kind: 'personal',
            scopes: ['admin:read'],
          },
        ]
      }
      return {}
    }) as unknown as DataClient['rpc']
    return fakeClient({
      rpc,
      list: vi.fn(async (resource: string) => {
        if (resource === 'workspace_settings') {
          return [{ workspace_id: WORKSPACE_ID, ai_enabled: true }]
        }
        return []
      }) as unknown as DataClient['list'],
      count: vi.fn(async () => 2),
    })
  }

  it('lists the admin read tool only for a personal token with admin:read', async () => {
    const personal = await request(
      'tools/list',
      {},
      context(['admin:read'], adminClient()),
    )
    const personalTools = (
      personal?.result as { tools: Array<{ name: string }> }
    ).tools
    expect(personalTools.map((tool) => tool.name)).toContain(
      'sheetbase.admin.read',
    )

    const service = await request(
      'tools/list',
      {},
      context(['admin:read'], adminClient(), {
        kind: 'service_credential',
        id: 'credential-1',
      }),
    )
    const serviceTools = (service?.result as { tools: Array<{ name: string }> })
      .tools
    expect(serviceTools.map((tool) => tool.name)).not.toContain(
      'sheetbase.admin.read',
    )
  })

  it('reads workspace settings and counts after the member role check', async () => {
    const client = adminClient('admin')
    const response = await request(
      'tools/call',
      { name: 'sheetbase.admin.read', arguments: { resource: 'workspace' } },
      context(['admin:read'], client),
    )
    expect(client.rpc).toHaveBeenCalledWith('workspace_members_list', {})
    expect(response?.result).toMatchObject({
      structuredContent: {
        resource: 'workspace',
        settings: { workspace_id: WORKSPACE_ID, ai_enabled: true },
        counts: { members: 1, records: 2 },
      },
    })
  })

  it('refuses an admin read for a member without an administration role', async () => {
    const client = adminClient('member')
    const response = await request(
      'tools/call',
      { name: 'sheetbase.admin.read', arguments: { resource: 'workspace' } },
      context(['admin:read'], client),
    )
    expect(client.list).not.toHaveBeenCalled()
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('refuses credential metadata for an admin who is not an owner', async () => {
    const client = adminClient('admin')
    const response = await request(
      'tools/call',
      { name: 'sheetbase.admin.read', arguments: { resource: 'credentials' } },
      context(['admin:read'], client),
    )
    expect(client.rpc).not.toHaveBeenCalledWith('agent_admin_credentials', {})
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('returns owner credential metadata without secrets', async () => {
    const client = adminClient('owner')
    const response = await request(
      'tools/call',
      { name: 'sheetbase.admin.read', arguments: { resource: 'credentials' } },
      context(['admin:read'], client),
    )
    expect(response?.result).toMatchObject({
      structuredContent: {
        items: [
          {
            id: 'credential-1',
            name: 'Agent',
            kind: 'personal',
            scopes: ['admin:read'],
          },
        ],
      },
    })
    const text = JSON.stringify(response?.result)
    expect(text).not.toContain('secret')
    expect(text).not.toContain('hash')
  })

  it('refuses an administration proposal without admin:write', async () => {
    const client = adminClient()
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.workspace_ai_settings.update',
        arguments: {
          kind: 'workspace_ai_settings.update',
          workspaceId: WORKSPACE_ID,
          enabled: true,
          providerProfile: 'local',
          model: 'sheetbase-assist-1',
          cloudEgressEnabled: false,
          maxTokensPerCall: 1000,
          maxCostMicrousdPerCall: 0,
        },
      },
      context(['agent_operations:write'], client),
    )
    expect(client.rpc).not.toHaveBeenCalledWith(
      'propose_agent_operation',
      expect.anything(),
    )
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('proposes an administration change with both scopes', async () => {
    const proposal = { id: 'proposal-1', approval_policy: 'human_required' }
    const rpc = vi.fn(async () => proposal) as unknown as DataClient['rpc']
    const client = fakeClient({ rpc })
    const response = await request(
      'tools/call',
      {
        name: 'sheetbase.workspace_ai_settings.update',
        arguments: {
          kind: 'workspace_ai_settings.update',
          workspaceId: WORKSPACE_ID,
          enabled: true,
          providerProfile: 'local',
          model: 'sheetbase-assist-1',
          cloudEgressEnabled: false,
          maxTokensPerCall: 1000,
          maxCostMicrousdPerCall: 0,
        },
      },
      context(['agent_operations:write', 'admin:write'], client),
    )
    expect(rpc).toHaveBeenCalledWith(
      'propose_agent_operation',
      expect.objectContaining({
        p_operation: expect.objectContaining({
          kind: 'workspace_ai_settings.update',
          workspaceId: WORKSPACE_ID,
        }),
      }),
    )
    expect(response?.result).toMatchObject({ structuredContent: proposal })
  })
})

describe('MCP resources and prompts', () => {
  it('serves the shared domain resource text', async () => {
    const list = await request('resources/list', {}, context([]))
    const resources = (list?.result as { resources: Array<{ uri: string }> })
      .resources
    expect(resources.map((resource) => resource.uri)).toContain(
      'sheetbase://domain/core-model',
    )
    const read = await request(
      'resources/read',
      { uri: 'sheetbase://domain/core-model' },
      context([]),
    )
    const contents = (read?.result as { contents: Array<{ text: string }> })
      .contents
    expect(contents[0]?.text).toContain('Sheetbase core model')
  })

  it('builds a cited explanation prompt and rejects a missing argument', async () => {
    const good = await request(
      'prompts/get',
      {
        name: 'sheetbase.explain_object',
        arguments: { objectKind: 'dataset', objectId: DATASET_ID },
      },
      context([]),
    )
    const messages = (
      good?.result as { messages: Array<{ content: { text: string } }> }
    ).messages
    expect(messages[0]?.content.text).toContain(DATASET_ID)
    expect(messages[0]?.content.text).toContain('stable id')

    const bad = await request(
      'prompts/get',
      { name: 'sheetbase.explain_object', arguments: {} },
      context([]),
    )
    expect(bad).toMatchObject({
      error: { code: JSON_RPC_ERRORS.invalidParams },
    })
  })
})

describe('MCP protocol errors', () => {
  it('returns method-not-found for an unknown method', async () => {
    const response = await request('no/such/method', {}, context([]))
    expect(response).toMatchObject({
      error: { code: JSON_RPC_ERRORS.methodNotFound },
    })
  })

  it('produces no response for a notification', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      context([]),
    )
    expect(response).toBeNull()
  })

  it('reports an unknown tool as a tool error, not a protocol error', async () => {
    const response = await request(
      'tools/call',
      { name: 'sheetbase.nope', arguments: {} },
      context(['datasets:read']),
    )
    expect(response?.result).toMatchObject({ isError: true })
  })
})
