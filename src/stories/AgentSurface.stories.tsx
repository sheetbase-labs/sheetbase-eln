import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  AgentPoliciesPanel,
  AgentWorkflowsPanel,
} from '#/components/v3/pipelines/agents/agent-surface'
import { AgentProposalsBoard } from '#/components/v3/pipelines/agents/proposals-board'
import type { AgentPolicyCredentialOption } from '#/components/v3/pipelines/agents/agents-data'
import type {
  AgentOperation,
  AgentOperationEvent,
  AgentOperationImpact,
  AgentOperationPolicy,
  AgentOperationPreview,
  AgentOperationProposal,
} from '#/lib/agent-operations'
import type {
  AgentWorkflow,
  AgentWorkflowEvent,
  AgentWorkflowStep,
} from '#/lib/agent-workflows'
import { screenRoutes } from './screen-stories'

/**
 * The agent surface (`src/components/v3/pipelines/agents/agent-surface.tsx`) —
 * the three panels `/pipelines/agents` shows: operation proposals, agent
 * workflows, and the execution policies that delegate a write.
 *
 * A proposal is a typed operation a reader approves or rejects before it can
 * touch durable state; a workflow is a plan that advances step by step; a
 * policy is a signed delegation. Each panel is prop-driven — the route owns the
 * reads and the mutations — so the stories are the real props, including the
 * states that matter: a proposal the viewer cannot approve, a paused workflow,
 * and the policy empty state with and without the capability to create one.
 */
