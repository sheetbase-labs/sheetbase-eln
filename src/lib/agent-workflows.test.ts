import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import {
  advanceAgentWorkflow,
  cancelAgentWorkflow,
  createAgentWorkflow,
  reportAgentWorkflowUsage,
  resumeAgentWorkflow,
} from './agent-workflows'
import type { AgentWorkflow, AgentWorkflowPlan } from './agent-workflows'

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

const plan: AgentWorkflowPlan = {
  formatVersion: 1,
  steps: [
    {
      key: 'first_commit',
      title: 'Commit first reviewed batch',
      summary: 'Apply the first reviewed values.',
      tool: 'sheetbase.dataset_rows.commit',
      operation: {
        kind: 'dataset_rows.commit',
        datasetId: 'dataset-1',
        expectedRevision: 7,
        rows: [
          {
            operation: 'update',
            rowId: 'row-1',
            expectedRevision: 2,
            values: { field: 42 },
          },
        ],
      },
      inputReferences: [{ kind: 'dataset_version', id: 'version-1' }],
    },
    {
      key: 'second_commit',
      title: 'Commit second reviewed batch',
      summary: 'Apply the second reviewed values.',
      tool: 'sheetbase.dataset_rows.commit',
      operation: {
        kind: 'dataset_rows.commit',
        datasetId: 'dataset-1',
        expectedRevision: 8,
        rows: [
          {
            operation: 'update',
            rowId: 'row-2',
            expectedRevision: 1,
            values: { field: 43 },
          },
        ],
      },
      inputReferences: [{ kind: 'dataset_version', id: 'version-1' }],
    },
  ],
}

const workflow: AgentWorkflow = {
  id: 'workflow-1',
  workspace_id: 'workspace-1',
  goal: 'Apply two reviewed assay corrections in order.',
  status: 'paused',
  revision: '4',
  plan,
  plan_digest: 'a'.repeat(64),
  provenance: {
    agentId: 'assay-helper',
    tool: { name: 'sheetbase.workflow', version: '1' },
    model: { provider: 'openai', name: 'gpt-5.6' },
    invocationId: 'invocation-1',
  },
  idempotency_key: 'invocation-1:workflow',
  max_operations: 3,
  max_tokens: '10000',
  max_cost_microusd: '250000',
  used_operations: 1,
  used_tokens: '800',
  used_cost_microusd: '20000',
  current_step: 0,
  created_by_user_id: 'user-1',
  created_by_credential_id: null,
  cancelled_by_user_id: null,
  cancelled_by_credential_id: null,
  cancelled_at: null,
  cancellation_reason: null,
  completed_at: null,
  created_at: '2026-08-30T16:00:00Z',
  updated_at: '2026-08-30T16:00:00Z',
}

describe('agent workflow client contract', () => {
  it('submits a pinned plan, provenance, initial usage, and hard budgets', async () => {
    const rpc = vi.fn().mockResolvedValue(workflow)
    const client = clientWithRpc(rpc)
    const provenance = {
      agentId: 'assay-helper',
      tool: { name: 'sheetbase.workflow', version: '1' },
      model: { provider: 'openai', name: 'gpt-5.6' },
      invocationId: 'invocation-1',
    }

    await createAgentWorkflow(client, {
      workspaceId: 'workspace-1',
      goal: 'Apply two reviewed assay corrections in order.',
      plan,
      budget: {
        maxOperations: 3,
        maxTokens: 10_000,
        maxCostMicrousd: 250_000,
      },
      initialUsage: { tokens: 800, costMicrousd: 20_000 },
      provenance,
      idempotencyKey: 'invocation-1:workflow',
    })

    expect(rpc).toHaveBeenCalledWith('create_agent_workflow', {
      p_workspace_id: 'workspace-1',
      p_goal: 'Apply two reviewed assay corrections in order.',
      p_plan: plan,
      p_budget: {
        maxOperations: 3,
        maxTokens: 10_000,
        maxCostMicrousd: 250_000,
      },
      p_initial_usage: { tokens: 800, costMicrousd: 20_000 },
      p_provenance: provenance,
      p_idempotency_key: 'invocation-1:workflow',
    })
  })

  it('uses optimistic revisions for advance, resume, usage, and cancellation', async () => {
    const rpc = vi.fn().mockResolvedValue(workflow)
    const client = clientWithRpc(rpc)

    await advanceAgentWorkflow(client, workflow)
    await resumeAgentWorkflow(client, workflow)
    await reportAgentWorkflowUsage(client, {
      workflow,
      usage: { tokens: 120, costMicrousd: 4_500 },
    })
    await cancelAgentWorkflow(client, {
      workflow,
      reason: 'Source review was withdrawn.',
    })

    expect(rpc.mock.calls).toEqual([
      [
        'advance_agent_workflow',
        { p_workflow_id: 'workflow-1', p_expected_revision: 4 },
      ],
      [
        'resume_agent_workflow',
        { p_workflow_id: 'workflow-1', p_expected_revision: 4 },
      ],
      [
        'report_agent_workflow_usage',
        {
          p_workflow_id: 'workflow-1',
          p_expected_revision: 4,
          p_tokens: 120,
          p_cost_microusd: 4_500,
        },
      ],
      [
        'cancel_agent_workflow',
        {
          p_workflow_id: 'workflow-1',
          p_expected_revision: 4,
          p_reason: 'Source review was withdrawn.',
        },
      ],
    ])
  })
})
