import { describe, expect, it } from 'vitest'

import { listNextStep } from './list-next-step'

const base = { ownerId: 'me', assigneeId: null, reviewerId: 'rev' }

describe('listNextStep', () => {
  it('says to finish and submit an experiment in progress, and whose move it is', () => {
    expect(listNextStep({ ...base, statusKey: 'in_progress' }, 'me')).toEqual({
      label: 'Finish and submit',
      yours: true,
    })
    expect(
      listNextStep({ ...base, statusKey: 'in_progress' }, 'other')?.yours,
    ).toBe(false)
  })

  it('makes a submitted experiment the reviewer’s move, and waiting for the rest', () => {
    expect(listNextStep({ ...base, statusKey: 'in_review' }, 'rev')).toEqual({
      label: 'Review it',
      yours: true,
    })
    expect(listNextStep({ ...base, statusKey: 'in_review' }, 'me')).toEqual({
      label: 'Waiting for review',
      yours: false,
    })
  })

  it('has none once an experiment is approved or archived', () => {
    expect(listNextStep({ ...base, statusKey: 'approved' }, 'me')).toBeNull()
    expect(
      listNextStep({ ...base, statusKey: 'in_progress', archived: true }, 'me'),
    ).toBeNull()
  })
})
