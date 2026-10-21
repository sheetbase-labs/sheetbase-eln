import { describe, expect, it } from 'vitest'

import {
  PREVIEW_MAX_CELL_CHARS,
  PREVIEW_MAX_ROWS,
  buildResultPreview,
  readResultPreview,
} from './result-preview'

describe('buildResultPreview', () => {
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
