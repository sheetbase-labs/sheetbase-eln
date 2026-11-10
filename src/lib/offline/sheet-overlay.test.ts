import { describe, expect, it } from 'vitest'

import type { CanonicalSheetGridMatrix } from '#/lib/canonical-sheet-grid'
import { fieldEditorPresentation } from '#/lib/field-presentation'
import { overlayOfflineSheetEdits } from './sheet-overlay'
import type { OfflineEdit } from './store'

const matrix: CanonicalSheetGridMatrix = {
  columns: ['a', 'b'].map(
    (id): CanonicalSheetGridMatrix['columns'][number] => ({
      id,
      label: id,
      origin: 'local',
      field: null,
      presentation: fieldEditorPresentation('decimal'),
      editable: true,
      group: 'This experiment',
    }),
  ),
  rowKeys: ['r1', 'r2'],
  rowKinds: ['local', 'local'],
  data: [
    [1, 2],
    [3, 4],
  ],
}

const base = { id: 'e', sequence: 1, expectedRevision: 3, createdAt: 'x' }

describe('overlayOfflineSheetEdits', () => {
  it('returns the same matrix when nothing is queued for the sheet', () => {
    const other: OfflineEdit = {
      ...base,
      kind: 'cell',
      sheetInstanceId: 'other',
      rowId: 'r1',
      columnId: 'a',
      value: 9,
    }

    expect(overlayOfflineSheetEdits(matrix, 's1', [other])).toBe(matrix)
  })

  it('shows a queued cell value without touching the input', () => {
    const edit: OfflineEdit = {
      ...base,
      kind: 'cell',
      sheetInstanceId: 's1',
      rowId: 'r2',
      columnId: 'b',
      value: 99,
    }

    const next = overlayOfflineSheetEdits(matrix, 's1', [edit])
    expect(next.data[1]).toEqual([3, 99])
    expect(matrix.data[1]).toEqual([3, 4])
  })

  it('appends an added row once, and skips it when the server has it', () => {
    const row: OfflineEdit = {
      ...base,
      kind: 'row',
      sheetInstanceId: 's1',
      rowKey: 'new',
      values: { b: 'x' },
    }

    const next = overlayOfflineSheetEdits(matrix, 's1', [row])
    expect(next.rowKeys).toEqual(['r1', 'r2', 'new'])
    expect(next.data[2]).toEqual([null, 'x'])

    const synced: CanonicalSheetGridMatrix = {
      ...matrix,
      rowKeys: ['r1', 'r2', 'new'],
      rowKinds: ['local', 'local', 'local'],
      data: [...matrix.data, [null, 'x']],
    }

    expect(overlayOfflineSheetEdits(synced, 's1', [row]).rowKeys).toHaveLength(
      3,
    )
  })
})
