/**
 * AUTO-PLUS-03 evaluation suite (unit): run provenance, evidence
 * boundaries, and run cost/latency rollups.
 *
 * These are pure projections over stored AUTO-04/AUTO-05 rows — the DB
 * companion (`tests/db/agent-evaluations.test.ts`) proves the same joins
 * against live canonical effects, permission enforcement, and failure
 * paths.
 */
import { describe, expect, it } from 'vitest'

import type {
  AgentOperationProposal,
  AgentProvenance,
} from './agent-operations'
import {
  buildWorkflowProvenanceRecord,
  extractAgentOutputReferences,
  markProposalEvidence,
  markWorkflowStepEvidence,
} from './agent-provenance'
import type { AgentWorkflow, AgentWorkflowStep } from './agent-workflows'
import { summarizeWorkflowRunMetrics } from './agent-workflows'

const provenance: AgentProvenance = {
  agentId: 'assay-helper',
  agentName: 'Assay helper',
  tool: { name: 'sheetbase.workflow', version: '1' },
  model: { provider: 'test', name: 'sheetbase-assist-1' },
  invocationId: 'eval-invocation',
}

const DATASET_ID = '33333333-3333-4333-8333-333333333333'
const VERSION_ID = '55555555-5555-4555-8555-555555555555'
const DEFINITION_ID = '66666666-6666-4666-8666-666666666666'

function workflow(overrides: Partial<AgentWorkflow> = {}): AgentWorkflow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: '22222222-2222-4222-8222-222222222222',
    goal: 'Apply two reviewed titre corrections in order.',
    status: 'succeeded',
    revision: '6',
    plan: { formatVersion: 1, steps: [] },
    plan_digest: 'd'.repeat(64),
    provenance,
    idempotency_key: 'eval:workflow',
    max_operations: 4,
    max_tokens: '10000',
    max_cost_microusd: '500000',
    used_operations: 3,
    used_tokens: '1500',
    used_cost_microusd: '60000',
    current_step: 1,
    created_by_user_id: null,
    created_by_credential_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    cancelled_by_user_id: null,
    cancelled_by_credential_id: null,
    cancelled_at: null,
    cancellation_reason: null,
    completed_at: '2026-09-06T00:05:00.000Z',
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:05:00.000Z',
    ...overrides,
  }
}

function step(overrides: Partial<AgentWorkflowStep> = {}): AgentWorkflowStep {
  return {
    id: 'step-id-1',
    workflow_id: '11111111-1111-4111-8111-111111111111',
    position: 0,
    step_key: 'correct_titre',
    title: 'Correct titre',
    summary: 'Apply one reviewed value.',
    tool_name: 'sheetbase.dataset_rows.commit',
    operation: {
      kind: 'dataset_rows.commit',
      datasetId: DATASET_ID,
      expectedRevision: 2,
      rows: [],
    },
    input_references: [{ kind: 'dataset_version', id: VERSION_ID }],
    status: 'succeeded',
    attempt: 1,
    proposal_id: 'proposal-1',
    completed_at: '2026-09-06T00:02:00.000Z',
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:02:00.000Z',
    ...overrides,
  }
}

function proposal(
  overrides: Partial<AgentOperationProposal> = {},
): AgentOperationProposal {
  return {
    id: 'proposal-1',
    workspace_id: '22222222-2222-4222-8222-222222222222',
    title: 'Correct titre',
    summary: 'Apply one reviewed value.',
    operation_kind: 'dataset_rows.commit',
    operation: {
      kind: 'dataset_rows.commit',
      datasetId: DATASET_ID,
      expectedRevision: 2,
      rows: [],
    },
    preview: {
      formatVersion: 1,
      kind: 'dataset_rows.commit',
      target: { type: 'dataset', id: DATASET_ID, label: 'Titre' },
      changes: [],
    },
    impact: {
      formatVersion: 1,
      mutationClass: 'data',
      target: { type: 'dataset', id: DATASET_ID, label: 'Titre' },
      createsDraft: false,
      affectedRows: 1,
      destructive: false,
    },
    risk_class: 'consequential_write',
    approval_policy: 'delegated',
    policy_id: 'policy-1',
    policy_reason: 'Delegated create/append policy matched.',
    policy_limits: { maxAffectedRows: 10 },
    policy_target: { type: 'dataset', id: DATASET_ID },
    policy_evidence: { scope: 'datasets:write' },
    status: 'succeeded',
    revision: 3,
    idempotency_key: 'workflow:wid:correct_titre:1',
    request_digest: 'e'.repeat(64),
    provenance,
    proposed_by_user_id: null,
    proposed_by_credential_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    approved_by_user_id: null,
    approved_at: null,
    rejected_by_user_id: null,
    rejected_at: null,
    rejection_reason: null,
    executed_by_user_id: 'owner-1',
    executed_by_credential_id: null,
    executed_at: '2026-09-06T00:02:00.000Z',
    result: { ok: true, idempotent: false },
    error_code: null,
    error_message: null,
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:02:00.000Z',
    ...overrides,
  }
}

