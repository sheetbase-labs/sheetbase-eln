import { describe, expect, it } from 'vitest'

import { AGENT_WORKFLOW_TOOLS } from './agent-workflows'
import {
  AGENT_OPERATION_TOOL_NAMES,
  AGENT_TOOL_CATALOGUE,
  MCP_ONLY_OPERATION_TOOL_NAMES,
  UNAVAILABLE_AGENT_OPERATIONS,
  describeAgentTool,
  listAgentTools,
  unavailableReason,
} from './agent-tool-catalogue'
import { GATEWAY_TOOLS } from './ai-gateway'

const WS = '20000000-0000-4000-8000-000000000001'

describe('agent tool catalogue', () => {
  it('is bounded: 13 operation tools, 5 lifecycle RPCs, 4 canonical reads', () => {
    expect(AGENT_TOOL_CATALOGUE).toHaveLength(22)
    expect(listAgentTools({ mode: 'draft' })).toHaveLength(15)
    expect(listAgentTools({ mode: 'read' })).toHaveLength(4)
    expect(listAgentTools({ mode: 'mutate' })).toHaveLength(3)
  })

  it('covers every catalogue operation kind exactly once', () => {
    const kinds = AGENT_TOOL_CATALOGUE.map((entry) => entry.operationKind)
      .filter(Boolean)
      .sort()
    expect(kinds).toEqual(
      [
        'dataset_rows.commit',
        'dataset_schema.create',
        'notebook_block.insert',
        'record.create',
        'record.custom_fields.update',
        'sheet_instance.create',
        'template.instantiate',
        'pipeline_definition.create',
        'pipeline_definition.create_version',
        'pipeline_definition.update_draft',
        'sheet_definition.create',
        'sheet_definition.update_draft',
        'workspace_ai_settings.update',
      ].sort(),
    )
  })

  it('gives every entry a description, capability, input schema, and error vocabulary', () => {
    for (const entry of AGENT_TOOL_CATALOGUE) {
      expect(
        entry.description.length,
        `${entry.name} description`,
      ).toBeGreaterThan(0)
      expect(entry.rpc.length, `${entry.name} rpc`).toBeGreaterThan(0)
      expect(entry.via.length, `${entry.name} via`).toBeGreaterThan(0)
      expect(
        entry.capability.permission.length,
        `${entry.name} permission`,
      ).toBeGreaterThan(0)
      expect(entry.errors.length, `${entry.name} errors`).toBeGreaterThan(0)
    }
  })

  it('tags dataset_rows.commit as the only mutating operation tool', () => {
    const operations = AGENT_TOOL_CATALOGUE.filter(
      (entry) => entry.operationKind,
    )
    expect(
      operations
        .filter((entry) => entry.mode === 'mutate')
        .map((entry) => entry.name),
    ).toEqual(['sheetbase.dataset_rows.commit'])
    expect(operations.filter((entry) => entry.mode === 'draft')).toHaveLength(
      12,
    )
  })

  it('routes every operation tool through propose_agent_operation', () => {
    for (const entry of AGENT_TOOL_CATALOGUE.filter(
      (tool) => tool.operationKind,
    )) {
      expect(entry.via, entry.name).toBe('propose_agent_operation')
    }
  })

  it('validates operation inputs and rejects bad shapes', () => {
    const commit = describeAgentTool('sheetbase.dataset_rows.commit')
    expect(
      commit?.inputSchema.safeParse({
        kind: 'dataset_rows.commit',
        datasetId: WS,
        expectedRevision: 3,
        rows: [{ rowId: 'r1' }],
      }).success,
    ).toBe(true)
    expect(
      commit?.inputSchema.safeParse({
        kind: 'dataset_rows.commit',
        datasetId: WS,
        expectedRevision: 3,
        rows: [],
      }).success,
    ).toBe(false)
    expect(
      commit?.inputSchema.safeParse({
        kind: 'dataset_rows.commit',
        datasetId: 'not-a-uuid',
        expectedRevision: 3,
        rows: [{ rowId: 'r1' }],
      }).success,
    ).toBe(false)

    const draft = describeAgentTool('sheetbase.dataset_schema.draft')
    expect(
      draft?.inputSchema.safeParse({
        kind: 'dataset_schema.create',
        workspaceId: WS,
        key: 'assay',
        name: 'Assay',
        fields: [],
      }).success,
    ).toBe(true)
    expect(
      draft?.inputSchema.safeParse({
        kind: 'dataset_schema.create',
        workspaceId: WS,
        key: 'Bad Key!',
        name: 'Assay',
        fields: [],
      }).success,
    ).toBe(false)

    const notebook = describeAgentTool('sheetbase.notebook_block.insert')
    expect(
      notebook?.inputSchema.safeParse({
        kind: 'notebook_block.insert',
        recordId: WS,
        afterBlockId: null,
        block: {
          type: 'paragraph',
          payload: { text: 'Prepared sample.' },
          payloadSchemaVersion: 1,
        },
        expectedRevision: 4,
      }).success,
    ).toBe(true)
    expect(
      notebook?.inputSchema.safeParse({
        kind: 'notebook_block.insert',
        recordId: WS,
        block: { type: '', payload: {} },
        expectedRevision: 4,
      }).success,
    ).toBe(false)
    expect(
      notebook?.inputSchema.safeParse({
        kind: 'notebook_block.insert',
        recordId: WS,
        block: { type: 'paragraph', payload: {} },
        expectedRevision: 0,
      }).success,
    ).toBe(false)
  })

  it('describes entries by name and returns null for unknown tools', () => {
    expect(describeAgentTool('sheetbase.search')?.mode).toBe('read')
    expect(describeAgentTool('shell.exec')).toBeNull()
    expect(describeAgentTool('decide_agent_operation')).toBeNull()
  })

  it('filters discovery by caller capabilities', () => {
    const reads = listAgentTools({ scopes: ['projects:read'] })
    expect(reads.map((entry) => entry.name)).toEqual(['sheetbase.search'])

    const proposer = listAgentTools({ scopes: ['agent_operations:write'] })
    expect(proposer.length).toBeGreaterThan(0)
    expect(
      proposer.every((entry) =>
        entry.capability.scopes.every((scope) =>
          (['agent_operations:write'] as string[]).includes(scope),
        ),
      ),
    ).toBe(true)
  })

  it('lists human-only attestation as explicitly unavailable with reasons', () => {
    const names = UNAVAILABLE_AGENT_OPERATIONS.map((entry) => entry.name)
    for (const name of [
      'decide_agent_operation',
      'execute_agent_operation',
      'resume_agent_workflow',
      'sign_revision',
      'submit_record_revision',
    ]) {
      expect(names, name).toContain(name)
      expect(unavailableReason(name)?.length ?? 0, name).toBeGreaterThan(0)
    }
    // Unavailable operations never leak into discovery.
    for (const name of names.filter(
      (entry) =>
        !['arbitrary_rpc', 'direct_table_write', 'ui_automation'].includes(
          entry,
        ),
    )) {
      expect(describeAgentTool(name), name).toBeNull()
    }
    expect(unavailableReason('sheetbase.search')).toBeNull()
  })
})

describe('agent tool allowlist drift', () => {
  it('gateway, workflow, and catalogue operation tools agree (single authority)', () => {
    expect([...GATEWAY_TOOLS]).toEqual([...AGENT_OPERATION_TOOL_NAMES])
    expect([...AGENT_WORKFLOW_TOOLS]).toEqual([...AGENT_OPERATION_TOOL_NAMES])
    const shared = AGENT_TOOL_CATALOGUE.filter(
      (entry) =>
        entry.operationKind &&
        !(MCP_ONLY_OPERATION_TOOL_NAMES as readonly string[]).includes(
          entry.name,
        ),
    )
    expect(shared.map((entry) => entry.name).sort()).toEqual(
      [...AGENT_OPERATION_TOOL_NAMES].sort(),
    )
    expect(
      AGENT_TOOL_CATALOGUE.filter((entry) => entry.operationKind)
        .map((entry) => entry.name)
        .filter((name) =>
          (MCP_ONLY_OPERATION_TOOL_NAMES as readonly string[]).includes(name),
        )
        .sort(),
    ).toEqual([...MCP_ONLY_OPERATION_TOOL_NAMES].sort())
  })
})
