import { describe, expect, it } from 'vitest'

import {
  sheetCommentAnchor,
  sheetCommentAnchorSchema,
  sheetCommentCells,
} from './sheet-comment-anchor'

const instance = '10000000-0000-4000-8000-000000000001'
const rows = [2, 3, 4].map((id) => ({
  id: `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
}))
const fields = [5, 6].map((id) => ({
  id: `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
}))

describe('canonical Sheet comment identities', () => {
  it('keeps a cell on its original row/field after reorder, filter and insertion', () => {
    const anchor = sheetCommentAnchor(
      instance,
      'sheet_cell',
      [rows[1].id],
      [fields[1].id],
    )
    expect(sheetCommentCells(anchor, instance, rows, fields)).toEqual([
      { row: 1, column: 1 },
    ])
    expect(
      sheetCommentCells(
        anchor,
        instance,
        [rows[2], rows[1], rows[0]],
        [...fields].reverse(),
      ),
    ).toEqual([{ row: 1, column: 0 }])
    expect(
      sheetCommentCells(anchor, instance, [rows[2], rows[0]], fields),
    ).toEqual([])
    expect(
      sheetCommentCells(anchor, instance, [rows[2], rows[0], rows[1]], fields),
    ).toEqual([{ row: 2, column: 1 }])
    expect(sheetCommentCells(anchor, instance, rows, [fields[0]])).toEqual([])
    expect(sheetCommentCells(anchor, rows[0].id, rows, fields)).toEqual([])
    expect(anchor.target).toEqual({
      instanceId: instance,
      rowKeys: [rows[1].id],
      fieldIds: [fields[1].id],
    })
  })

  it('keeps explicit noncontiguous range membership, not bounding coordinates', () => {
    const anchor = sheetCommentAnchor(
      instance,
      'sheet_range',
      [rows[2].id, rows[0].id],
      [fields[1].id],
    )
    expect(sheetCommentCells(anchor, instance, rows, fields)).toEqual([
      { row: 0, column: 1 },
      { row: 2, column: 1 },
    ])
    expect(
      sheetCommentAnchor(
        instance,
        'sheet_range',
        [rows[0].id, rows[2].id],
        [fields[1].id],
      ),
    ).toEqual(anchor)
    expect(
      sheetCommentCells(
        sheetCommentAnchor(instance, 'sheet_row', [rows[1].id], []),
        instance,
        rows,
        fields,
      ),
    ).toEqual([
      { row: 1, column: 0 },
      { row: 1, column: 1 },
    ])
  })

  it('accepts canonical composed identities and rejects coordinates, duplicate and malformed targets', () => {
    expect(
      sheetCommentAnchor(
        instance,
        'sheet_cell',
        [`sb-row-v1:${'a'.repeat(64)}`],
        [fields[0].id],
      ).target.rowKeys,
    ).toHaveLength(1)
    expect(() =>
      sheetCommentAnchor(instance, 'sheet_cell', ['A2'], [fields[0].id]),
    ).toThrow()
    expect(() =>
      sheetCommentAnchor(
        instance,
        'sheet_cell',
        [rows[0].id, rows[1].id],
        [fields[0].id],
      ),
    ).toThrow()
    expect(() =>
      sheetCommentAnchor(
        instance,
        'sheet_range',
        [rows[0].id, rows[0].id],
        [fields[0].id],
      ),
    ).toThrow()
    expect(() =>
      sheetCommentAnchor(instance, 'sheet_row', [rows[0].id], [fields[0].id]),
    ).toThrow()
    const anchor = sheetCommentAnchor(
      instance,
      'sheet_cell',
      [rows[0].id],
      [fields[0].id],
    )
    expect(
      sheetCommentAnchorSchema.safeParse({
        ...anchor,
        target: { ...anchor.target, row: 0, column: 0 },
      }).success,
    ).toBe(false)
  })
})
