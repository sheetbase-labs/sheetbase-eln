import { describe, expect, it } from 'vitest'

import { diffMatches, diffResultRows } from './reproduce-diff'

describe('diffResultRows', () => {
  it('matches identical rows in any order', () => {
    const diff = diffResultRows(
      [
        { id: 'a', v: 1.5 },
        { id: 'b', v: 2 },
      ],
      [
        { id: 'b', v: 2 },
        { id: 'a', v: 1.5 },
      ],
    )
    expect(diffMatches(diff)).toBe(true)
    expect(diff.matchedRows).toBe(2)
  })

  it('forgives noise below the tolerance and reports above it', () => {
    const near = diffResultRows(
      [{ id: 'a', v: 1 }],
      [{ id: 'a', v: 1 + 1e-12 }],
    )
    expect(diffMatches(near)).toBe(true)
    const far = diffResultRows([{ id: 'a', v: 1 }], [{ id: 'a', v: 1.01 }])
    expect(diffMatches(far)).toBe(false)
    expect(far.changedRows).toBe(1)
    expect(far.changedColumns).toEqual({ v: 1 })
    expect(far.largestDelta.v).toBeCloseTo(0.01)
    expect(far.examples[0]).toMatchObject({
      kind: 'changed',
      cells: [{ column: 'v', before: 1, after: 1.01 }],
    })
  })

  it('shows a drifted value as one changed row, not a removal and an addition', () => {
    const diff = diffResultRows(
      [
        { id: 'a', group: 'x', v: 1 },
        { id: 'b', group: 'x', v: 2 },
      ],
      [
        { id: 'a', group: 'x', v: 1 },
        { id: 'b', group: 'x', v: 3 },
      ],
    )
    expect(diff).toMatchObject({
      matchedRows: 1,
      changedRows: 1,
      addedRows: 0,
      removedRows: 0,
    })
  })

  it('counts rows added and removed', () => {
    const diff = diffResultRows(
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'a' }, { id: 'c' }, { id: 'd' }],
    )
    expect(diff.matchedRows).toBe(1)
    expect(diff.removedRows).toBe(1)
    expect(diff.addedRows).toBe(2)
  })

  it('reports columns that exist on one side only', () => {
    const diff = diffResultRows([{ id: 'a', old: 1 }], [{ id: 'a', fresh: 1 }])
    expect(diff.columnsRemoved).toEqual(['old'])
    expect(diff.columnsAdded).toEqual(['fresh'])
    expect(diffMatches(diff)).toBe(false)
  })

  it('treats dates and nulls as values', () => {
    const d = new Date('2026-01-02T03:04:05Z')
    expect(
      diffMatches(
        diffResultRows(
          [{ at: d, n: null }],
          [{ at: d.toISOString(), n: null }],
        ),
      ),
    ).toBe(true)
  })

  it('keeps only the first examples of a large difference', () => {
    const before = Array.from({ length: 300 }, (_, i) => ({
      id: `r${i}`,
      v: i,
    }))
    const after = before.map((row) => ({ ...row, v: row.v + 5 }))
    const diff = diffResultRows(before, after)
    expect(diff.changedRows).toBe(300)
    expect(diff.examples).toHaveLength(200)
    expect(diff.truncated).toBe(true)
  })
})
