import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { buildPreSignReview, preSignFacts } from './pre-sign-review'
import { diffRevisionEnvelopes } from './revision-diff'
import {
  changedRevisionFixture,
  revisionFixture,
} from './revision-diff.test-fixtures'

/** The stored columns of one scientific table, as the revision envelope carries them. */
const storedTableColumns = z.array(
  z.looseObject({ unit: z.string().optional() }),
)

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
    const table = envelope.scientificTables[0]
    const columns = storedTableColumns.parse(table.columns)

    envelope.scientificTables[0] = {
      ...table,
      // The second column is stored with no unit at all.
      columns: columns.map((column, index) =>
        index === 0 ? column : { ...column, unit: undefined },
      ),
    }
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

  it('copes with an older envelope that has no collections', () => {
    // SAFETY: an envelope stored before these collections existed carries none of them, which is exactly the older shape this case feeds the review.
    const old = { formatVersion: 0, record: {} } as never
    expect(buildPreSignReview(old, null)).toEqual({
      changes: [],
      warnings: [],
      compared: false,
    })
  })

  it('reports nothing for a tidy revision', () => {
    expect(buildPreSignReview(revisionFixture(), null).warnings).toEqual([])
  })
})
