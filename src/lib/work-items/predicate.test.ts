/**
 * QA2-Inbox-1 — the one Inbox predicate the badge, Home and the list share.
 */
import { describe, expect, it } from 'vitest'

import { itemKey, itemTab, needsAction, workItemType } from './predicate'
import type { WorkItemIdentity } from './predicate'

function item(overrides: Partial<WorkItemIdentity>): WorkItemIdentity {
  return {
    kind: 'data_issue',
    state: 'needs_action',
    recordId: null,
    identifier: 'DS-0001',
    title: 'A dataset',
    ...overrides,
  }
}

describe('itemKey', () => {
  it('prefers the exact source, then the record, identifier and title', () => {
    expect(itemKey(item({ sourceId: 'file-1' }))).toBe('data_issue:file-1')
    expect(itemKey(item({ recordId: 'record-1' }))).toBe('data_issue:record-1')
    expect(itemKey(item({ identifier: 'DS-0001' }))).toBe('data_issue:DS-0001')
    expect(itemKey(item({ identifier: null }))).toBe('data_issue:A dataset')
  })
})

describe('itemTab', () => {
  it('places follows on Following whatever their state', () => {
    expect(itemTab(item({ kind: 'following' }), new Set())).toBe('following')
    expect(itemTab(item({ state: 'following' }), new Set())).toBe('following')
  })

  it('moves a seen or done-today item out of Needs action', () => {
    const seen = new Set(['data_issue:DS-0001'])
    expect(itemTab(item({}), seen)).toBe('done-today')
    expect(itemTab(item({ state: 'done_today' }), new Set())).toBe('done-today')
    expect(itemTab(item({}), new Set())).toBe('needs-action')
  })

  it('treats overdue as needing action', () => {
    expect(needsAction(item({ state: 'overdue' }), new Set())).toBe(true)
  })
})

describe('workItemType', () => {
  it('maps kinds to the filter sets the Inbox shows', () => {
    expect(workItemType('review_requested')).toBe('reviews')
    expect(workItemType('witness_requested')).toBe('reviews')
    expect(workItemType('cell_conflict')).toBe('data')
    expect(workItemType('run_waiting')).toBe('runs')
    expect(workItemType('material_expiring')).toBe('materials')
  })
})

describe('workItemType for the waiting states', () => {
  it.each([
    ['review_returned', 'reviews'],
    ['approval_unsigned', 'reviews'],
    ['witness_signed', 'reviews'],
    ['sample_awaiting_release', 'lab'],
    ['sample_hold_exceeded', 'lab'],
    ['calibration_overdue', 'lab'],
    ['access_requested', 'admin'],
    ['access_decided', 'admin'],
    ['agent_proposal', 'admin'],
    ['invitation_accepted', 'admin'],
  ])('files %s under %s', (kind, type) => {
    expect(workItemType(kind)).toBe(type)
  })
})
