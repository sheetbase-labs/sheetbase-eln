import { describe, expect, it } from 'vitest'

import { detectPlateGrid } from '#/lib/import/plate-grid'
import type { ImportSheetPreview } from '#/lib/import/types'

function sheet(
  headers: string[],
  sampleRows: Array<Record<string, string>>,
  rowCount: number,
): ImportSheetPreview {
  return {
    name: 'Results',
    headers,
    sampleRows,
    rowCount,
    sheetNames: ['Results'],
  }
}

function grid(rows: number, columns: number): ImportSheetPreview {
  const headers = [
    '',
    ...Array.from({ length: columns }, (_, i) => String(i + 1)),
  ]

  const sampleRows = Array.from({ length: Math.min(rows, 5) }, (_, r) => ({
    '': 'ABCDEFGHIJKLMNOP'[r] ?? '',
    ...Object.fromEntries(headers.slice(1).map((h) => [h, '0.1'])),
  }))

  return sheet(headers, sampleRows, rows)
}

describe('detectPlateGrid', () => {
  it('recognises a 96-well grid with row letters and column numbers', () => {
    expect(detectPlateGrid(grid(8, 12))).toEqual({
      layout: 'grid',
      wells: 96,
      rows: 8,
      columns: 12,
    })
  })

  it('recognises a 384-well grid', () => {
    expect(detectPlateGrid(grid(16, 24))?.wells).toBe(384)
  })

  it('recognises a list with one row per well', () => {
    const wells = Array.from({ length: 5 }, (_, i) => ({
      Well: `A${i + 1}`,
      OD: '0.2',
    }))

    expect(detectPlateGrid(sheet(['Well', 'OD'], wells, 96))).toMatchObject({
      layout: 'list',
      wells: 96,
    })
  })

  it('leaves an ordinary table alone', () => {
    expect(
      detectPlateGrid(
        sheet(['Sample', 'Titre'], [{ Sample: 'S1', Titre: '3.2' }], 24),
      ),
    ).toBeNull()
  })

  it('does not take numbered columns without row letters for a plate', () => {
    const odd = sheet(
      ['Time', '1', '2', '3'],
      [{ Time: '0', '1': '1', '2': '2', '3': '3' }],
      8,
    )

    expect(detectPlateGrid(odd)).toBeNull()
  })

  it('does not take a list whose row count is not a plate size', () => {
    const wells = [{ Well: 'A1' }, { Well: 'A2' }]

    expect(detectPlateGrid(sheet(['Well'], wells, 10))).toBeNull()
  })
})
