import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import {
  advanceAgentWorkflow,
  canRetryWorkflowStep,
  cancelAgentWorkflow,
  createAgentWorkflow,
  dryRunAgentWorkflow,
  reportAgentWorkflowUsage,
  requiresExplicitApproval,
  resumeAgentWorkflow,
  summarizeWorkflowApprovals,
  summarizeWorkflowRecovery,
  workflowRetriesRemaining,
  workflowStepGate,
  workflowStepIdempotencyKey,
  workflowStepMode,
  workflowStepRiskClass,
} from './agent-workflows'
import type {
  AgentWorkflow,
  AgentWorkflowPlan,
  AgentWorkflowStep,
} from './agent-workflows'
import type { AgentOperationProposal } from './agent-operations'

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

describe('AUTO-PLUS-02 plan dry-run and approval gates', () => {
  const draftStep = {
    operation: {
      kind: 'pipeline_definition.create',
      workspaceId: 'workspace-1',
      key: 'pipe',
      name: 'Pipe',
    },
  } as unknown as AgentWorkflowStep
  const commitStep = {
    operation: {
      kind: 'dataset_rows.commit',
      datasetId: 'dataset-1',
      expectedRevision: 7,
      rows: [],
    },
  } as unknown as AgentWorkflowStep

  function proposal(
    overrides: Partial<AgentOperationProposal>,
  ): AgentOperationProposal {
    return {
      id: 'proposal-1',
      status: 'pending',
      approval_policy: 'human_required',
      preview: {
        formatVersion: 1,
        kind: 'dataset_rows.commit',
        target: { type: 'dataset', id: 'dataset-1' },
        changes: [],
      },
      impact: {
        formatVersion: 1,
        mutationClass: 'data',
        target: { type: 'dataset', id: 'dataset-1' },
        createsDraft: false,
        affectedRows: 1,
        destructive: false,
      },
      ...overrides,
    } as AgentOperationProposal
  }

  it('marks only dataset_rows.commit as consequential and mutate-mode', () => {
    expect(workflowStepRiskClass(draftStep)).toBe('safe_draft')
    expect(workflowStepRiskClass(commitStep)).toBe('consequential_write')
    expect(workflowStepMode('sheetbase.pipeline_definition.draft')).toBe(
      'draft',
    )
    expect(workflowStepMode('sheetbase.dataset_rows.commit')).toBe('mutate')
    expect(requiresExplicitApproval(draftStep)).toBe(false)
    expect(requiresExplicitApproval(commitStep)).toBe(true)
  })

  it('observes the stored decide/policy outcome per gate', () => {
    const waiting = { status: 'waiting_approval' } as AgentWorkflowStep
    expect(
      workflowStepGate(
        waiting,
        proposal({ status: 'pending', approval_policy: 'human_required' }),
      ),
    ).toBe('pending-approval')
    expect(
      workflowStepGate(
        waiting,
        proposal({ status: 'pending', approval_policy: 'delegated' }),
      ),
    ).toBe('flowing')
    expect(workflowStepGate(waiting, proposal({ status: 'approved' }))).toBe(
      'approved',
    )
    expect(workflowStepGate(waiting, proposal({ status: 'executing' }))).toBe(
      'approved',
    )
    expect(
      workflowStepGate(
        { status: 'rejected' },
        proposal({ status: 'rejected' }),
      ),
    ).toBe('rejected')
    expect(workflowStepGate({ status: 'planned' }, null)).toBe('planned')
    expect(workflowStepGate({ status: 'waiting_approval' }, null)).toBe(
      'pending-approval',
    )
  })

  it('dry-runs a plan without touching state: stored preview where proposed, prediction where planned', () => {
    const live = proposal({ id: 'proposal-1' })
    const steps = [
      {
        ...commitStep,
        id: 'step-0',
        workflow_id: 'workflow-1',
        position: 0,
        step_key: 'first_commit',
        title: 'First',
        summary: 'First commit.',
        tool_name: 'sheetbase.dataset_rows.commit',
        input_references: [],
        status: 'waiting_approval',
        attempt: 1,
        proposal_id: 'proposal-1',
        completed_at: null,
        created_at: '2026-08-30T16:00:00Z',
        updated_at: '2026-08-30T16:00:00Z',
      },
      {
        ...commitStep,
        id: 'step-1',
        workflow_id: 'workflow-1',
        position: 1,
        step_key: 'second_commit',
        title: 'Second',
        summary: 'Second commit.',
        tool_name: 'sheetbase.dataset_rows.commit',
        input_references: [],
        status: 'planned',
        attempt: 0,
        proposal_id: null,
        completed_at: null,
        created_at: '2026-08-30T16:00:00Z',
        updated_at: '2026-08-30T16:00:00Z',
      },
    ] as AgentWorkflowStep[]
    const dryRun = dryRunAgentWorkflow(steps, { [live.id]: live })
    expect(dryRun).toHaveLength(2)
    expect(dryRun[0]).toMatchObject({
      stepKey: 'first_commit',
      mode: 'mutate',
      riskClass: 'consequential_write',
      requiresExplicitApproval: true,
      gate: 'pending-approval',
      attempt: 1,
    })
    expect(dryRun[0].preview).toBe(live.preview)
    expect(dryRun[0].impact).toBe(live.impact)
    expect(dryRun[1]).toMatchObject({
      stepKey: 'second_commit',
      gate: 'planned',
      requiresExplicitApproval: true,
      preview: null,
      impact: null,
    })
    const summary = summarizeWorkflowApprovals(dryRun)
    expect(summary).toMatchObject({
      total: 2,
      pendingApproval: ['first_commit'],
      planned: ['second_commit'],
      consequential: ['first_commit', 'second_commit'],
    })
  })

  it('keys every attempt distinctly and bounds retries by the remaining operation budget', () => {
    expect(workflowStepIdempotencyKey('workflow-1', 'first_commit', 1)).toBe(
      'workflow:workflow-1:first_commit:1',
    )
    expect(
      workflowStepIdempotencyKey('workflow-1', 'first_commit', 2),
    ).not.toBe(workflowStepIdempotencyKey('workflow-1', 'first_commit', 1))
    expect(workflowRetriesRemaining(workflow)).toBe(2)
    expect(workflowRetriesRemaining({ ...workflow, used_operations: 3 })).toBe(
      0,
    )
    const paused = { ...workflow, status: 'paused' } as AgentWorkflow
    expect(canRetryWorkflowStep(paused, { status: 'failed' })).toBe(true)
    expect(canRetryWorkflowStep(paused, { status: 'succeeded' })).toBe(false)
    expect(
      canRetryWorkflowStep(
        { ...paused, used_operations: 3 },
        { status: 'failed' },
      ),
    ).toBe(false)
    expect(
      canRetryWorkflowStep(
        { ...paused, status: 'cancelled' },
        { status: 'failed' },
      ),
    ).toBe(false)
  })

  it('keeps completed results, retryable failures, and terminal cancellation distinct', () => {
    const paused = { ...workflow, status: 'paused' } as AgentWorkflow
    const steps = [
      { step_key: 'done', status: 'succeeded', proposal_id: 'proposal-0' },
      { step_key: 'broken', status: 'failed', proposal_id: 'proposal-1' },
      { step_key: 'later', status: 'planned', proposal_id: null },
    ] as AgentWorkflowStep[]
    expect(summarizeWorkflowRecovery(paused, steps)).toEqual({
      completed: [{ stepKey: 'done', proposalId: 'proposal-0' }],
      retryable: ['broken'],
      terminal: false,
      retriesRemaining: 2,
    })
    const cancelled = { ...workflow, status: 'cancelled' } as AgentWorkflow
    const recovery = summarizeWorkflowRecovery(cancelled, steps)
    expect(recovery.terminal).toBe(true)
    expect(recovery.retryable).toEqual([])
    expect(recovery.completed).toEqual([
      { stepKey: 'done', proposalId: 'proposal-0' },
    ])
  })
})
