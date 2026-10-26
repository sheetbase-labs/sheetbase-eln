import { describe, expect, it } from 'vitest'

import { proposalBoardGroups } from './proposals-board'
import type { AgentOperationProposal } from '#/lib/agent-operations'

const now = new Date('2026-10-26T10:00:00Z')

function proposal(
  id: string,
  status: AgentOperationProposal['status'],
  extra: Partial<AgentOperationProposal> = {},
): AgentOperationProposal {
  return {
    id,
    status,
    display_id: null,
    approver_user_id: null,
    created_at: '2026-10-26T09:00:00Z',
    ...extra,
  } as AgentOperationProposal
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
