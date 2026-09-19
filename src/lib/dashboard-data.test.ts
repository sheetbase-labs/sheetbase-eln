/**
 * OPS-001 dashboard data-layer tests: metric correctness, time-zone handling,
 * and activity sentence derivation.
 */
import { describe, expect, it } from 'vitest'

import {
  activitySentence,
  computeMyWorkMetrics,
  computeProjectMetrics,
  DAY_MS,
  entityLabel,
  isReviewDueSoon,
  isReviewOverdue,
  isWithinLastDays,
  nextDeadlineHint,
  operationLabel,
  OVERDUE_DAYS,
  SOON_DAYS,
  toDashboardActivityItem,
  toDashboardMentionItem,
} from './dashboard-data'
import type { ChangeEventRecordWire, CommentWire } from './dashboard-data'
import type { NotebookRecord } from './notebook-data'
import type { ReviewItem } from './reviews'

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2025, 6, 14, 12, 0, 0) // 2025-07-14T12:00:00Z

function record(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: 'r1',
    projectId: 'p1',
    kind: 'experiment',
    identifier: 'EXP-2025-0001',
    title: 'Virus stability',
    status: 'draft',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2025-07-10T00:00:00Z',
    updatedAt: '2025-07-13T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u1',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
    ...overrides,
  }
}

function review(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'sub-1',
    recordId: 'r1',
    revisionId: 'rev-1',
    state: 'submitted',
    workflowDefinitionKey: 'default-scientific-review',
    workflowDefinitionVersion: 1,
    assignedReviewerUserIds: ['u1'],
    submittedByUserId: 'u2',
    submittedAt: new Date(NOW - 3 * DAY_MS).toISOString(),
    createdAt: new Date(NOW - 3 * DAY_MS).toISOString(),
    updatedAt: new Date(NOW - 3 * DAY_MS).toISOString(),
    recordIdentifier: 'EXP-2025-0001',
    recordTitle: 'Virus stability',
    recordKind: 'experiment',
    recordStatus: 'review',
    projectId: 'p1',
    projectKey: 'LV-001',
    projectTitle: 'Lentivector Stability',
    currentStep: {
      key: 'scientific-review',
      label: 'Scientific review',
      required: true,
    },
    status: 'submitted',
    priority: 'low',
    isOverdue: false,
    isWithdrawn: false,
    ...overrides,
  }
}

function changeEvent(
  overrides: Partial<ChangeEventRecordWire> = {},
): ChangeEventRecordWire {
  return {
    id: 'ce-1',
    entity_type: 'record',
    entity_uuid: 'r1',
    operation: 'update',
    record_id: 'r1',
    actor_user_id: 'u1',
    payload: { title: 'Virus stability' },
    created_at: new Date(NOW - 3600_000).toISOString(),
    ...overrides,
  }
}

