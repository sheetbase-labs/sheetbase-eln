// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentWorkflow,
  AgentWorkflowEvent,
  AgentWorkflowStep,
} from '#/lib/agent-workflows'
import type { AgentOperationProposal } from '#/lib/agent-operations'
import { WorkflowWorkbench } from './workflow-workbench'

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

afterEach(cleanup)

describe('WorkflowWorkbench', () => {
  it('shows the pinned plan, references, provenance, and all budget dimensions', () => {
    render(
      <WorkflowWorkbench
        workflows={[workflow]}
        steps={steps}
        events={events}
        selectedId={workflow.id}
        onSelect={vi.fn()}
        onAdvance={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onInspectProposal={vi.fn()}
      />,
    )

    expect(screen.getByText('Pinned plan')).toBeTruthy()
    expect(screen.getByText(/dataset_version:/)).toBeTruthy()
    expect(screen.getByText('assay-helper')).toBeTruthy()
    expect(screen.getByText('Operations')).toBeTruthy()
    expect(screen.getByText('Tokens')).toBeTruthy()
    expect(screen.getByText('Cost')).toBeTruthy()
    expect(screen.getByText('step proposed')).toBeTruthy()
  })

  it('links to the exact proposal and requires a cancellation reason', () => {
    const onInspectProposal = vi.fn()
    const onCancel = vi.fn()
    render(
      <WorkflowWorkbench
        workflows={[workflow]}
        steps={steps}
        events={events}
        selectedId={workflow.id}
        onSelect={vi.fn()}
        onAdvance={vi.fn()}
        onResume={vi.fn()}
        onCancel={onCancel}
        onInspectProposal={onInspectProposal}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Inspect proposal' }))
    const cancel = screen.getByRole('button', { name: 'Cancel workflow' })
    expect(cancel.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Workflow cancellation reason'), {
      target: { value: 'The reviewed source was withdrawn.' },
    })
    fireEvent.click(cancel)

    expect(onInspectProposal).toHaveBeenCalledWith('proposal-1')
    expect(onCancel).toHaveBeenCalledWith(
      workflow,
      'The reviewed source was withdrawn.',
    )
  })

  it('makes paused recovery explicit and preserves the pinned operation', () => {
    const onResume = vi.fn()
    const paused = { ...workflow, status: 'paused' } satisfies AgentWorkflow
    render(
      <WorkflowWorkbench
        workflows={[paused]}
        steps={[{ ...steps[0], status: 'failed' }, steps[1]]}
        events={events}
        selectedId={paused.id}
        onSelect={vi.fn()}
        onAdvance={vi.fn()}
        onResume={onResume}
        onCancel={vi.fn()}
        onInspectProposal={vi.fn()}
      />,
    )

    expect(screen.getByText(/same pinned operation/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resume exact step' }))
    expect(onResume).toHaveBeenCalledWith(paused)
  })

  it('previews every step with gates and stored proposal detail', () => {
    const pending = {
      id: 'proposal-1',
      status: 'pending',
      approval_policy: 'human_required',
      preview: {
        formatVersion: 1,
        kind: 'dataset_rows.commit',
        target: { type: 'dataset', id: 'dataset-1' },
        changes: [{ path: 'rows.r1', before: null, after: {} }],
      },
      impact: {
        formatVersion: 1,
        mutationClass: 'data',
        target: { type: 'dataset', id: 'dataset-1' },
        createsDraft: false,
        affectedRows: 1,
        destructive: false,
      },
    }
    render(
      <WorkflowWorkbench
        workflows={[workflow]}
        steps={steps}
        events={events}
        proposals={[pending] as unknown as AgentOperationProposal[]}
        selectedId={workflow.id}
        onSelect={vi.fn()}
        onAdvance={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onInspectProposal={vi.fn()}
      />,
    )

    expect(screen.getByText('Dry-run preview')).toBeTruthy()
    expect(screen.getByText('1 pending approval')).toBeTruthy()
    expect(screen.getAllByText('pending approval').length).toBeGreaterThan(1)
    expect(screen.getByText(/Not yet proposed/)).toBeTruthy()
    expect(screen.getByText(/1 change/)).toBeTruthy()
  })
})
