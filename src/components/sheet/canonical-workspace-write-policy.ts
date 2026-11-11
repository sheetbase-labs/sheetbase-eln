import { t } from '#/copy'
import {
  parseSheetCellInput,
  sheetWriteError,
} from '#/lib/canonical-sheet-grid'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import type {
  SheetbaseGridCellChange,
  SheetbaseGridWriteSource,
} from './sheetbase-grid'

/** A refusal applies to the entire operation; accepted inputs are coerced in place. */
export function prepareCanonicalWorkspaceWrite({
  columns,
  changes,
  source,
}: {
  columns: readonly CanonicalSheetGridColumn[]
  changes: SheetbaseGridCellChange[]
  source: SheetbaseGridWriteSource
}): { result: false; status: string } | { result: undefined; status: null } {
  const columnsById = new Map(columns.map((column) => [column.id, column]))

  const verb =
    source === 'paste'
      ? t('notebook.canonicalSheetWorkspace.paste')
      : source === 'fill'
        ? t('notebook.canonicalSheetWorkspace.fill')
        : source === 'clear'
          ? t('common.actions.clear')
          : t('common.actions.edit')

  for (const change of changes) {
    const column = columnsById.get(change.columnId)

    if (change.editable === false || (column && !column.editable)) {
      return {
        result: false,
        status: t('notebook.canonicalSheetWorkspace.verbRejectedTheRange', {
          verb,
        }),
      }
    }

    if (!column) continue
    const value = parseSheetCellInput(column.field, change.next)
    const invalid = sheetWriteError(column, value)

    if (invalid) {
      return {
        result: false,
        status: t('notebook.canonicalSheetWorkspace.verbRejectedInvalidIn', {
          verb,
          invalid,
          label: column.label,
        }),
      }
    }

    change.next = value
  }

  return { result: undefined, status: null }
}
