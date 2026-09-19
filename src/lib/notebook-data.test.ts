import { describe, expect, it } from 'vitest'

import { statusDomainForKind, statusKeyForBadge } from './notebook-data'

describe('statusDomainForKind', () => {
  it('maps record kinds to their status vocabulary domain', () => {
    expect(statusDomainForKind('sample')).toBe('sample')
    expect(statusDomainForKind('reagent')).toBe('reagent')
    expect(statusDomainForKind('protocol_template')).toBe('protocol')
    expect(statusDomainForKind('notebook_template')).toBe('notebook_template')
  })

  it('uses the experiment domain for other kinds', () => {
    expect(statusDomainForKind('experiment')).toBe('experiment')
    expect(statusDomainForKind('report')).toBe('experiment')
    expect(statusDomainForKind('file')).toBe('experiment')
  })
})

describe('statusKeyForBadge', () => {
  it('maps stored in_review spellings onto the domain review key', () => {
    // Reports and experiments store "in review" as `in_review`; the
    // experiment vocabulary calls it `review`.
    expect(statusKeyForBadge('report', 'in_review')).toBe('review')
    expect(statusKeyForBadge('experiment', 'in_review')).toBe('review')
    expect(statusKeyForBadge('report', 'under_review')).toBe('review')
  })

  it('maps protocol review statuses onto under_review', () => {
    expect(statusKeyForBadge('protocol_template', 'in_review')).toBe(
      'under_review',
    )
    expect(statusKeyForBadge('protocol_template', 'under_review')).toBe(
      'under_review',
    )
  })

  it('passes through statuses that already match the vocabulary', () => {
    expect(statusKeyForBadge('experiment', 'in-progress')).toBe('in-progress')
    expect(statusKeyForBadge('sample', 'available')).toBe('available')
    expect(statusKeyForBadge('report', 'draft')).toBe('draft')
  })
})
