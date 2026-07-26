/**
 * REV-006 review inbox data-layer tests: mapping, workflow/status/priority
 * derivation, overdue heuristic, and client-side filter/sort/paginate.
 */
import { describe, expect, it } from 'vitest'

import {
  currentStepFor,
  DEFAULT_REVIEW_FILTERS,
  filterReviews,
  inboxStatusFor,
  isOverdueFor,
  MEDIUM_DAYS,
  OVERDUE_DAYS,
  paginateReviews,
  priorityFor,
  sortReviews,
  toReviewItem,
  workflowStepsFor,
} from './reviews'
import type { ReviewSubmissionWire } from './reviews'
import type { RecordWire } from './notebook-data'

function submission(
  overrides: Partial<ReviewSubmissionWire> = {},
): ReviewSubmissionWire {
  return {
    id: 'sub-1',
    workspace_id: 'ws-1',
    record_id: 'rec-1',
    revision_id: 'rev-1',
    state: 'submitted',
    workflow_definition_key: 'default-scientific-review',
    workflow_definition_version: 1,
    assigned_reviewer_user_ids: ['reviewer-a'],
    submitted_by_user_id: 'owner-a',
    submitted_session_id: 'session-owner-a',
    submitted_role: 'authenticated',
    submitted_at: new Date().toISOString(),
    idempotency_key: 'idem-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function record(overrides: Partial<RecordWire> = {}): RecordWire {
  return {
    id: 'rec-1',
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    folder_id: null,
    kind: 'experiment',
    identifier: 'EXP-2025-0001',
    title: 'Virus stability',
    status: 'draft',
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'owner-a',
    updated_by_user_id: null,
    properties: {},
    ...overrides,
  }
}

const PROJECT = { key: 'STAB', title: 'Lentivector Stability' }

describe('review inbox derivation', () => {
  it('maps a submission with its joined record and project', () => {
    const item = toReviewItem(
      submission(),
      record(),
      PROJECT.title,
      PROJECT.key,
    )
    expect(item).toMatchObject({
      recordIdentifier: 'EXP-2025-0001',
      recordTitle: 'Virus stability',
      recordKind: 'experiment',
      projectTitle: 'Lentivector Stability',
      submittedByUserId: 'owner-a',
      status: 'submitted',
    })
    expect(item.currentStep).toEqual({
      key: 'scientific-review',
      label: 'Scientific review',
      required: true,
    })
  })

  it('falls back to the record id when the joined record is missing', () => {
    const item = toReviewItem(submission(), undefined, null, null)
    expect(item.recordIdentifier).toBe('rec-1')
    expect(item.recordTitle).toBe('Untitled record')
    expect(item.projectTitle).toBeNull()
  })

  it('derives the current step from the known workflow and stays on step 1 while submitted', () => {
    expect(workflowStepsFor('default-scientific-review')).toHaveLength(1)
    const step = currentStepFor({
      state: 'submitted',
      workflowDefinitionKey: 'default-scientific-review',
    })
    expect(step.key).toBe('scientific-review')
  })

  it('synthesises a labelled step for an unknown workflow instead of hiding it', () => {
    const steps = workflowStepsFor('qa-final-approval')
    expect(steps).toHaveLength(1)
    expect(steps[0].label).toBe('Qa Final Approval')
  })

  it('maps the raw state onto the inbox status vocabulary, defaulting to submitted', () => {
    expect(inboxStatusFor('submitted')).toBe('submitted')
    expect(inboxStatusFor('withdrawn')).toBe('withdrawn')
    expect(inboxStatusFor('approved')).toBe('approved')
    expect(inboxStatusFor('something-new')).toBe('submitted')
  })

  it('flags a review overdue only when submitted beyond the SLA window', () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString()
    const old = new Date(
      Date.now() - (OVERDUE_DAYS + 1) * 86_400_000,
    ).toISOString()
    expect(isOverdueFor('submitted', recent)).toBe(false)
    expect(isOverdueFor('submitted', old)).toBe(true)
    // Non-submitted reviews are never overdue.
    expect(isOverdueFor('withdrawn', old)).toBe(false)
  })

  it('derives priority from ageing: low → medium → high', () => {
    const fresh = new Date().toISOString()
    const aging = new Date(
      Date.now() - (MEDIUM_DAYS + 1) * 86_400_000,
    ).toISOString()
    const stale = new Date(
      Date.now() - (OVERDUE_DAYS + 1) * 86_400_000,
    ).toISOString()
    expect(priorityFor('submitted', fresh)).toBe('low')
    expect(priorityFor('submitted', aging)).toBe('medium')
    expect(priorityFor('submitted', stale)).toBe('high')
    // Resolved reviews drop to low regardless of age.
    expect(priorityFor('approved', stale)).toBe('low')
  })

  it('marks withdrawn submissions', () => {
    const item = toReviewItem(
      submission({ state: 'withdrawn' }),
      record(),
      PROJECT.title,
      PROJECT.key,
    )
    expect(item.isWithdrawn).toBe(true)
    expect(item.status).toBe('withdrawn')
  })
})

