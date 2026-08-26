/**
 * COLLAB-02: resolves a Handsontable selection rectangle to a durable sheet
 * comment target.
 *
 * Row identity contract: `row.id` is the **persisted UUID primary key** of
 * the sheet's backing data table (`api.sheet_<…>.id`, created with
 * `gen_random_uuid()`; see drizzle/0013). It is independent of cell values,
 * so anchors survive row edits, visual reorder and duplicate content.
 * Provisional rows (`prov:…`) have no server identity yet and never anchor.
 *
 * Field identity comes from the column model via `toPhysicalColumn`, so
 * visual column reordering never leaks into metadata and label renames do
 * not move comments (fields are addressed by column UUID).
 */

export interface SheetCommentRow {
  id?: unknown
}

export interface SheetCommentColumn {
  id: string
}

export type ResolvedSheetCommentTarget =
  | { kind: 'cell'; rowKey: string; fieldId: string }
  | {
      kind: 'range'
      startRowKey: string
      startFieldId: string
      endRowKey: string
      endFieldId: string
    }

/** Durable ids only: strings that are not provisional placeholders. */
function durableRowKeyAt(
  rows: SheetCommentRow[],
  visualRow: number,
): string | null {
  const id = rows[visualRow]?.id
  if (typeof id !== 'string' || id.length === 0 || id.startsWith('prov:')) {
    return null
  }
  return id
}

/**
 * @param rows grid rows in current visual order (values may be anything;
 *   only `id` participates)
 * @param columns column model in physical order
 * @param toPhysical maps a visual column index to its physical index
 */
export function resolveSheetCommentTarget(
  rows: SheetCommentRow[],
  columns: SheetCommentColumn[],
  toPhysical: (visualColumn: number) => number,
  rect: { row: number; column: number; row2?: number; column2?: number },
): ResolvedSheetCommentTarget | null {
  const row2 = rect.row2 ?? rect.row
  const column2 = rect.column2 ?? rect.column
  const startRowIdx = Math.min(rect.row, row2)
  const endRowIdx = Math.max(rect.row, row2)
  const startColVisual = Math.min(rect.column, column2)
  const endColVisual = Math.max(rect.column, column2)

  const startRowKey = durableRowKeyAt(rows, startRowIdx)
  const endRowKey = durableRowKeyAt(rows, endRowIdx)
  const startFieldId = columns.at(toPhysical(startColVisual))?.id ?? null
  const endFieldId = columns.at(toPhysical(endColVisual))?.id ?? null

  if (
    startRowIdx === endRowIdx &&
    startColVisual === endColVisual &&
    startFieldId === endFieldId
  ) {
    return startRowKey && startFieldId
      ? { kind: 'cell', rowKey: startRowKey, fieldId: startFieldId }
      : null
  }
  return startRowKey && endRowKey && startFieldId && endFieldId
    ? {
        kind: 'range',
        startRowKey,
        startFieldId,
        endRowKey,
        endFieldId,
      }
    : null
}
