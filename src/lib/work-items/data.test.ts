import { describe, expect, it } from 'vitest'

import { countByKind, groupWorkItems, toWorkItem } from './data'
import type { WorkItem, WorkItemWire } from './data'

function wire(overrides: Partial<WorkItemWire> = {}): WorkItemWire {
  return {
    kind: 'review_requested',
    record_id: 'r1',
    identifier: 'EXP-0142',
    title: 'Depth filter screening',
    project_id: 'p1',
    reason: 'Review requested',
    due_at: null,
    state: 'needs_action',
    created_at: '2026-09-25T08:40:00Z',
    ...overrides,
  }
}

const NOW = new Date('2026-09-25T09:40:00+01:00')

describe('toWorkItem', () => {
  it('maps the wire row and derives overdue from the due date', () => {
    const item = toWorkItem(
      wire({ due_at: '2026-09-20T09:40:00+01:00', state: 'needs_action' }),
      NOW,
    )
    expect(item.kind).toBe('review_requested')
    expect(item.state).toBe('overdue')
    expect(item.title).toBe('Depth filter screening')
  })

  it('keeps a future due date as needs action', () => {
    const item = toWorkItem(wire({ due_at: '2026-10-01T09:40:00+01:00' }), NOW)
    expect(item.state).toBe('needs_action')
  })

  it('falls back to the identifier when there is no title', () => {
    const item = toWorkItem(wire({ title: null }), NOW)
    expect(item.title).toBe('EXP-0142')
  })

  it('keeps requested witness work actionable and targets its frozen revision', () => {
    const witnessWork = toWorkItem(
      wire({
        kind: 'witness_requested',
        record_id: 'live-record',
        revision_id: 'frozen-revision',
        source_type: 'signature_witness_request',
        source_id: 'witness-request',
      }),
      NOW,
    )
    expect(witnessWork).toMatchObject({
      kind: 'witness_requested',
      recordId: 'live-record',
      revisionId: 'frozen-revision',
      sourceType: 'signature_witness_request',
      sourceId: 'witness-request',
    })
    const groups = groupWorkItems([witnessWork], NOW)
    expect(groups.later).toEqual([witnessWork])
    expect(groups.following).toEqual([])
  })
})

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    kind: 'review_requested',
    recordId: 'r1',
    identifier: 'EXP-1',
    title: 'Item',
    projectId: 'p1',
    reason: 'Review requested',
    dueAt: null,
    state: 'needs_action',
    createdAt: null,
    ...overrides,
  }
}

describe('countByKind', () => {
  it('counts each kind', () => {
    const counts = countByKind([
      item(),
      item(),
      item({ kind: 'run_failed' }),
      item({ kind: 'run_waiting' }),
      item({ kind: 'data_issue' }),
      item({ kind: 'material_expiring' }),
      item({ kind: 'cell_conflict' }),
      item({ kind: 'following' }),
      item({ kind: 'witness_requested' }),
    ])
    expect(counts).toEqual({
      review_requested: 2,
      witness_requested: 1,
      run_failed: 1,
      run_waiting: 1,
      data_issue: 1,
      material_expiring: 1,
      cell_conflict: 1,
      approval_requested: 0,
      following: 1,
    })
  })
})

describe('groupWorkItems', () => {
  it('groups needs-action items by due date and separates follows', () => {
    const groups = groupWorkItems(
      [
        item({ dueAt: '2026-09-25T12:00:00+01:00', recordId: 'today' }),
        item({ dueAt: '2026-09-28T09:40:00+01:00', recordId: 'week' }),
        item({ dueAt: '2026-10-20T09:40:00+01:00', recordId: 'later' }),
        item({ dueAt: null, recordId: 'no-due' }),
        item({ kind: 'following', state: 'following', recordId: 'follow' }),
      ],
      NOW,
    )
    expect(groups.today.map((i) => i.recordId)).toEqual(['today'])
    expect(groups.nextSevenDays.map((i) => i.recordId)).toEqual(['week'])
    expect(groups.later.map((i) => i.recordId).sort()).toEqual([
      'later',
      'no-due',
    ])
    expect(groups.following.map((i) => i.recordId)).toEqual(['follow'])
  })

  it('puts overdue items in today', () => {
    const groups = groupWorkItems(
      [item({ dueAt: '2026-09-01T09:40:00+01:00', state: 'overdue' })],
      NOW,
    )
    expect(groups.today).toHaveLength(1)
  })
})
