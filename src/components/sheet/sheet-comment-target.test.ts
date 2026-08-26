// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { SheetCommentRow } from './sheet-comment-target'
import { resolveSheetCommentTarget } from './sheet-comment-target'

const identity = (visual: number) => visual

/**
 * Simulated backing-table rows (`api.sheet_<…>`): `id` is the persisted
 * UUID primary key; every other field is editable cell content. Values are
 * deliberately irrelevant to the resolver — only `id` participates.
 */
function row(id: string, values: Record<string, unknown> = {}) {
  return { id, ...values }
}

const COLUMNS = [
  { id: 'f-1111', label: 'Titer' },
  { id: 'f-2222', label: 'pH' },
  { id: 'f-3333', label: 'Notes' },
]

describe('sheet comment target durability', () => {
  const ROW_A = '5f0a0000-0000-7000-8000-00000000000a'
  const ROW_B = '5f0b0000-0000-7000-8000-00000000000b'

  it('keeps the anchor attached when another cell in the row is edited', () => {
    const before = resolveSheetCommentTarget(
      [row(ROW_A, { titer: '10.0' })],
      COLUMNS,
      identity,
      { row: 0, column: 0 },
    )
    const after = resolveSheetCommentTarget(
      [row(ROW_A, { titer: '10.0', ph: '7.2' })], // different value edited
      COLUMNS,
      identity,
      { row: 0, column: 0 },
    )
    expect(after).toEqual(before)
  })

  it('keeps the anchor attached when the commented cell itself is edited', () => {
    const before = resolveSheetCommentTarget(
      [row(ROW_A, { titer: '10.0' })],
      COLUMNS,
      identity,
      { row: 0, column: 0 },
    )
    const after = resolveSheetCommentTarget(
      [row(ROW_A, { titer: '12.5' })], // same field's value changed
      COLUMNS,
      identity,
      { row: 0, column: 0 },
    )
    expect(after).toEqual(before)
  })

  it('keeps per-row anchors after a visual reorder', () => {
    const rowsBefore = [row(ROW_A), row(ROW_B)]
    const rowsAfter = [row(ROW_B), row(ROW_A)] // swapped positions
    const a = resolveSheetCommentTarget(rowsBefore, COLUMNS, identity, {
      row: 0,
      column: 0,
    })
    expect(a).toMatchObject({ kind: 'cell', rowKey: ROW_A })
    const aAfterReorder = resolveSheetCommentTarget(
      rowsAfter,
      COLUMNS,
      identity,
      {
        row: 1,
        column: 0,
      },
    )
    expect(aAfterReorder).toEqual(a)
  })

  it('is unaffected by a field label rename (fields addressed by uuid)', () => {
    const before = resolveSheetCommentTarget([row(ROW_A)], COLUMNS, identity, {
      row: 0,
      column: 0,
    })
    const renamed = [
      { ...COLUMNS[0], label: 'Titer (IU/mL)' },
      COLUMNS[1],
      COLUMNS[2],
    ]
    const after = resolveSheetCommentTarget([row(ROW_A)], renamed, identity, {
      row: 0,
      column: 0,
    })
    expect(after).toEqual(before)
    expect(after).toMatchObject({ kind: 'cell', fieldId: 'f-1111' })
  })

  it('gives identical-content rows distinct anchors', () => {
    const twinA = resolveSheetCommentTarget(
      [row(ROW_A, { titer: 'x' }), row(ROW_B, { titer: 'x' })],
      COLUMNS,
      identity,
      { row: 0, column: 0 },
    )
    const twinB = resolveSheetCommentTarget(
      [row(ROW_A, { titer: 'x' }), row(ROW_B, { titer: 'x' })],
      COLUMNS,
      identity,
      { row: 1, column: 0 },
    )
    expect(twinA).toMatchObject({ kind: 'cell', rowKey: ROW_A })
    expect(twinB).toMatchObject({ kind: 'cell', rowKey: ROW_B })
    expect(twinA).not.toEqual(twinB)
  })

  it('suppresses provisional and missing identities entirely', () => {
    expect(
      resolveSheetCommentTarget([row('prov:abc123')], COLUMNS, identity, {
        row: 0,
        column: 0,
      }),
    ).toBeNull()
    expect(
      resolveSheetCommentTarget([{}] as SheetCommentRow[], COLUMNS, identity, {
        row: 0,
        column: 0,
      }),
    ).toBeNull()
  })

  it('builds range targets from durable corner ids only', () => {
    const target = resolveSheetCommentTarget(
      [row(ROW_A), row(ROW_B)],
      COLUMNS,
      identity,
      { row: 0, column: 0, row2: 1, column2: 1 },
    )
    expect(target).toEqual({
      kind: 'range',
      startRowKey: ROW_A,
      startFieldId: 'f-1111',
      endRowKey: ROW_B,
      endFieldId: 'f-2222',
    })
    // A range whose far corner is provisional degrades to null, never to a
    // partially-durable anchor.
    expect(
      resolveSheetCommentTarget(
        [row(ROW_A), row('prov:xyz')],
        COLUMNS,
        identity,
        { row: 0, column: 0, row2: 1, column2: 1 },
      ),
    ).toBeNull()
  })

  it('maps visually moved columns through toPhysicalColumn', () => {
    // Column f-2222 dragged in front of f-1111 visually.
    const physical = [2, 0, 1]
    const target = resolveSheetCommentTarget(
      [row(ROW_A)],
      COLUMNS,
      (visual) => physical[visual],
      { row: 0, column: 0 },
    )
    expect(target).toMatchObject({ kind: 'cell', fieldId: 'f-3333' })
  })
})