describe('AUTO-PLUS-03 run provenance record', () => {
  it('joins a representative two-step run into one inspectable record', () => {
    const draft = proposal({
      id: 'proposal-0',
      operation_kind: 'pipeline_definition.create',
      operation: {
        kind: 'pipeline_definition.create',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        key: 'eval_pipe',
        name: 'Eval pipe',
      },
      status: 'succeeded',
      approval_policy: 'automatic',
      risk_class: 'safe_draft',
      result: { id: DEFINITION_ID },
    })
    const first = step({
      id: 'step-id-0',
      position: 0,
      step_key: 'draft_pipe',
      title: 'Draft pipe',
      tool_name: 'sheetbase.pipeline_definition.draft',
      operation: {
        kind: 'pipeline_definition.create',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        key: 'eval_pipe',
        name: 'Eval pipe',
      },
      input_references: [],
      proposal_id: 'proposal-0',
    })
    const second = step({ position: 1, proposal_id: 'proposal-1' })
    const record = buildWorkflowProvenanceRecord(workflow(), [second, first], {
      'proposal-0': draft,
      'proposal-1': proposal(),
    })

    expect(record.formatVersion).toBe(1)
    expect(record.agentProduced).toBe(true)
    expect(record.workflow.planDigest).toBe('d'.repeat(64))
    expect(record.workflow.provenance.invocationId).toBe('eval-invocation')
    // Position order, not input order.
    expect(record.steps.map((s) => s.stepKey)).toEqual([
      'draft_pipe',
      'correct_titre',
    ])
    // Input version pins survive the join.
    expect(record.steps[1].inputReferences).toEqual([
      { kind: 'dataset_version', id: VERSION_ID },
    ])
    // Actor/policy decisions travel with each step.
    expect(record.steps[1]).toMatchObject({
      approvalPolicy: 'delegated',
      policyReason: 'Delegated create/append policy matched.',
      attempt: 1,
    })
    expect(record.steps[1].proposedBy).toMatchObject({
      credentialId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    })
    expect(record.steps[1].executedBy).toMatchObject({ userId: 'owner-1' })
    // Operation-derived output refs: the canonical target of each step.
    expect(record.steps[0].outputReferences).toContainEqual({
      kind: 'pipeline_definition',
      id: DEFINITION_ID,
      source: 'result',
    })
    expect(record.steps[1].outputReferences).toContainEqual({
      kind: 'dataset',
      id: DATASET_ID,
      source: 'operation',
    })
  })

  it('leaves planned steps without proposals inspectable, not invented', () => {
    const record = buildWorkflowProvenanceRecord(
      workflow({ status: 'waiting_approval', completed_at: null }),
      [step({ status: 'planned', attempt: 0, proposal_id: null })],
      {},
    )
    expect(record.steps[0]).toMatchObject({
      proposalId: null,
      proposalStatus: null,
      approvalPolicy: null,
      provenance: null,
      proposedBy: null,
    })
    // Operation target is still known from the pinned plan.
    expect(record.steps[0].outputReferences).toContainEqual({
      kind: 'dataset',
      id: DATASET_ID,
      source: 'operation',
    })
  })

  it('keeps rejected and failed attempts inspectable with actor and error', () => {
    const rejected = proposal({
      status: 'rejected',
      rejection_reason: 'Value looks wrong.',
      rejected_by_user_id: 'reviewer-1',
      result: null,
      error_code: null,
    })
    const record = buildWorkflowProvenanceRecord(
      workflow({ status: 'paused', completed_at: null }),
      [step({ status: 'rejected', proposal_id: 'proposal-1' })],
      { 'proposal-1': rejected },
    )
    expect(record.steps[0]).toMatchObject({
      proposalStatus: 'rejected',
      outputReferences: [
        { kind: 'dataset', id: DATASET_ID, source: 'operation' },
      ],
    })
    expect(record.steps[0].decidedBy).toMatchObject({
      userId: 'reviewer-1',
      reason: 'Value looks wrong.',
    })
  })
})

