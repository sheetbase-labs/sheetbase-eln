import { describe, expect, it } from 'vitest'

import {
  PREVIEW_MAX_CELL_CHARS,
  PREVIEW_MAX_COLUMNS,
  PREVIEW_MAX_ROWS,
  buildResultPreview,
  readResultPreview,
} from './result-preview'

describe('buildResultPreview', () => {
  it.each([
    { value: 1, expected: 1 },
    { value: { polluted: true }, expected: '{"polluted":true}' },
  ])(
    'retains an own __proto__ column with $expected',
    ({ value, expected }) => {
      const row = { sample: 'a', ['__proto__']: value }
      const preview = buildResultPreview([row])

      expect(preview.columns).toEqual(['sample', '__proto__'])
      expect(preview.rows).toEqual([['a', expected]])
      expect(readResultPreview({ resultPreview: preview })).toEqual(preview)
      expect(Object.hasOwn(row, '__proto__')).toBe(true)
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
      expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
    },
  )

  it('keeps text, JSON, booleans and absent or nonfinite values distinct', () => {
    expect(
      buildResultPreview([
        {
          text: '1',
          json: { values: [1, null] },
          ok: false,
          absent: undefined,
          n: NaN,
        },
        { text: '2', json: [true, 'x'], ok: true, n: Infinity },
      ]).rows,
    ).toEqual([
      ['1', '{"values":[1,null]}', false, null, null],
      ['2', '[true,"x"]', true, null, null],
    ])
  })

  it('does not serialize cells outside the bounded rows and columns', () => {
    const row = Object.fromEntries(
      Array.from({ length: PREVIEW_MAX_COLUMNS }, (_, i) => [`c${i}`, i]),
    )

    const rows = Array.from({ length: PREVIEW_MAX_ROWS }, () => ({
      ...row,
      hidden: 1n,
    }))

    const preview = buildResultPreview([...rows, { hidden: 1n }])

    expect(preview.columns).toHaveLength(PREVIEW_MAX_COLUMNS)
    expect(preview.rows).toHaveLength(PREVIEW_MAX_ROWS)
    expect(preview.rowCount).toBe(PREVIEW_MAX_ROWS + 1)
    expect(preview.truncated).toBe(true)
  })

  it('keeps columns in order and turns values into plain cells', () => {
    const preview = buildResultPreview([
      {
        sample: 'A',
        od: 0.4,
        when: new Date('2026-01-02T03:04:05Z'),
        ok: true,
      },
      { sample: 'B', od: null, when: null, ok: false },
    ])

    expect(preview.columns).toEqual(['sample', 'od', 'when', 'ok'])
    expect(preview.rows).toEqual([
      ['A', 0.4, '2026-01-02T03:04:05.000Z', true],
      ['B', null, null, false],
    ])
    expect(preview).toMatchObject({ rowCount: 2, truncated: false })
  })

  it('bounds rows and long cells and says it did', () => {
    const rows = Array.from({ length: PREVIEW_MAX_ROWS + 5 }, (_, i) => ({
      n: i,
      text: 'x'.repeat(PREVIEW_MAX_CELL_CHARS + 10),
    }))

    const preview = buildResultPreview(rows)
    expect(preview.rows).toHaveLength(PREVIEW_MAX_ROWS)
    expect(preview.rowCount).toBe(PREVIEW_MAX_ROWS + 5)
    expect(preview.truncated).toBe(true)
    expect(String(preview.rows[0][1])).toHaveLength(PREVIEW_MAX_CELL_CHARS + 1)
  })

  it('previews an empty result as no columns and no rows', () => {
    expect(buildResultPreview([])).toEqual({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
    })
  })
})

describe('readResultPreview', () => {
  it('decodes stored cells without normalising, bounding or coercing them', () => {
    const rows = [
      [
        null,
        false,
        1.25,
        '1.25',
        'x'.repeat(PREVIEW_MAX_CELL_CHARS + 20),
        NaN,
        Infinity,
      ],
    ]

    expect(
      readResultPreview({
        resultPreview: {
          columns: ['a'],
          rows,
          rowCount: -2.5,
          truncated: 'true',
        },
      }),
    ).toEqual({ columns: ['a'], rows, rowCount: -2.5, truncated: false })
    expect(
      readResultPreview({
        resultPreview: {
          columns: [],
          rows: [[], []],
          rowCount: '2',
        },
      }),
    ).toEqual({ columns: [], rows: [[], []], rowCount: 2, truncated: false })
  })

  it('rejects cells outside the stored preview contract', () => {
    expect(
      readResultPreview({
        resultPreview: {
          columns: ['a'],
          rows: [[{ nested: true }]],
        },
      }),
    ).toBeNull()
  })

  it('round-trips a stored preview', () => {
    const preview = buildResultPreview([{ a: 1 }])
    expect(readResultPreview({ resultPreview: preview })).toEqual(preview)
  })

  it('returns null for runs that predate the preview or carry something else', () => {
    expect(readResultPreview({})).toBeNull()
    expect(readResultPreview({ resultPreview: 'nope' })).toBeNull()
    expect(
      readResultPreview({ resultPreview: { columns: [1], rows: [] } }),
    ).toBeNull()
  })
})
