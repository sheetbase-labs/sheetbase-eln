import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import {
  agentOperationLabel,
  createAgentOperationPolicy,
  decideAgentOperation,
  disableAgentOperationPolicy,
  executeAgentOperation,
  listAgentOperationPolicies,
  proposeAgentOperation,
} from './agent-operations'
import type { AgentOperation } from './agent-operations'

function clientWithRpc(rpc = vi.fn()): DataClient {
  return {
    rpc,
    list: vi.fn(),
    count: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
  }
}

describe('agent operation client contract', () => {
  it('submits the typed operation and complete provenance to one proposal RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'proposal-1' })
    const client = clientWithRpc(rpc)
    const operation: AgentOperation = {
      kind: 'dataset_rows.commit',
      datasetId: 'dataset-1',
      expectedRevision: 7,
      rows: [
        {
          operation: 'update',
          rowId: 'row-1',
          expectedRevision: 2,
          values: { 'field-1': 42 },
        },
      ],
    }

    await proposeAgentOperation(client, {
      workspaceId: 'workspace-1',
      title: 'Correct assay result',
      summary: 'Apply the reviewed value to one stable Dataset row.',
      operation,
      provenance: {
        agentId: 'assay-helper',
        tool: { name: 'sheetbase.dataset.rows', version: '1' },
        model: { provider: 'openai', name: 'gpt-5.6' },
        invocationId: 'invocation-17',
      },
      idempotencyKey: 'invocation-17:operation-1',
    })

    expect(rpc).toHaveBeenCalledWith('propose_agent_operation', {
      p_workspace_id: 'workspace-1',
      p_title: 'Correct assay result',
      p_summary: 'Apply the reviewed value to one stable Dataset row.',
      p_operation: operation,
      p_provenance: {
        agentId: 'assay-helper',
        tool: { name: 'sheetbase.dataset.rows', version: '1' },
        model: { provider: 'openai', name: 'gpt-5.6' },
        invocationId: 'invocation-17',
      },
      p_idempotency_key: 'invocation-17:operation-1',
    })
  })

  it('requires an expected proposal revision for approval and execution', async () => {
    const rpc = vi.fn().mockResolvedValue({})
    const client = clientWithRpc(rpc)

    await decideAgentOperation(client, {
      proposalId: 'proposal-1',
      expectedRevision: 3,
      decision: 'approve',
    })
    await executeAgentOperation(client, {
      proposalId: 'proposal-1',
      expectedRevision: 4,
    })

    expect(rpc).toHaveBeenNthCalledWith(1, 'decide_agent_operation', {
      p_proposal_id: 'proposal-1',
      p_expected_revision: 3,
      p_decision: 'approve',
      p_reason: null,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'execute_agent_operation', {
      p_proposal_id: 'proposal-1',
      p_expected_revision: 4,
    })
  })

  it('uses the policy RPCs and workspace-scoped policy catalogue', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'policy-1' })
    const list = vi.fn().mockResolvedValue([{ id: 'policy-1' }])
    const client = { ...clientWithRpc(rpc), list }

    await createAgentOperationPolicy(client, {
      workspaceId: 'workspace-1',
      name: 'Dataset delegation',
      operationKind: 'dataset_rows.commit',
      credentialId: 'credential-1',
      targetType: 'dataset',
      targetId: 'dataset-1',
      maxAffectedRows: 25,
    })
    await disableAgentOperationPolicy(client, {
      workspaceId: 'workspace-1',
      policyId: 'policy-1',
    })
    await listAgentOperationPolicies(client)

    expect(rpc).toHaveBeenNthCalledWith(1, 'create_agent_operation_policy', {
      p_workspace_id: 'workspace-1',
      p_name: 'Dataset delegation',
      p_operation_kind: 'dataset_rows.commit',
      p_target_type: 'dataset',
      p_target_id: 'dataset-1',
      p_credential_id: 'credential-1',
      p_limits: { maxAffectedRows: 25 },
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'disable_agent_operation_policy', {
      p_workspace_id: 'workspace-1',
      p_policy_id: 'policy-1',
    })
    expect(list).toHaveBeenCalledWith(
      'agent_operation_policies',
      expect.stringContaining('workspace_id'),
    )
  })

  it('has no publish, signature, attestation, or workflow operation variants', () => {
    const supported = [
      'dataset_schema.create',
      'sheet_definition.create',
      'sheet_definition.update_draft',
      'pipeline_definition.create',
      'pipeline_definition.create_version',
      'pipeline_definition.update_draft',
      'dataset_rows.commit',
    ] as const

    expect(supported.map(agentOperationLabel)).toEqual([
      'Create Dataset Schema draft',
      'Create Sheet Definition draft',
      'Update Sheet Definition draft',
      'Create Pipeline Definition',
      'Create Pipeline draft version',
      'Update Pipeline draft version',
      'Commit Dataset rows',
    ])
  })
})
