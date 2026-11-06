import { describe, expect, it } from 'vitest'

import {
  homeBriefFacts,
  homeBriefHasFacts,
  linkBrief,
  parseBrief,
} from './home-brief'
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

describe('linkBrief', () => {
  const input: HomeBriefInput = {
    ...empty,
    reviews: [{ identifier: 'EXP-0131', title: 'Titer', projectTitle: null }],
    materials: [{ identifier: 'MAT-0355', reason: 'lot expired' }],
    datasetIssues: [{ identifier: 'DS-0311', label: 'failed' }],
    projects: [
      {
        id: 'p-1',
        title: 'HEK293 cell bank',
        stage: null,
        total: 3,
        approved: 0,
        inReview: 3,
      },
    ],
  }

  it('links the records Home supplied and leaves invented ones plain', () => {
    const parts = linkBrief(
      'MAT-0355 expired; EXP-0131 and EXP-9999 wait.',
      input,
    )
    expect(parts).toEqual([
      {
        kind: 'object',
        objectKind: 'material',
        ref: 'MAT-0355',
        text: 'MAT-0355',
      },
      { kind: 'text', text: ' expired; ' },
      {
        kind: 'object',
        objectKind: 'experiment',
        ref: 'EXP-0131',
        text: 'EXP-0131',
      },
      { kind: 'text', text: ' and EXP-9999 wait.' },
    ])
  })

  it('links a project name and its experiment count', () => {
    const parts = linkBrief(
      'HEK293 cell bank: review the 3 experiments in review.',
      input,
    )
    expect(parts.filter((part) => part.kind !== 'text')).toEqual([
      {
        kind: 'object',
        objectKind: 'project',
        ref: 'p-1',
        text: 'HEK293 cell bank',
      },
      { kind: 'route', to: '/projects/p-1/experiments', text: '3 experiments' },
    ])
  })

  it('does not link counts outside a project bullet', () => {
    expect(linkBrief('You have 2 experiments.', input)).toEqual([
      { kind: 'text', text: 'You have 2 experiments.' },
    ])
  })
})