function comment(overrides: Partial<CommentWire> = {}): CommentWire {
  return {
    id: 'c-1',
    workspace_id: 'ws-1',
    revision_id: 'rev-1',
    record_id: 'r1',
    root_id: 'c-1',
    parent_id: null,
    target_kind: 'revision',
    target: {},
    body: 'Please review',
    mentions: ['u1'],
    state: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    author_user_id: 'u2',
    created_at: new Date(NOW - 3600_000).toISOString(),
    updated_at: new Date(NOW - 3600_000).toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Time-zone handling tests.
// ---------------------------------------------------------------------------

describe('isWithinLastDays (time-zone safety)', () => {
  it('returns true for a timestamp within the window', () => {
    const iso = new Date(NOW - 3 * DAY_MS).toISOString()
    expect(isWithinLastDays(iso, 7, NOW)).toBe(true)
  })

  it('returns false for a timestamp outside the window', () => {
    const iso = new Date(NOW - 10 * DAY_MS).toISOString()
    expect(isWithinLastDays(iso, 7, NOW)).toBe(false)
  })

  it('uses epoch-millisecond diff, not calendar days', () => {
    // 6 days 23 hours ago is within 7 days even if it crosses a calendar boundary.
    const iso = new Date(NOW - 6 * DAY_MS - 23 * 3600_000).toISOString()
    expect(isWithinLastDays(iso, 7, NOW)).toBe(true)
  })

  it('returns false for null or invalid input', () => {
    expect(isWithinLastDays(null, 7, NOW)).toBe(false)
    expect(isWithinLastDays('not-a-date', 7, NOW)).toBe(false)
  })

  it('is stable across time zones: same epoch, different zone strings', () => {
    // The same instant expressed in UTC vs UTC+5 should give the same result.
    const epoch = NOW - 3 * DAY_MS
    const utcIso = new Date(epoch).toISOString()
    const tzDate = new Date(epoch)
    // toISOString always returns UTC, so the result is zone-independent.
    expect(isWithinLastDays(utcIso, 7, NOW)).toBe(true)
    expect(isWithinLastDays(tzDate.toISOString(), 7, NOW)).toBe(true)
  })
})

describe('isReviewOverdue', () => {
  it('returns true when a submitted review is older than the threshold', () => {
    const iso = new Date(NOW - (OVERDUE_DAYS + 1) * DAY_MS).toISOString()
    expect(isReviewOverdue('submitted', iso, OVERDUE_DAYS, NOW)).toBe(true)
  })

  it('returns false when a submitted review is within the threshold', () => {
    const iso = new Date(NOW - 5 * DAY_MS).toISOString()
    expect(isReviewOverdue('submitted', iso, OVERDUE_DAYS, NOW)).toBe(false)
  })

  it('returns false for non-submitted states', () => {
    const iso = new Date(NOW - 100 * DAY_MS).toISOString()
    expect(isReviewOverdue('approved', iso, OVERDUE_DAYS, NOW)).toBe(false)
  })
})

describe('isReviewDueSoon', () => {
  it('returns true when a review is older than soonDays but not yet overdue', () => {
    const iso = new Date(NOW - (SOON_DAYS + 1) * DAY_MS).toISOString()
    expect(
      isReviewDueSoon('submitted', iso, SOON_DAYS, OVERDUE_DAYS, NOW),
    ).toBe(true)
  })

  it('returns false when a review is fresh', () => {
    const iso = new Date(NOW - 2 * DAY_MS).toISOString()
    expect(
      isReviewDueSoon('submitted', iso, SOON_DAYS, OVERDUE_DAYS, NOW),
    ).toBe(false)
  })

  it('returns false when a review is already overdue', () => {
    const iso = new Date(NOW - (OVERDUE_DAYS + 5) * DAY_MS).toISOString()
    expect(
      isReviewDueSoon('submitted', iso, SOON_DAYS, OVERDUE_DAYS, NOW),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Metric correctness tests.
// ---------------------------------------------------------------------------

describe('computeMyWorkMetrics', () => {
  it('counts assigned experiments, pending reviews, in-progress, activity and mentions', () => {
    const metrics = computeMyWorkMetrics({
      myRecords: [
        record({ kind: 'experiment', status: 'in_progress' }),
        record({ id: 'r2', kind: 'experiment', status: 'draft' }),
        record({ id: 'r3', kind: 'sample', status: 'available' }),
      ],
      pendingReviews: [
        review({ state: 'submitted' }),
        review({ id: 'sub-2', state: 'submitted' }),
      ],
      myMentions: [toDashboardMentionItem(comment())],
      recentActivity: [toDashboardActivityItem(changeEvent())],
      overdueDays: OVERDUE_DAYS,
      soonDays: SOON_DAYS,
    })

    expect(metrics).toHaveLength(5)
    expect(metrics[0].label).toBe('Assigned experiments')
    expect(metrics[0].value).toBe(2) // 2 experiment records
    expect(metrics[0].hint).toBe('1 in progress') // 1 in_progress
    expect(metrics[1].label).toBe('Pending reviews')
    expect(metrics[1].value).toBe(2)
    expect(metrics[1].linkTo).toBe('/reviews')
    expect(metrics[2].label).toBe('In progress')
    expect(metrics[2].value).toBe(1)
    expect(metrics[3].label).toBe('Recent activity')
    expect(metrics[3].value).toBe(1)
    expect(metrics[4].label).toBe('Open mentions')
    expect(metrics[4].value).toBe(1)
  })

  it('produces all-zero metrics for an empty workspace', () => {
    const metrics = computeMyWorkMetrics({
      myRecords: [],
      pendingReviews: [],
      myMentions: [],
      recentActivity: [],
      overdueDays: OVERDUE_DAYS,
      soonDays: SOON_DAYS,
    })

    for (const m of metrics) {
      expect(m.value).toBe(0)
    }
  })

  it('flags overdue reviews with an urgent hint', () => {
    const oldReview = review({
      submittedAt: new Date(NOW - (OVERDUE_DAYS + 5) * DAY_MS).toISOString(),
    })
    const metrics = computeMyWorkMetrics({
      myRecords: [],
      pendingReviews: [oldReview],
      myMentions: [],
      recentActivity: [],
      overdueDays: OVERDUE_DAYS,
      soonDays: SOON_DAYS,
    })

    expect(metrics[1].hint).toBe('1 overdue')
    expect(metrics[1].hintTone).toBe('urgent')
  })

  it('declares time boundaries for every metric', () => {
    const metrics = computeMyWorkMetrics({
      myRecords: [],
      pendingReviews: [],
      myMentions: [],
      recentActivity: [],
      overdueDays: OVERDUE_DAYS,
      soonDays: SOON_DAYS,
    })

    for (const m of metrics) {
      expect(m.timeBoundary).toBeTruthy()
    }
  })
})

describe('computeProjectMetrics', () => {
  it('counts records by kind and links each metric to the project', () => {
    const metrics = computeProjectMetrics({
      records: [
        record({ kind: 'experiment', status: 'in_progress' }),
        record({ id: 'r2', kind: 'sample' }),
        record({ id: 'r3', kind: 'protocol_template' }),
        record({ id: 'r4', kind: 'file' }),
        record({ id: 'r5', kind: 'report' }),
        record({ id: 'r6', kind: 'experiment', status: 'review' }),
      ],
      projectId: 'p1',
      overdueDays: OVERDUE_DAYS,
    })

    expect(metrics).toHaveLength(5)
    expect(metrics[0].label).toBe('Active experiments')
    expect(metrics[0].value).toBe(2) // 2 experiments
    expect(metrics[0].linkParams).toEqual({ projectId: 'p1' })
    expect(metrics[1].label).toBe('Linked samples')
    expect(metrics[1].value).toBe(1)
    expect(metrics[2].label).toBe('Datasets')
    expect(metrics[2].value).toBe(1) // 1 file record
    expect(metrics[3].label).toBe('Protocols')
    expect(metrics[3].value).toBe(1)
    expect(metrics[4].label).toBe('Pending reviews')
    expect(metrics[4].value).toBe(1) // 1 review status
    expect(metrics[4].linkTo).toBe('/reviews')
  })

  it('produces all-zero metrics for an empty project', () => {
    const metrics = computeProjectMetrics({
      records: [],
      projectId: 'p1',
      overdueDays: OVERDUE_DAYS,
    })

    for (const m of metrics) {
      expect(m.value).toBe(0)
    }
  })

  it('declares time boundaries for every metric', () => {
    const metrics = computeProjectMetrics({
      records: [],
      projectId: 'p1',
      overdueDays: OVERDUE_DAYS,
    })

    for (const m of metrics) {
      expect(m.timeBoundary).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// Activity sentence and label derivation.
// ---------------------------------------------------------------------------

describe('activitySentence', () => {
  it('builds a sentence with operation, entity and title from payload', () => {
    const item = toDashboardActivityItem(changeEvent())
    expect(activitySentence(item)).toBe('updated record "Virus stability"')
  })

  it('falls back to identifier when no title is in payload', () => {
    const item = toDashboardActivityItem(
      changeEvent({ payload: { identifier: 'EXP-2025-0001' } }),
    )
    expect(activitySentence(item)).toBe('updated record "EXP-2025-0001"')
  })

  it('omits the quoted title when payload has neither title nor identifier', () => {
    const item = toDashboardActivityItem(changeEvent({ payload: {} }))
    expect(activitySentence(item)).toBe('updated record')
  })
})

describe('operationLabel / entityLabel', () => {
  it('maps known operations', () => {
    expect(operationLabel('create')).toBe('created')
    expect(operationLabel('update')).toBe('updated')
    expect(operationLabel('delete')).toBe('deleted')
    expect(operationLabel('archive')).toBe('archived')
  })

  it('humanises unknown operations rather than leaking the token', () => {
    expect(operationLabel('unknown_op')).toBe('unknown op')
  })

  it('maps known entity types', () => {
    expect(entityLabel('record')).toBe('record')
    expect(entityLabel('block')).toBe('block')
    expect(entityLabel('file')).toBe('file')
    expect(entityLabel('dataset_schema')).toBe('dataset schema')
    expect(entityLabel('report_section')).toBe('report section')
    expect(entityLabel('instrument_qc_check')).toBe('instrument QC check')
  })

  it('humanises unknown entity types rather than leaking the token', () => {
    expect(entityLabel('unknown_entity')).toBe('unknown entity')
    expect(entityLabel('review_decision')).toBe('review decision')
  })
})

// ---------------------------------------------------------------------------
// nextDeadlineHint.
// ---------------------------------------------------------------------------

describe('nextDeadlineHint', () => {
  it('returns "Next: Today" for a review submitted today', () => {
    const r = review({ submittedAt: new Date(NOW).toISOString() })
    expect(nextDeadlineHint([r], NOW)).toBe('Next: Today')
  })

  it('returns "Next: 1 day ago" for a 1-day-old review', () => {
    const r = review({
      submittedAt: new Date(NOW - 1 * DAY_MS).toISOString(),
    })
    expect(nextDeadlineHint([r], NOW)).toBe('Next: 1 day ago')
  })

  it('returns "Next: 5d ago" for a 5-day-old review', () => {
    const r = review({
      submittedAt: new Date(NOW - 5 * DAY_MS).toISOString(),
    })
    expect(nextDeadlineHint([r], NOW)).toBe('Next: 5d ago')
  })

  it('returns undefined when there are no pending reviews', () => {
    expect(nextDeadlineHint([], NOW)).toBeUndefined()
  })

  it('picks the oldest pending review', () => {
    const reviews = [
      review({
        id: 'new',
        submittedAt: new Date(NOW - 1 * DAY_MS).toISOString(),
      }),
      review({
        id: 'old',
        submittedAt: new Date(NOW - 10 * DAY_MS).toISOString(),
      }),
    ]
    expect(nextDeadlineHint(reviews, NOW)).toBe('Next: 10d ago')
  })
})

// ---------------------------------------------------------------------------
// Mapper tests.
// ---------------------------------------------------------------------------

describe('toDashboardActivityItem', () => {
  it('maps a change event wire to the dashboard shape', () => {
    const item = toDashboardActivityItem(changeEvent())
    expect(item.id).toBe('ce-1')
    expect(item.operation).toBe('update')
    expect(item.entityType).toBe('record')
    expect(item.actorUserId).toBe('u1')
    expect(item.recordId).toBe('r1')
  })
})

describe('toDashboardMentionItem', () => {
  it('maps a comment wire to the dashboard shape', () => {
    const item = toDashboardMentionItem(comment())
    expect(item.id).toBe('c-1')
    expect(item.recordId).toBe('r1')
    expect(item.body).toBe('Please review')
    expect(item.authorUserId).toBe('u2')
    expect(item.state).toBe('open')
  })
})