const meta = {
  title: 'Pipelines/Agent surface',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        // The policies panel links to the credentials surface.
        route: screenRoutes('/settings/api'),
        path: '/settings/api',
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/**
 * A fixture's operation payload. The union's members carry typed
 * configurations with many fields; the panels read only its `kind`, so the
 * fixtures keep the kind and the shape a reviewer needs to see.
 */
function operationOf(value: object): AgentOperation {
  return value as unknown as AgentOperation
}

const provenance = {
  agentId: 'agent-aav9-01',
  agentName: 'AAV9 analyst',
  tool: {
    name: 'sheetbase.pipeline_definition.version_draft',
    version: '1.4.0',
  },
  model: { provider: 'anthropic', name: 'claude-sonnet', version: '4.5' },
  invocationId: 'inv-88213',
}

const preview: AgentOperationPreview = {
  formatVersion: 1,
  kind: 'pipeline_definition.create_version',
  target: {
    type: 'pipeline_definition',
    id: 'def-1',
    label: 'AAV9 titre pipeline',
  },
  currentRevision: 6,
  expectedRevision: 6,
  changes: [
    {
      path: 'configuration.steps[1].statement',
      before: 'select well, value from raw_plate_readings',
      after:
        'select well, round(value::numeric, 6) as value from raw_plate_readings',
    },
  ],
}

const impact: AgentOperationImpact = {
  formatVersion: 1,
  mutationClass: 'configuration',
  target: {
    type: 'pipeline_definition',
    id: 'def-1',
    label: 'AAV9 titre pipeline',
  },
  createsDraft: true,
  affectedRows: 0,
  destructive: false,
}

function proposal(
  overrides: Partial<AgentOperationProposal> = {},
): AgentOperationProposal {
  return {
    id: 'prop-1',
    workspace_id: 'ws-1',
    title: 'Round plate readings to six decimals',
    summary:
      'Draft the next version of the AAV9 titre pipeline with a rounded value in the normalise step.',
    operation_kind: 'pipeline_definition.create_version',
    operation: operationOf({
      kind: 'pipeline_definition.create_version',
      workspaceId: 'ws-1',
      definitionId: 'def-1',
      expectedDefinitionRevision: 6,
      configuration: { configVersion: 1, steps: [] },
    }),
    preview,
    impact,
    risk_class: 'safe_draft',
    approval_policy: 'human_required',
    policy_id: null,
    policy_reason:
      'The step writes a new draft version, which no run can use yet.',
    policy_limits: {},
    policy_target: {},
    policy_evidence: {},
    status: 'pending',
    revision: 1,
    idempotency_key: 'idem-1',
    request_digest: 'sha256:2f1c…',
    provenance,
    proposed_by_user_id: null,
    proposed_by_credential_id: 'cred-1',
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
    created_at: '2026-10-02T10:05:00.000Z',
    updated_at: '2026-10-02T10:05:00.000Z',
    ...overrides,
  }
}

const proposals: AgentOperationProposal[] = [
  proposal(),
  proposal({
    id: 'prop-2',
    title: 'Append 480 rows to Ambr readings',
    summary: 'Commit the plate reader export into the dataset revision.',
    operation_kind: 'dataset_rows.commit',
    operation: operationOf({
      kind: 'dataset_rows.commit',
      datasetId: 'ds-1',
      expectedRevision: 12,
      rows: [],
    }),
    preview: {
      ...preview,
      kind: 'dataset_rows.commit',
      target: { type: 'dataset', id: 'ds-1', label: 'Ambr readings' },
      changes: [
        { path: 'rows.appended', before: 1240, after: 1720 },
        { path: 'revision', before: 12, after: 13 },
      ],
    },
    impact: {
      ...impact,
      mutationClass: 'data',
      target: { type: 'dataset', id: 'ds-1', label: 'Ambr readings' },
      createsDraft: false,
      affectedRows: 480,
    },
    risk_class: 'consequential_write',
    approval_policy: 'delegated',
    status: 'approved',
    approved_by_user_id: 'user-9',
    approved_at: '2026-10-02T10:20:00.000Z',
  }),
  proposal({
    id: 'prop-3',
    title: 'Create the harvest sheet',
    summary: 'A sheet definition the agent proposed for the harvest step.',
    operation_kind: 'sheet_definition.create',
    status: 'rejected',
    rejected_by_user_id: 'user-4',
    rejected_at: '2026-10-02T11:00:00.000Z',
    rejection_reason: 'The harvest sheet is already covered by the notebook.',
    created_at: '2026-10-02T10:40:00.000Z',
  }),
  proposal({
    id: 'prop-4',
    title: 'Append 12 rows to QC results',
    summary:
      'The write failed after approval; the error is kept on the proposal.',
    operation_kind: 'dataset_rows.commit',
    status: 'failed',
    error_code: 'SB-revision-conflict',
    error_message:
      'The dataset revision changed since the proposal was approved.',
    created_at: '2026-10-01T09:15:00.000Z',
  }),
]

const events: AgentOperationEvent[] = [
  ['proposed', '2026-10-02T10:05'],
  ['approved', '2026-10-02T10:20'],
  ['execution_started', '2026-10-02T10:21'],
  ['execution_succeeded', '2026-10-02T10:21'],
].map(([event_type, created_at], index) => ({
  id: `ev-${index}`,
  proposal_id: 'prop-1',
  sequence: index + 1,
  event_type,
  actor_user_id: index === 0 ? null : 'user-9',
  actor_credential_id: index === 0 ? 'cred-1' : null,
  detail: {},
  created_at: `${created_at}:00.000Z`,
})) as AgentOperationEvent[]

/** Pending work needing this reader, an approved proposal to execute, and decided history. */
export const Proposals: Story = {
  render: () => (
    <div className="h-[560px]">
      <AgentProposalsBoard
        proposals={proposals}
        events={events}
        selectedId="prop-1"
        onSelect={noop}
        onApprove={noop}
        onReject={noop}
        onExecute={noop}
        definitions={[]}
        runs={[]}
        me={{ userId: 'user-9', canApprove: true }}
        canApproveProposal={() => true}
        nameOf={() => null}
        now={new Date('2026-10-03T10:00:00Z')}
        pendingAction={null}
      />
    </div>
  ),
}

/** A reader who can inspect but not approve: the group is named as undecided. */
export const ProposalsWithoutApproval: Story = {
  render: () => (
    <div className="h-[560px]">
      <AgentProposalsBoard
        proposals={proposals}
        events={events}
        selectedId="prop-1"
        onSelect={noop}
        onApprove={noop}
        onReject={noop}
        onExecute={noop}
        definitions={[]}
        runs={[]}
        me={{ userId: 'user-9', canApprove: false }}
        canApproveProposal={() => false}
        nameOf={() => null}
        now={new Date('2026-10-03T10:00:00Z')}
        pendingAction={null}
      />
    </div>
  ),
}

/** Nothing proposed yet: proposals are submitted by agents through the API. */
export const ProposalsEmpty: Story = {
  render: () => (
    <AgentProposalsBoard
      proposals={[]}
      events={[]}
      selectedId={null}
      onSelect={noop}
      onApprove={noop}
      onReject={noop}
      onExecute={noop}
      definitions={[]}
      runs={[]}
      me={{ userId: 'user-9', canApprove: true }}
      canApproveProposal={() => true}
      nameOf={() => null}
      now={new Date('2026-10-03T10:00:00Z')}
      pendingAction={null}
    />
  ),
}

function workflow(overrides: Partial<AgentWorkflow> = {}): AgentWorkflow {
  return {
    id: 'wf-1',
    workspace_id: 'ws-1',
    goal: 'Prepare the AAV9 stability dataset for the week-12 readout',
    status: 'waiting_approval',
    revision: 3,
    plan: {
      formatVersion: 1,
      steps: [
        {
          key: 'create-dataset',
          title: 'Create the stability dataset',
          summary: 'A dataset for the week-12 plate readings.',
          tool: 'sheetbase.dataset_schema.draft',
          operation: operationOf({
            kind: 'dataset_schema.create',
            workspaceId: 'ws-1',
            key: 'aav9-w12',
            name: 'AAV9 week 12',
            fields: [],
          }),
          inputReferences: [],
        },
        {
          key: 'commit-rows',
          title: 'Commit the plate reader export',
          summary: '480 rows into the dataset revision.',
          tool: 'sheetbase.dataset_rows.commit',
          operation: operationOf({
            kind: 'dataset_rows.commit',
            datasetId: 'ds-1',
            expectedRevision: 12,
            rows: [],
          }),
          inputReferences: [{ kind: 'dataset_version', id: 'v-12' }],
        },
      ],
    },
    plan_digest: 'sha256:9c41f8b0a2d4',
    provenance,
    idempotency_key: 'wf-idem-1',
    max_operations: 24,
    max_tokens: 200000,
    max_cost_microusd: 4000000,
    used_operations: 1,
    used_tokens: 18320,
    used_cost_microusd: 214000,
    current_step: 1,
    created_by_user_id: null,
    created_by_credential_id: 'cred-1',
    cancelled_by_user_id: null,
    cancelled_by_credential_id: null,
    cancelled_at: null,
    cancellation_reason: null,
    completed_at: null,
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-02T09:00:00.000Z',
    ...overrides,
  }
}

const workflowSteps: AgentWorkflowStep[] = [
  {
    id: 'st-1',
    workflow_id: 'wf-1',
    position: 0,
    step_key: 'create-dataset',
    title: 'Create the stability dataset',
    summary: 'A dataset for the week-12 plate readings.',
    tool_name: 'sheetbase.dataset_schema.draft',
    operation: operationOf({ kind: 'dataset_schema.create' }),
    input_references: [],
    status: 'succeeded',
    attempt: 1,
    proposal_id: null,
    completed_at: '2026-10-01T08:04:00.000Z',
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:04:00.000Z',
  },
  {
    id: 'st-2',
    workflow_id: 'wf-1',
    position: 1,
    step_key: 'commit-rows',
    title: 'Commit the plate reader export',
    summary: '480 rows into the dataset revision.',
    tool_name: 'sheetbase.dataset_rows.commit',
    operation: operationOf({ kind: 'dataset_rows.commit' }),
    input_references: [{ kind: 'dataset_version', id: 'v-12' }],
    status: 'waiting_approval',
    attempt: 1,
    proposal_id: 'prop-2',
    completed_at: null,
    created_at: '2026-10-01T08:04:00.000Z',
    updated_at: '2026-10-01T08:05:00.000Z',
  },
]

const workflowEvents = [
  {
    id: 'wev-1',
    event_type: 'created',
    sequence: 1,
    created_at: '2026-10-01T08:00:00.000Z',
  },
  {
    id: 'wev-2',
    event_type: 'step_succeeded',
    sequence: 2,
    created_at: '2026-10-01T08:04:00.000Z',
  },
  {
    id: 'wev-3',
    event_type: 'step_proposed',
    sequence: 3,
    created_at: '2026-10-01T08:05:00.000Z',
  },
].map((event) => ({
  ...event,
  workflow_id: 'wf-1',
  actor_user_id: null,
  actor_credential_id: 'cred-1',
  detail: {},
})) as AgentWorkflowEvent[]

/** A plan waiting on a human: the step outcome, budget and related proposals. */
export const Workflows: Story = {
  render: () => (
    <div className="h-[560px]">
      <AgentWorkflowsPanel
        workflows={[workflow()]}
        steps={workflowSteps}
        events={workflowEvents}
        proposals={proposals}
        selectedId="wf-1"
        onSelect={noop}
        onAdvance={noop}
        onResume={noop}
        onCancel={noop}
        onInspectProposal={noop}
        pendingAction={null}
      />
    </div>
  ),
}

/** Paused after a refused step: resuming proposes the same step under a new key. */
export const WorkflowPaused: Story = {
  render: () => (
    <div className="h-[560px]">
      <AgentWorkflowsPanel
        workflows={[
          workflow({
            status: 'paused',
            used_operations: 2,
            updated_at: '2026-10-02T09:30:00.000Z',
          }),
        ]}
        steps={[
          workflowSteps[0],
          {
            ...workflowSteps[1],
            status: 'rejected',
            updated_at: '2026-10-02T09:30:00.000Z',
          },
        ]}
        events={workflowEvents}
        proposals={proposals}
        selectedId={null}
        onSelect={noop}
        onAdvance={noop}
        onResume={noop}
        onCancel={noop}
        onInspectProposal={noop}
        pendingAction={null}
      />
    </div>
  ),
}

/** A finished run of the plan: every step succeeded and the budgets are spent. */
export const WorkflowSucceeded: Story = {
  render: () => (
    <div className="h-[560px]">
      <AgentWorkflowsPanel
        workflows={[
          workflow({
            status: 'succeeded',
            current_step: 1,
            used_operations: 2,
            completed_at: '2026-10-02T10:30:00.000Z',
          }),
        ]}
        steps={[
          workflowSteps[0],
          {
            ...workflowSteps[1],
            status: 'succeeded',
            completed_at: '2026-10-02T10:30:00.000Z',
          },
        ]}
        events={workflowEvents}
        proposals={proposals}
        selectedId={null}
        onSelect={noop}
        onAdvance={noop}
        onResume={noop}
        onCancel={noop}
        onInspectProposal={noop}
        pendingAction={null}
      />
    </div>
  ),
}

/** Nothing running: a workflow appears when an agent client starts one. */
export const WorkflowsEmpty: Story = {
  render: () => (
    <AgentWorkflowsPanel
      workflows={[]}
      steps={[]}
      events={[]}
      proposals={[]}
      selectedId={null}
      onSelect={noop}
      onAdvance={noop}
      onResume={noop}
      onCancel={noop}
      onInspectProposal={noop}
      pendingAction={null}
    />
  ),
}

const credentials: AgentPolicyCredentialOption[] = [
  { id: 'cred-1', name: 'Pipeline worker', displayPrefix: 'sb_live_ab' },
]

function policy(
  overrides: Partial<AgentOperationPolicy> = {},
): AgentOperationPolicy {
  return {
    id: 'pol-1',
    workspace_id: 'ws-1',
    name: 'Assay import rows',
    credential_id: 'cred-1',
    operation_kind: 'dataset_rows.commit',
    target_type: 'dataset',
    target_id: 'ds-1',
    limits: { maxAffectedRows: 500 },
    enabled: true,
    reason: 'Nightly Ambr exports land without a person in the loop.',
    signed_by_user_id: 'user-4',
    signed_meaning: 'I approve this delegation',
    signed_at: '2026-09-20T08:00:00.000Z',
    created_by_user_id: 'user-4',
    updated_by_user_id: 'user-4',
    created_at: '2026-09-20T08:00:00.000Z',
    updated_at: '2026-09-20T08:00:00.000Z',
    ...overrides,
  }
}

/** A signed delegation, its credential, target and row limit, with the create form. */
export const Policies: Story = {
  render: () => (
    <AgentPoliciesPanel
      policies={[
        policy(),
        policy({
          id: 'pol-2',
          name: 'Sheet draft from the planning agent',
          operation_kind: 'sheet_definition.create',
          target_type: 'project',
          target_id: 'prj-3',
          limits: { maxAffectedRows: 1 },
          enabled: false,
          reason: null,
          signed_at: null,
          signed_meaning: null,
        }),
      ]}
      credentials={credentials}
      canManage
      onCreate={noop}
      onDisable={noop}
    />
  ),
}

/** No policy yet and the capability to create one: the empty state's action starts the form. */
export const PoliciesEmpty: Story = {
  render: () => (
    <AgentPoliciesPanel
      policies={[]}
      credentials={credentials}
      canManage
      onCreate={noop}
      onDisable={noop}
    />
  ),
}

/** A reader who cannot manage policies: no action, and who to ask instead. */
export const PoliciesReadOnly: Story = {
  render: () => (
    <AgentPoliciesPanel
      policies={[]}
      credentials={credentials}
      canManage={false}
      onCreate={noop}
      onDisable={noop}
    />
  ),
}

/** No service credential to delegate to: the form says why it cannot run. */
export const PoliciesWithoutCredential: Story = {
  render: () => (
    <AgentPoliciesPanel
      policies={[]}
      credentials={[]}
      canManage
      onCreate={noop}
      onDisable={noop}
    />
  ),
}
