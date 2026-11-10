/**
 * Offline sheet edits, shown where they will land.
 *
 * Edits made offline wait in the device store until the connection returns.
 * Until then the grid has to show them, including after a reload, otherwise a
 * person sees their typing vanish and cannot trust that it was kept. This lays
 * the queued cell edits and added rows for one sheet over the server's matrix.
 * It returns the input untouched when nothing is waiting.
 */

import type { CanonicalSheetGridMatrix } from '#/lib/canonical-sheet-grid'
import type { OfflineEdit } from '#/lib/offline/store'

export function overlayOfflineSheetEdits(
  matrix: CanonicalSheetGridMatrix,
  sheetInstanceId: string,
  edits: readonly OfflineEdit[],
): CanonicalSheetGridMatrix {
  const mine = edits.filter(
    (edit) =>
      (edit.kind === 'cell' || edit.kind === 'row') &&
      edit.sheetInstanceId === sheetInstanceId,
  )

  if (mine.length === 0) return matrix

  const columnIndex = new Map(
    matrix.columns.map((column, index) => [column.id, index] as const),
  )

  const rowIndex = new Map(
    matrix.rowKeys.map((key, index) => [key, index] as const),
  )

  const rowKeys = [...matrix.rowKeys]
  const rowKinds = [...matrix.rowKinds]
  const data = matrix.data.map((row) => [...row])

  for (const edit of mine) {
    if (edit.kind === 'row') {
      // A row the server already has (replay committed it, or a refresh raced
      // the store) is shown once, from the server.
      if (edit.rowKey && rowIndex.has(edit.rowKey)) continue

      const row: CanonicalSheetGridMatrix['data'][number] = matrix.columns.map(
        () => null,
      )

      for (const [columnId, value] of Object.entries(edit.values)) {
        const index = columnIndex.get(columnId)

        if (index !== undefined) row[index] = value
      }

      if (edit.rowKey) rowIndex.set(edit.rowKey, rowKeys.length)
      rowKeys.push(edit.rowKey ?? `offline-row:${edit.id}`)
      rowKinds.push('local')
      data.push(row)
    } else if (edit.kind === 'cell') {
      const row = rowIndex.get(edit.rowId)
      const column = columnIndex.get(edit.columnId)

      if (row === undefined || column === undefined) continue
      data[row][column] = edit.value
    }
  }

  return { ...matrix, rowKeys, rowKinds, data }
}
