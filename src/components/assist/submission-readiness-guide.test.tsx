/**
 * SubmissionReadinessGuide entry-point tests (ASSIST-03). The dialog mount
 * mirrors the NOTE-04 checklist state and routes accepts to the dialog's
 * own canonical mutations: snapshot check and guarded submit run the same
 * paths as the dialog buttons, and review accepts navigate to the review
 * workspace.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SubmissionReadinessGuide } from './submission-readiness-guide'

afterEach(cleanup)

function baseProps(overrides = {}) {
  return {
    recordId: 'r1',
    hasUnsavedWork: true,
    archivedAt: null,
    lockedAt: null,
    activeReview: false,
    reviewerCount: 1,
    digest: null,
    digestPending: false,
    digestError: null,
    ...overrides,
  }
}

describe('SubmissionReadinessGuide', () => {
  it('starts on drafts-saved mirroring the dialog checklist', () => {
    render(<SubmissionReadinessGuide {...baseProps()} />)
    expect(screen.getByLabelText('Guide: Submission readiness')).toBeTruthy()
    expect(
      screen.getByLabelText(/Step 1: Drafts saved \(Current\)/),
    ).toBeTruthy()
    expect(screen.getByText(/unsaved drafts/)).toBeTruthy()
  })

  it('routes the snapshot accept to the dialog check', () => {
    const onCheckSnapshot = vi.fn()
    render(
      <SubmissionReadinessGuide
        {...baseProps({ hasUnsavedWork: false })}
        onCheckSnapshot={onCheckSnapshot}
      />,
    )
    expect(
      screen.getByLabelText(/Step 2: Snapshot verified \(Current\)/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Run snapshot check' }))
    expect(onCheckSnapshot).toHaveBeenCalledTimes(1)
  })

  it('routes the submit accept to the guarded dialog submit', () => {
    const onSubmitRevision = vi.fn()
    render(
      <SubmissionReadinessGuide
        {...baseProps({
          hasUnsavedWork: false,
          digest: 'abc123',
          reviewerCount: 2,
        })}
        onSubmitRevision={onSubmitRevision}
      />,
    )
    expect(screen.getByLabelText(/Step 4: Submitted \(Current\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Submit revision' }))
    expect(onSubmitRevision).toHaveBeenCalledTimes(1)
  })

  it('keeps the review step blocked on submit in the pre-submit dialog', () => {
    render(
      <SubmissionReadinessGuide
        {...baseProps({
          hasUnsavedWork: false,
          digest: 'abc123',
          reviewerCount: 2,
        })}
      />,
    )
    expect(
      screen.getByLabelText(/Step 5: Review decided \(Blocked\)/),
    ).toBeTruthy()
    expect(
      screen.getAllByText(/Waiting on 'Submitted'/).length,
    ).toBeGreaterThan(0)
  })
})
