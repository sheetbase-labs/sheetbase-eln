import { describe, expect, it } from 'vitest'

import {
  cellsAgree,
  diffMatches,
  diffResultRows,
  normaliseCell,
} from './reproduce-diff'

describe('normaliseCell', () => {
  it('preserves the scientific cell representations without coercing text', () => {
    expect(
      [
        null,
        undefined,
        1.25,
        NaN,
        Infinity,
        -Infinity,
        true,
        false,
        42n,
        new Date('2026-01-02T03:04:05Z'),
        '42',
        { measurements: [1, null, false], missing: undefined },
      ].map((value) => normaliseCell(value)),
    ).toEqual([
      null,
      null,
      1.25,
      null,
      null,
      null,
      true,
      false,
      42,
      '2026-01-02T03:04:05.000Z',
      '42',
      '{"measurements":[1,null,false]}',
    ])
    expect(normaliseCell(10n ** 400n)).toBe(Infinity)
  })
})

describe('cellsAgree', () => {
  it('uses the larger magnitude with a unit floor, without coercing strings', () => {
    expect(cellsAgree(0, 1e-9, 1e-9)).toBe(true)
    expect(cellsAgree(0, 2e-9, 1e-9)).toBe(false)
    expect(cellsAgree(-1e6, -1e6 - 0.0005, 1e-9)).toBe(true)
    expect(cellsAgree(-1e6, -1e6 - 0.002, 1e-9)).toBe(false)
    expect(cellsAgree('1', 1, 1e-9)).toBe(false)
    expect(cellsAgree(1, 1 + Number.EPSILON, 0)).toBe(false)
    expect(cellsAgree(Infinity, Infinity, 0)).toBe(true)
  })
})

describe('diffResultRows', () => {
  it.each([
    { before: 1, after: 2, expected: 1 },
    {
      before: { polluted: true },
      after: { polluted: false },
      expected: '{"polluted":true}',
    },
  ])(
    'retains and compares an own __proto__ cell $expected',
    ({ before, after, expected }) => {
      const original = { id: 'a', ['__proto__']: before }
      const reproduced = { id: 'a', ['__proto__']: after }
      const diff = diffResultRows([original], [reproduced])

      expect(diffMatches(diffResultRows([original], [original]))).toBe(true)
      expect(diff.changedRows).toBe(1)
      expect(diff.changedColumns).toEqual({ ['__proto__']: 1 })
      expect(diff.examples[0]).toMatchObject({
        kind: 'changed',
        row: { id: 'a', ['__proto__']: expected },
        cells: [{ column: '__proto__', before: expected }],
      })

      for (const example of diff.examples) {
        expect(Object.hasOwn(example.row, '__proto__')).toBe(true)
        expect(Object.getPrototypeOf(example.row)).toBe(Object.prototype)
      }

      expect(Object.getPrototypeOf(diff.changedColumns)).toBe(Object.prototype)
      expect(Object.getPrototypeOf(original)).toBe(Object.prototype)
      expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
    },
  )

  it('records numeric __proto__ deltas without treating them as prototypes', () => {
    const diff = diffResultRows(
      [{ id: 'a', ['__proto__']: 1 }],
      [{ id: 'a', ['__proto__']: 3 }],
    )

    expect(diff.largestDelta).toEqual({ ['__proto__']: 2 })
    expect(Object.hasOwn(diff.largestDelta, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(diff.largestDelta)).toBe(Object.prototype)
  })

  it('normalises raw rows at the comparison boundary', () => {
    expect(
      diffMatches(
        diffResultRows(
          [
            {
              id: 'a',
              value: 42n,
              data: { values: [1, null] },
              missing: undefined,
            },
          ],
          [{ id: 'a', value: 42, data: '{"values":[1,null]}', missing: null }],
        ),
      ),
    ).toBe(true)
    expect(
      diffMatches(diffResultRows([{ value: '42' }], [{ value: 42 }])),
    ).toBe(false)
  })

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
