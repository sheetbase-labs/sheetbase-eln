import { describe, expect, it } from 'vitest'

import { buildPreSignReview, preSignFacts } from './pre-sign-review'
import { diffRevisionEnvelopes } from './revision-diff'
import {
  changedRevisionFixture,
  revisionFixture,
} from './revision-diff.test-fixtures'

describe('buildPreSignReview', () => {
  it('counts what changed by area when there is an earlier version', () => {
    const before = revisionFixture()
    const after = changedRevisionFixture()
    const diff = diffRevisionEnvelopes(before, after)
    const review = buildPreSignReview(after, diff)
    expect(review.compared).toBe(true)
    expect(review.changes.length).toBeGreaterThan(0)
    expect(preSignFacts(review, diff)).toContain('Changes since')
  })

  it('describes the contents of a first version', () => {
    const review = buildPreSignReview(revisionFixture(), null)
    expect(review.compared).toBe(false)
    expect(review.changes).toContainEqual({ area: 'blocks', count: 4 })
    expect(review.changes).toContainEqual({ area: 'files', count: 1 })
  })

  it('flags a numeric table column that has no unit', () => {
    const envelope = revisionFixture()
    delete (
      envelope.scientificTables[0].columns as Array<Record<string, unknown>>
    )[1].unit
    const review = buildPreSignReview(envelope, null)
    expect(review.warnings).toMatchObject([
      { kind: 'missing-unit', where: 'Timepoints', field: 'Titer', count: 2 },
    ])
  })

  it('flags empty required cells and out-of-range values in a sheet', () => {
    const envelope = revisionFixture()
    envelope.sheetEvidence = [
      {
        blockId: 'b1',
        instanceId: 'i1',
        instanceRevision: 1,
        sourceDefinitionVersionId: null,
        datasetBindings: [],
        instanceState: {
          localFields: [
            {
              fieldId: 'f-ph',
              label: 'pH',
              logicalType: 'decimal',
              nullable: false,
              quantity: { storageUnit: 'pH' },
              validation: { min: 6.8, max: 7.4 },
              computation: { mode: 'stored' },
              lifecycle: 'active',
            },
          ],
          localValues: { r1: { 'f-ph': 8.1 }, r2: { 'f-ph': 7.0 }, r3: {} },
        },
      },
    ]
    const review = buildPreSignReview(envelope, null)
    expect(review.warnings.map((w) => w.kind)).toEqual([
      'out-of-spec',
      'empty-required',
    ])
    expect(review.warnings[0]).toMatchObject({ count: 1, limit: '6.8–7.4 pH' })
  })

  it('reports nothing for a tidy revision', () => {
    expect(buildPreSignReview(revisionFixture(), null).warnings).toEqual([])
  })
})
