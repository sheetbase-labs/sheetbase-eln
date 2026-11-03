import { describe, expect, it } from 'vitest'

import { homeBriefFacts, homeBriefHasFacts, parseBrief } from './home-brief'
import type { HomeBriefInput } from './home-brief'

const empty: HomeBriefInput = {
  reviews: [],
  materials: [],
  datasetIssues: [],
  todayBookings: 0,
  projects: [],
}

describe('home brief facts', () => {
  it('says nothing is waiting when nothing is', () => {
    expect(homeBriefHasFacts(empty)).toBe(false)
    expect(homeBriefFacts(empty)).toBe('Needs the person:\n- nothing')
  })
  it('lists what needs the person and each project with its counts', () => {
    const input: HomeBriefInput = {
      ...empty,
      reviews: [{ identifier: 'EXP-7', title: 'Titer', projectTitle: 'Alpha' }],
      materials: [{ identifier: 'MAT-2', reason: 'expires in 3 days' }],
      projects: [
        {
          id: 'p',
          title: 'Alpha',
          stage: 'Execution',
          total: 5,
          approved: 2,
          inReview: 1,
        },
      ],
    }
    const facts = homeBriefFacts(input)
    expect(facts).toContain('EXP-7 Titer (Alpha)')
    expect(facts).toContain('MAT-2: expires in 3 days')
    expect(facts).toContain(
      'Alpha (stage: Execution): 5 experiments, 2 approved, 1 in review, 2 not yet submitted',
    )
  })
})

describe('parseBrief', () => {
  it('separates bullets from paragraphs', () => {
    expect(
      parseBrief(
        'Needs you: one review.\n- Alpha: submit EXP-9\n\n* Beta: wait',
      ),
    ).toEqual([
      { kind: 'paragraph', text: 'Needs you: one review.' },
      { kind: 'bullet', text: 'Alpha: submit EXP-9' },
      { kind: 'bullet', text: 'Beta: wait' },
    ])
  })
})
