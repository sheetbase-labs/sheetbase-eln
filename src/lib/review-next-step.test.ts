import { describe, expect, it } from 'vitest'

import { nextReviewItem, reviewNextStep } from './review-next-step'
import type { ReviewNextStepInput } from './review-next-step'
import type { WorkItem, WorkItemKind } from './work-items/data'

function input(overrides: Partial<ReviewNextStepInput>): ReviewNextStepInput {
  return {
    state: 'submitted',
    superseded: false,
    locked: false,
    isSubmitter: false,
    isAssignedReviewer: false,
    hasSigned: false,
    reviewerNames: ['Rosalind Franklin'],
    submitterName: 'Ada Lovelace',
    ...overrides,
  }
}

describe('reviewNextStep', () => {
  it('tells the assigned reviewer the decision is theirs', () => {
    const step = reviewNextStep(input({ isAssignedReviewer: true }))
    expect(step.headline).toBe('Waiting for your decision')
    expect(step.detail).toMatch(/Approve to go on to signing/)
  })

  it('tells the author who they are waiting on and how to change their mind', () => {
    const step = reviewNextStep(input({ isSubmitter: true }))
    expect(step.headline).toBe('Waiting for Rosalind Franklin')
    expect(step.detail).toMatch(/withdraw it from the notebook menu/)
  })

  it('names several reviewers in one sentence', () => {
    const step = reviewNextStep(
      input({ isSubmitter: true, reviewerNames: ['A', 'B', 'C'] }),
    )
    expect(step.headline).toBe('Waiting for A, B and C')
  })

  it('sends a returned review back to the author, and tells everyone else who is acting', () => {
    expect(
      reviewNextStep(input({ state: 'returned', isSubmitter: true })).detail,
    ).toMatch(/Open the notebook/)
    expect(
      reviewNextStep(input({ state: 'returned', isAssignedReviewer: true }))
        .detail,
    ).toMatch(/Ada Lovelace edits the notebook/)
  })

  it('states that a rejection is final and a withdrawal needs nothing', () => {
    expect(reviewNextStep(input({ state: 'rejected' })).detail).toMatch(
      /can’t be reopened/,
    )
    expect(reviewNextStep(input({ state: 'withdrawn' })).detail).toMatch(
      /Nothing is waiting on you/,
    )
  })

  it('asks the approving reviewer to sign, and offers Sign later', () => {
    const step = reviewNextStep(
      input({ state: 'approved', isAssignedReviewer: true }),
    )
    expect(step.headline).toBe('Approved, waiting for your signature')
    expect(step.detail).toMatch(/Sign later/)
  })

  it('says the record locks when the signatures are in, once the reader has signed', () => {
    const step = reviewNextStep(
      input({ state: 'approved', isAssignedReviewer: true, hasSigned: true }),
    )
    expect(step.headline).toBe('Approved, waiting for signatures')
  })

  it('states a locked record is frozen and a superseded revision is history', () => {
    expect(
      reviewNextStep(input({ state: 'approved', locked: true })).headline,
    ).toBe('Signed and locked')
    expect(reviewNextStep(input({ superseded: true })).headline).toBe(
      'Replaced by a newer revision',
    )
  })

  it('does not invent a state for a revision that was never submitted', () => {
    expect(reviewNextStep(input({ state: null })).headline).toBe(
      'Not submitted for review',
    )
  })
})

function item(kind: WorkItemKind, revisionId?: string | null): WorkItem {
  return {
    kind,
    recordId: 'r',
    identifier: 'EXP-1',
    title: 'T',
    projectId: null,
    reason: '',
    dueAt: null,
    state: 'needs_action',
    createdAt: null,
    revisionId,
  }
}

describe('nextReviewItem', () => {
  it('skips the review on screen and anything that is not a review', () => {
    const next = nextReviewItem(
      [
        item('data_issue', 'x'),
        item('review_requested', 'current'),
        item('approval_unsigned', 'rev-2'),
        item('review_requested', 'rev-3'),
      ],
      'current',
    )
    expect(next?.revisionId).toBe('rev-2')
  })

  it('has nothing to offer when this was the last one', () => {
    expect(
      nextReviewItem([item('review_requested', 'current')], 'current'),
    ).toBeNull()
    expect(
      nextReviewItem([item('review_requested', null)], 'current'),
    ).toBeNull()
  })
})
