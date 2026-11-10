import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentProposalsBoard, proposalBoardGroups } from './proposals-board'
import type { AgentOperationProposal } from '#/lib/agent-operations'

const now = new Date('2026-10-26T10:00:00Z')

afterEach(cleanup)

function proposal(
  id: string,
  status: AgentOperationProposal['status'],
  extra: Partial<AgentOperationProposal> = {},
): AgentOperationProposal {
  return {
    id,
    status,
    workspace_id: 'workspace-1',
    title: 'Create assay schema',
    summary: 'Draft schema',
    operation_kind: 'dataset_schema.create',
    operation: {
      kind: 'dataset_schema.create',
      workspaceId: 'workspace-1',
      key: 'assay',
      name: 'Assay',
      fields: [],
    },
    preview: {
      formatVersion: 1,
      kind: 'dataset_schema.create',
      target: { type: 'workspace', id: 'workspace-1', label: 'Workspace' },
      changes: [],
    },
    impact: {
      formatVersion: 1,
      mutationClass: 'configuration',
      target: { type: 'workspace', id: 'workspace-1', label: 'Workspace' },
      createsDraft: true,
      affectedRows: 0,
      destructive: false,
    },
    risk_class: 'safe_draft',
    approval_policy: 'human_required',
    policy_id: null,
    policy_reason: 'Review required',
    policy_limits: {},
    policy_target: {},
    policy_evidence: {},
    revision: 1,
    idempotency_key: id,
    request_digest: 'digest',
    provenance: {
      agentId: 'agent-1',
      tool: { name: 'schema' },
      model: { provider: 'local', name: 'test' },
      invocationId: id,
    },
    proposed_by_user_id: null,
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
    agent_definition_id: null,
    agent_run_id: null,
    signature_required: false,
    approval_meaning: null,
    approval_signed_at: null,
    display_id: null,
    approver_user_id: null,
    created_at: '2026-10-26T09:00:00Z',
    updated_at: '2026-10-26T09:00:00Z',
    ...extra,
  }
}

describe('proposalBoardGroups', () => {
  it('puts pending work this person may decide under needs-you', () => {
    const groups = proposalBoardGroups(
      [proposal('p1', 'pending'), proposal('p2', 'rejected')],
      { userId: 'u1', canApprove: true },
      now,
    )

    expect(groups.map((g) => g.stage)).toEqual(['needs', 'decided'])
  })

  it('shows pending as waiting when the caller cannot approve', () => {
    const groups = proposalBoardGroups(
      [proposal('p1', 'pending')],
      { userId: 'u1', canApprove: false },
      now,
    )

    expect(groups.map((g) => g.stage)).toEqual(['waiting'])
  })

  it('drops empty groups', () => {
    const groups = proposalBoardGroups(
      [],
      { userId: 'u1', canApprove: true },
      now,
    )

    expect(groups).toEqual([])
  })
})

describe('proposal decisions', () => {
  it('requires a reason, trims it and resets rejection when selection changes', async () => {
    const user = userEvent.setup()
    const first = proposal('p1', 'pending')
    const second = proposal('p2', 'pending', { title: 'Second schema' })
    const onReject = vi.fn()

    const props = {
      proposals: [first, second],
      definitions: [],
      runs: [],
      events: [],
      selectedId: first.id,
      onSelect: vi.fn(),
      onApprove: vi.fn(),
      onReject,
      onExecute: vi.fn(),
      me: { userId: 'u1', canApprove: true },
      canApproveProposal: () => true,
      nameOf: () => null,
      now,
      pendingAction: null,
    } satisfies React.ComponentProps<typeof AgentProposalsBoard>

    const view = render(createElement(AgentProposalsBoard, props))

    await user.click(screen.getByRole('button', { name: 'Reject…' }))
    expect(
      screen
        .getByRole('button', { name: 'Reject proposal' })
        .hasAttribute('disabled'),
    ).toBe(true)
    await user.type(
      screen.getByRole('textbox', { name: 'Rejection reason' }),
      '  Check assay  ',
    )
    await user.click(screen.getByRole('button', { name: 'Reject proposal' }))
    expect(onReject).toHaveBeenCalledWith(first, 'Check assay')
    view.rerender(
      createElement(AgentProposalsBoard, { ...props, selectedId: second.id }),
    )
    expect(
      screen.queryByRole('textbox', { name: 'Rejection reason' }),
    ).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Reject…' }))
    expect(
      screen.getByRole('textbox', { name: 'Rejection reason' }),
    ).toHaveProperty('value', '')
  })

  it('opens signature confirmation rather than approving immediately', async () => {
    const user = userEvent.setup()
    const selected = proposal('signed', 'pending', { signature_required: true })
    const onApprove = vi.fn()
    render(
      createElement(AgentProposalsBoard, {
        proposals: [selected],
        definitions: [],
        runs: [],
        events: [],
        selectedId: selected.id,
        onSelect: vi.fn(),
        onApprove,
        onReject: vi.fn(),
        onExecute: vi.fn(),
        me: { userId: 'u1', canApprove: true },
        canApproveProposal: () => true,
        nameOf: () => null,
        now,
        pendingAction: null,
      }),
    )

    await user.click(
      screen.getByRole('button', { name: /Sign.*approve.*execute/i }),
    )
    expect(onApprove).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Sign.*approve/i }))
    expect(onApprove).toHaveBeenCalledWith(selected, 'I approve this proposal')
  })
})
