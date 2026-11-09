import { describe, expect, it } from 'vitest'

import { experimentNextStep } from './next-step'
import type { NextStepInput } from './next-step'

const base: NextStepInput = {
  status: 'in_progress',
  locked: false,
  archived: false,
  canWrite: true,
  regulated: true,
  isReviewer: false,
}

const step = (over: Partial<NextStepInput>) =>
  experimentNextStep({ ...base, ...over })

describe('experimentNextStep', () => {
  it('starts a draft or planned experiment', () => {
    expect(step({ status: 'draft' }).primary).toBe('start')
    expect(step({ status: 'planned' }).primary).toBe('start')
  })

  it('submits a running experiment in a regulated lab', () => {
    expect(step({}).primary).toBe('submit')
    expect(step({}).secondary).toEqual([])
  })

  it('finishes first in a lab that is not regulated, with Submit beside it', () => {
    const next = step({ regulated: false })
    expect(next.primary).toBe('finish')
    expect(next.secondary).toEqual(['submit'])
  })

  it('resubmits a returned experiment and resumes one on hold', () => {
    expect(step({ status: 'returned' }).primary).toBe('submit')
    expect(step({ status: 'on_hold' }).primary).toBe('resume')
  })

  it('has no primary button for the author while the review runs', () => {
    const next = step({ status: 'in_review', locked: true })
    expect(next.primary).toBeNull()
    expect(next.role).toBe('author')
  })

  it('puts Approve and Request changes in the header of the reviewer', () => {
    const next = step({ status: 'in_review', isReviewer: true })
    expect(next.role).toBe('reviewer')
    expect(next.primary).toBe('approve')
    expect(next.reviewing).toBe(true)
    expect(next.authoring).toBe(false)
  })

  it('offers Sign on a locked, approved record', () => {
    expect(step({ status: 'approved', locked: true }).primary).toBe('sign')
    expect(step({ status: 'approved' }).primary).toBeNull()
  })

  it('gives a reader or an archived record no next step', () => {
    expect(step({ canWrite: false }).primary).toBeNull()
    expect(step({ archived: true, status: 'draft' }).primary).toBeNull()
    expect(
      step({ canWrite: false, status: 'in_review', isReviewer: true })
        .reviewing,
    ).toBe(false)
  })

  it('lets a finished experiment be reopened without making it primary', () => {
    const next = step({ status: 'completed' })
    expect(next.primary).toBeNull()
    expect(next.secondary).toEqual(['reopen'])
  })
})
