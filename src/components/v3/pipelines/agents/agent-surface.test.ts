import { describe, expect, it } from 'vitest'

import { proposalGroups } from './agent-surface'
import type { AgentOperationProposal } from '#/lib/agent-operations'

function proposal(
  id: string,
  status: AgentOperationProposal['status'],
): AgentOperationProposal {
  return { id, status } as AgentOperationProposal
}

describe('proposalGroups', () => {
  it('splits pending into needs-you and waiting, and the rest into decided', () => {
    const groups = proposalGroups(
      [
        proposal('p1', 'pending'),
        proposal('p2', 'approved'),
        proposal('p3', 'rejected'),
      ],
      true,
    )
    expect(groups.map((g) => g.key)).toEqual(['needs', 'decided'])
    expect(groups[0].items.map((p) => p.id)).toEqual(['p1'])
    expect(groups[1].items.map((p) => p.id)).toEqual(['p2', 'p3'])
  })

  it('shows pending as waiting when the caller cannot approve', () => {
    const groups = proposalGroups([proposal('p1', 'pending')], false)
    expect(groups.map((g) => g.key)).toEqual(['waiting'])
  })

  it('does not label an undecidable proposal as someone else handling it', () => {
    // The viewer's own capability says nothing about who else can approve, so
    // the group states what is true: it is still awaiting a decision.
    const groups = proposalGroups([proposal('p1', 'pending')], false)
    expect(groups[0].label).toBe('Awaiting approval')
  })

  it('drops empty groups', () => {
    expect(proposalGroups([proposal('p1', 'succeeded')], true)).toHaveLength(1)
  })
})
