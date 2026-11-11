import { describe, expect, it } from 'vitest'

import {
  datasetCellKey,
  placeSheetCellChanges,
  valuesBeforeToday,
} from './sheet-cell-history'
import type { SheetCellChange } from './sheet-cell-history'

const NOW = new Date('2026-09-25T15:00:00')

function change(over: Partial<SheetCellChange>): SheetCellChange {
  return {
    at: new Date('2026-09-25T09:41:00').toISOString(),
    actorUserId: 'gareth',
    source: 'sheet',
    rowKey: 'row-9',
    fieldId: 'load',
    datasetId: null,
    datasetRowId: null,
    before: 150,
    after: 146,
    beforeKnown: true,
    reason: null,
    ...over,
  }
}

const sheet = {
  columnIds: new Set(['load', 'turbidity']),
  rowKeys: new Set(['row-8', 'row-9']),
  datasetCells: new Map([
    [
      datasetCellKey('ds-311', 'ds-row-8', 'turbidity-field'),
      { rowKey: 'row-8', columnId: 'turbidity' },
    ],
  ]),
}

describe('placeSheetCellChanges', () => {
  it('puts sheet changes on their own cell and dataset changes on the cell that shows them', () => {
    const placed = placeSheetCellChanges(
      [
        change({}),
        change({
          source: 'dataset',
          rowKey: null,
          datasetId: 'ds-311',
          datasetRowId: 'ds-row-8',
          fieldId: 'turbidity-field',
        }),
      ],
      sheet,
    )

    expect(placed.map((item) => item.cell)).toEqual([
      { rowKey: 'row-9', columnId: 'load' },
      { rowKey: 'row-8', columnId: 'turbidity' },
    ])
  })

  it('leaves out changes to rows and columns the sheet does not show', () => {
    expect(
      placeSheetCellChanges(
        [
          change({ rowKey: 'row-gone' }),
          change({ fieldId: 'retired' }),
          change({
            source: 'dataset',
            rowKey: null,
            datasetId: 'ds-311',
            datasetRowId: 'not-composed',
            fieldId: 'turbidity-field',
          }),
        ],
        sheet,
      ),
    ).toEqual([])
  })
})

describe('valuesBeforeToday', () => {
  it('keeps what a cell held before its first change today', () => {
    const placed = placeSheetCellChanges(
      [
        change({
          at: new Date('2026-09-25T11:00:00').toISOString(),
          before: 146,
          after: 148,
        }),
        change({}),
        change({
          at: new Date('2026-09-24T10:00:00').toISOString(),
          before: 140,
          after: 150,
        }),
      ],
      sheet,
    )

    expect(valuesBeforeToday(placed, NOW)).toEqual(
      new Map([['row-9|load', 150]]),
    )
  })

  it('shows no old value when it is not known', () => {
    const placed = placeSheetCellChanges(
      [change({ before: null, beforeKnown: false })],
      sheet,
    )

    expect(valuesBeforeToday(placed, NOW).size).toBe(0)
  })
})
