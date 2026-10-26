import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PipelineProposalBlock } from '#/components/notebook/pipeline-output-block-proposal'
import type { AgentOperationProposal } from '#/lib/agent-operations'

/**
 * PIPE-03 proposal block: a pipeline's proposed change rendered over the run
 * it targets, with Compare / Accept / Reject. The decision and execute
 * callbacks are the caller's, so the stories record nothing and the states
 * below are the proposal's own status.
 */
const RUN_ID = '0198d970-e266-4000-8000-000000000148'

function proposal(
  overrides: Partial<AgentOperationProposal> = {},
): AgentOperationProposal {
  return {
    id: 'proposal-1',
    workspace_id: 'workspace-1',
    title: 'Add Figure 1 after Figure 1',
    summary: 'A new Figure 1 from DS-0311 snapshot S-15, which adds plate 4.',
    operation_kind: 'dataset_schema.create',
    operation: {
      kind: 'dataset_schema.create',
      workspaceId: 'workspace-1',
      key: 'figure_1',
      name: 'Figure 1',
      fields: [],
    },
    preview: {
      formatVersion: 1,
      kind: 'dataset_schema.create',
      target: { type: 'record', id: RUN_ID, label: 'Figure 1' },
      changes: [
        { path: 'blocks.figure-1', before: null, after: { type: 'chart' } },
      ],
    },
    impact: {
      formatVersion: 1,
      mutationClass: 'configuration',
      target: { type: 'record', id: RUN_ID, label: 'Figure 1' },
      createsDraft: true,
      affectedRows: 1,
      destructive: false,
    },
    risk_class: 'safe_draft',
    approval_policy: 'human_required',
    policy_id: null,
    policy_reason: 'A person must approve this change.',
    policy_limits: {},
    policy_target: {},
    policy_evidence: {},
    status: 'pending',
    revision: 1,
    idempotency_key: 'pipeline:run-148:figure',
    request_digest: 'a'.repeat(64),
    provenance: {
      agentId: 'pipeline',
      tool: { name: 'pipeline' },
      model: { provider: 'sheetbase', name: 'pipeline' },
      invocationId: 'run-148',
    },
    proposed_by_user_id: 'user-1',
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
    display_id: null,
    agent_definition_id: null,
    agent_run_id: null,
    approver_user_id: null,
    signature_required: false,
    approval_meaning: null,
    approval_signed_at: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  }
}

const meta = {
  title: 'Notebook/Pipeline proposal block',
  component: PipelineProposalBlock,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[760px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    proposal: proposal(),
    runId: RUN_ID,
    currentOutput: 'No Figure 1 in the current output.',
    onDecide: () => {},
    onExecute: () => {},
  },
} satisfies Meta<typeof PipelineProposalBlock>
export default meta
type Story = StoryObj<typeof meta>

/** Pending: the reviewer may accept or reject, with the reason field. */
export const Pending: Story = {}

/** The decision in flight holds both actions. */
export const Deciding: Story = { args: { pending: 'approve' } }

/** A refused decision is reported beside the actions. */
export const DecisionError: Story = {
  args: { error: 'The proposal changed since you read it.' },
}

/** Approved but not yet applied: execution is the next step. */
export const Approved: Story = {
  args: { proposal: proposal({ status: 'approved' }) },
}

/** Already applied: the block reports the outcome, with no controls. */
export const Succeeded: Story = {
  args: { proposal: proposal({ status: 'succeeded' }) },
}

/** Applied and failed: the error is shown as it stands. */
export const Failed: Story = {
  args: {
    proposal: proposal({
      status: 'failed',
      error_message:
        'The target record was archived before the change applied.',
    }),
  },
}

/** Rejected: the decision and its reason are recorded. */
export const Rejected: Story = {
  args: {
    proposal: proposal({
      status: 'rejected',
      rejected_by_user_id: 'user-2',
      rejected_at: '2026-10-02T09:00:00Z',
      rejection_reason: 'Plate 4 is not part of this submission.',
    }),
  },
}

/** Read-only renderings (preview, viewer, signed) offer no decision. */
export const ReadOnly: Story = { args: { readOnly: true } }
