// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentOperationEvent,
  AgentOperationProposal,
} from '#/lib/agent-operations'
import { ProposalWorkbench } from './proposal-workbench'

const proposal: AgentOperationProposal = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  title: 'Correct assay result',
  summary: 'Apply one reviewed value to the canonical Dataset.',
  operation_kind: 'dataset_rows.commit',
  operation: {
    kind: 'dataset_rows.commit',
    datasetId: '33333333-3333-4333-8333-333333333333',
    expectedRevision: 7,
    rows: [
      {
        operation: 'update',
        rowId: '44444444-4444-4444-8444-444444444444',
        expectedRevision: 2,
        values: { '55555555-5555-4555-8555-555555555555': 42 },
      },
    ],
  },
  preview: {
    formatVersion: 1,
    kind: 'dataset_rows.commit',
    target: {
      type: 'dataset',
      id: '33333333-3333-4333-8333-333333333333',
      label: 'Dataset rows',
    },
    expectedRevision: 7,
    currentRevision: 7,
    changes: [
      {
        path: 'rows.44444444-4444-4444-8444-444444444444',
        before: null,
        after: { operation: 'update', value: 42 },
      },
    ],
  },
  impact: {
    formatVersion: 1,
    mutationClass: 'data',
    target: {
      type: 'dataset',
      id: '33333333-3333-4333-8333-333333333333',
      label: 'Dataset rows',
    },
    createsDraft: false,
    affectedRows: 1,
    destructive: false,
  },
  risk_class: 'consequential_write',
  approval_policy: 'human_required',
  policy_id: null,
  policy_reason: 'Consequential Dataset writes require human approval.',
  policy_limits: {},
  policy_target: {
    type: 'dataset',
    id: '33333333-3333-4333-8333-333333333333',
  },
  policy_evidence: {
    actorKind: 'user',
    targetMatched: false,
  },
  status: 'pending',
  revision: '1',
  idempotency_key: 'invocation-1:operation-1',
  request_digest: 'a'.repeat(64),
  provenance: {
    agentId: 'assay-helper',
    tool: { name: 'sheetbase.dataset.rows', version: '1' },
    model: { provider: 'openai', name: 'gpt-5.6' },
    invocationId: 'invocation-1',
  },
  proposed_by_user_id: 'agent-user',
  proposed_by_credential_id: null,
  approved_by_user_id: null,
  approved_at: null,
  rejected_by_user_id: null,
  rejected_at: null,
  rejection_reason: null,
  executed_by_user_id: null,
  executed_by_credential_id: null,
  executed_at: null,
  result: null,
  error_code: null,
  error_message: null,
  created_at: '2026-08-30T16:00:00Z',
  updated_at: '2026-08-30T16:00:00Z',
}

const events: AgentOperationEvent[] = [
  {
    id: 'event-1',
    proposal_id: proposal.id,
    sequence: 1,
    event_type: 'proposed',
    actor_user_id: 'agent-user',
    actor_credential_id: null,
    detail: {},
    created_at: '2026-08-30T16:00:00Z',
  },
]

afterEach(cleanup)

describe('ProposalWorkbench', () => {
  it('shows impact, exact diff, provenance, policy, and evidence', () => {
    render(
      <ProposalWorkbench
        proposals={[proposal]}
        events={events}
        selectedId={proposal.id}
        onSelect={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onExecute={vi.fn()}
        canApprove
      />,
    )

    expect(screen.getByText('human required')).toBeTruthy()
    expect(screen.getByText('Policy decision and impact')).toBeTruthy()
    expect(screen.getByText('Dataset rows')).toBeTruthy()
    expect(
      screen.getByText('rows.44444444-4444-4444-8444-444444444444'),
    ).toBeTruthy()
    expect(screen.getByText('assay-helper')).toBeTruthy()
    expect(screen.getByText('proposed')).toBeTruthy()
  })

  it('requires a rejection reason and passes approval actions the proposal', () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    render(
      <ProposalWorkbench
        proposals={[proposal]}
        events={events}
        selectedId={proposal.id}
        onSelect={vi.fn()}
        onApprove={onApprove}
        onReject={onReject}
        onExecute={vi.fn()}
        canApprove
      />,
    )

    const reject = screen.getByRole('button', { name: 'Reject' })
    expect(reject.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Rejection reason'), {
      target: { value: 'The source value is not verified.' },
    })
    fireEvent.click(reject)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onReject).toHaveBeenCalledWith(
      proposal,
      'The source value is not verified.',
    )
    expect(onApprove).toHaveBeenCalledWith(proposal)
  })

  it('exposes execution only after approval', () => {
    const onExecute = vi.fn()
    const approved = {
      ...proposal,
      status: 'approved',
      revision: '2',
      approved_by_user_id: 'human-reviewer',
      approved_at: '2026-08-30T16:05:00Z',
    } satisfies AgentOperationProposal

    render(
      <ProposalWorkbench
        proposals={[approved]}
        events={events}
        selectedId={approved.id}
        onSelect={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onExecute={onExecute}
        canApprove
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Execute approved operation' }),
    )
    expect(onExecute).toHaveBeenCalledWith(approved)
  })
})