describe('AUTO-PLUS-03 output reference extraction', () => {
  it('extracts known canonical ids from succeeded results', () => {
    expect(
      extractAgentOutputReferences(
        {
          kind: 'dataset_schema.create',
          workspaceId: 'w',
          key: 'k',
          name: 'n',
          fields: [],
        },
        {
          schema_definition_id: DEFINITION_ID,
          schema_version_id: VERSION_ID,
        },
      ),
    ).toEqual([
      {
        kind: 'dataset_schema_definition',
        id: DEFINITION_ID,
        source: 'result',
      },
      { kind: 'dataset_schema_version', id: VERSION_ID, source: 'result' },
    ])
  })

  it('ignores unknown result shapes instead of guessing', () => {
    expect(
      extractAgentOutputReferences(
        {
          kind: 'dataset_rows.commit',
          datasetId: DATASET_ID,
          expectedRevision: 2,
          rows: [],
        },
        { ok: true, receipt_id: 'not-a-uuid', nested: { id: VERSION_ID } },
      ),
    ).toEqual([{ kind: 'dataset', id: DATASET_ID, source: 'operation' }])
  })
})

describe('AUTO-PLUS-03 evidence boundaries', () => {
  it('marks every proposal agent-produced; only success qualifies', () => {
    const succeeded = markProposalEvidence(proposal())
    expect(succeeded.agentProduced).toBe(true)
    expect(succeeded.qualifiesForSubmission).toBe(true)
    expect(succeeded.provenance.invocationId).toBe('eval-invocation')

    for (const status of [
      'pending',
      'approved',
      'executing',
      'rejected',
      'failed',
      'cancelled',
    ] as const) {
      const marking = markProposalEvidence(proposal({ status }))
      expect(marking.agentProduced).toBe(true)
      expect(marking.qualifiesForSubmission).toBe(false)
      expect(marking.qualification).toContain(status)
    }
  })

  it('marks workflow steps with their version pins', () => {
    const marking = markWorkflowStepEvidence(step(), proposal())
    expect(marking.qualifiesForSubmission).toBe(true)
    expect(marking.versionPins).toEqual([
      { kind: 'dataset_version', id: VERSION_ID },
    ])
    const planned = markWorkflowStepEvidence(
      step({ status: 'planned', attempt: 0, proposal_id: null }),
      null,
    )
    expect(planned.qualifiesForSubmission).toBe(false)
    expect(planned.qualification).toContain('no proposal')
  })
})

describe('AUTO-PLUS-03 run cost/latency rollup', () => {
  it('rolls up budgets, cost, wall latency, and step states', () => {
    const metrics = summarizeWorkflowRunMetrics(workflow(), [
      { status: 'succeeded' },
      { status: 'succeeded' },
      { status: 'failed' },
      { status: 'planned' },
    ])
    expect(metrics.operations).toEqual({ used: 3, max: 4, remaining: 1 })
    expect(metrics.costUsd).toEqual({ used: '0.0600', max: '0.5000' })
    expect(metrics.wallLatencyMs).toBe(300_000)
    expect(metrics.steps).toEqual({
      total: 4,
      succeeded: 2,
      failed: 1,
      rejected: 0,
      cancelled: 0,
      open: 1,
    })
    expect(metrics.budgetExhausted).toBe(false)
  })

  it('reports null latency until completion and flags exhaustion', () => {
    const metrics = summarizeWorkflowRunMetrics(
      workflow({ status: 'budget_exhausted', completed_at: null }),
      [{ status: 'cancelled' }],
    )
    expect(metrics.wallLatencyMs).toBeNull()
    expect(metrics.budgetExhausted).toBe(true)
    expect(metrics.steps.cancelled).toBe(1)
  })
})