describe('review inbox filter/sort/paginate', () => {
  const items = [
    toReviewItem(
      submission({
        id: 'sub-a',
        record_id: 'rec-a',
        assigned_reviewer_user_ids: ['me'],
        submitted_by_user_id: 'owner-a',
        submitted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      }),
      record({
        id: 'rec-a',
        identifier: 'EXP-0001',
        kind: 'experiment',
        project_id: 'proj-1',
      }),
      'Lentivector',
      'LV',
    ),
    toReviewItem(
      submission({
        id: 'sub-b',
        record_id: 'rec-b',
        assigned_reviewer_user_ids: ['other'],
        submitted_by_user_id: 'owner-b',
        submitted_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
      }),
      record({
        id: 'rec-b',
        identifier: 'PROT-0001',
        kind: 'protocol_template',
        project_id: 'proj-1',
      }),
      'Lentivector',
      'LV',
    ),
    toReviewItem(
      submission({
        id: 'sub-c',
        record_id: 'rec-c',
        state: 'withdrawn',
        assigned_reviewer_user_ids: ['me'],
        submitted_by_user_id: 'owner-c',
        submitted_at: new Date().toISOString(),
      }),
      record({
        id: 'rec-c',
        identifier: 'DS-0001',
        kind: 'dataset',
        project_id: 'proj-1',
      }),
      'Lentivector',
      'LV',
    ),
  ]

  it('filters by status, type, assignee, overdue and free-text search', () => {
    expect(
      filterReviews(
        items,
        { ...DEFAULT_REVIEW_FILTERS, status: 'withdrawn' },
        'me',
      ),
    ).toHaveLength(1)
    expect(
      filterReviews(
        items,
        { ...DEFAULT_REVIEW_FILTERS, type: 'protocol_template' },
        'me',
      ),
    ).toHaveLength(1)
    expect(
      filterReviews(
        items,
        { ...DEFAULT_REVIEW_FILTERS, assignee: 'mine' },
        'me',
      ),
    ).toHaveLength(2)
    expect(
      filterReviews(
        items,
        { ...DEFAULT_REVIEW_FILTERS, overdue: 'overdue' },
        'me',
      ),
    ).toHaveLength(1)
    expect(
      filterReviews(
        items,
        { ...DEFAULT_REVIEW_FILTERS, search: 'EXP-0001' },
        'me',
      ),
    ).toHaveLength(1)
    expect(
      filterReviews(
        items,
        { ...DEFAULT_REVIEW_FILTERS, search: 'lentivector' },
        'me',
      ),
    ).toHaveLength(3)
  })

  it('sorts by entry, submitted date and priority', () => {
    const byEntry = sortReviews(items, 'entry', false)
    expect(byEntry.map((i) => i.recordIdentifier)).toEqual([
      'DS-0001',
      'EXP-0001',
      'PROT-0001',
    ])
    const newest = sortReviews(items, 'submitted', true)
    expect(newest[0].id).toBe('sub-c')
    const byPriority = sortReviews(items, 'priority', false)
    expect(byPriority[0].priority).toBe('high')
  })

  it('paginates the filtered set', () => {
    expect(paginateReviews(items, 0, 2)).toHaveLength(2)
    expect(paginateReviews(items, 1, 2)).toHaveLength(1)
    expect(paginateReviews(items, 2, 2)).toHaveLength(0)
  })
})
