import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { WorkflowWorkbench } from '#/components/agent-operations/workflow-workbench'
import type {
  AgentWorkflow,
  AgentWorkflowEvent,
  AgentWorkflowStep,
} from '#/lib/agent-workflows'

const workflow: AgentWorkflow = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  goal: 'Apply two reviewed titre corrections in order.',
  status: 'waiting_approval',
  revision: '2',
  plan: {
    formatVersion: 1,
    steps: [
      {
        key: 'correct_titre',
        title: 'Correct titre',
        summary: 'Apply one reviewed value.',
        tool: 'sheetbase.dataset_rows.commit',
        operation: {
          kind: 'dataset_rows.commit',
          datasetId: '33333333-3333-4333-8333-333333333333',
          expectedRevision: 7,
          rows: [
            {
              operation: 'update',
              rowId: '44444444-4444-4444-8444-444444444444',
              expectedRevision: 2,
              values: { titre: 42 },
            },
          ],
        },
        inputReferences: [
          {
            kind: 'dataset_version',
            id: '55555555-5555-4555-8555-555555555555',
          },
        ],
      },
      {
        key: 'correct_recovery',
        title: 'Correct recovery',
        summary: 'Apply the next reviewed value.',
        tool: 'sheetbase.dataset_rows.commit',
        operation: {
          kind: 'dataset_rows.commit',
          datasetId: '33333333-3333-4333-8333-333333333333',
          expectedRevision: 8,
          rows: [
            {
              operation: 'update',
              rowId: '66666666-6666-4666-8666-666666666666',
              expectedRevision: 1,
              values: { recovery: 91 },
            },
          ],
        },
        inputReferences: [],
      },
    ],
  },
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

const steps: AgentWorkflowStep[] = workflow.plan.steps.map(
  (step, position) => ({
    id: `step-${position}`,
    workflow_id: workflow.id,
    position,
    step_key: step.key,
    title: step.title,
    summary: step.summary,
    tool_name: step.tool,
    operation: step.operation,
    input_references: step.inputReferences,
    status: position === 0 ? 'waiting_approval' : 'planned',
    attempt: position === 0 ? 1 : 0,
    proposal_id: position === 0 ? 'proposal-1' : null,
    completed_at: null,
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
  }),
)

const events: AgentWorkflowEvent[] = [
  {
    id: 'event-1',
    workflow_id: workflow.id,
    sequence: 1,
    event_type: 'created',
    actor_user_id: 'user-1',
    actor_credential_id: null,
    detail: {},
    created_at: workflow.created_at,
  },
  {
    id: 'event-2',
    workflow_id: workflow.id,
    sequence: 2,
    event_type: 'step_proposed',
    actor_user_id: 'user-1',
    actor_credential_id: null,
    detail: {},
    created_at: workflow.created_at,
  },
]

const meta = {
  title: 'Automation/WorkflowWorkbench',
  component: WorkflowWorkbench,
  parameters: { layout: 'fullscreen' },
  args: {
    workflows: [workflow],
    steps,
    proposals: [],
    events,
    selectedId: workflow.id,
    onSelect: () => {},
    pendingAction: null,
    onAdvance: () => {},
    onResume: () => {},
    onCancel: () => {},
    onInspectProposal: () => {},
  },
} satisfies Meta<typeof WorkflowWorkbench>
export default meta
type Story = StoryObj<typeof meta>
export const Review: Story = {}
export const Empty: Story = { args: { workflows: [] } }
