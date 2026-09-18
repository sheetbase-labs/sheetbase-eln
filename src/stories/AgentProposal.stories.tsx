import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ProposalWorkbench } from '#/components/agent-operations/proposal-workbench'
import type {
  AgentOperationProposal,
  AgentOperationEvent,
} from '#/lib/agent-operations'

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

const meta = {
  title: 'Automation/ProposalWorkbench',
  component: ProposalWorkbench,
  parameters: { layout: 'fullscreen' },
  args: {
    proposals: [proposal],
    events,
    selectedId: proposal.id,
    onSelect: () => {},
    pendingAction: null,
    onApprove: () => {},
    onReject: () => {},
    onExecute: () => {},
    canApprove: true,
  },
} satisfies Meta<typeof ProposalWorkbench>
export default meta
type Story = StoryObj<typeof meta>
export const Review: Story = {}
export const Empty: Story = { args: { proposals: [] } }
