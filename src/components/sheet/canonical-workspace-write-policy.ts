import { t } from '#/copy'
import { z } from 'zod'
import { personFromText } from '#/lib/well-person'
import {
  parseSheetCellInput,
  sheetWriteError,
} from '#/lib/canonical-sheet-grid'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import { fieldQuantityEntry } from '#/lib/field-value-validation'
import { unitsLike } from '#/lib/lab-units'
import type {
  SheetbaseGridCellChange,
  SheetbaseGridWriteSource,
} from './sheetbase-grid'

/** A refusal applies to the entire operation; accepted inputs are coerced in place. */
export function prepareCanonicalWorkspaceWrite({
  columns,
  changes,
  source,
  people,
}: {
  columns: readonly CanonicalSheetGridColumn[]
  changes: SheetbaseGridCellChange[]
  source: SheetbaseGridWriteSource
  /** Workspace members' names by user id; a person cell takes a name. */
  people?: ReadonlyMap<string, string>
}):
  | { result: false; status: string }
  | { result: undefined; status: string | null } {
  const columnsById = new Map(columns.map((column) => [column.id, column]))
  let converted: string | null = null

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
    const typed = z.string().safeParse(change.next)

    const value =
      column.field?.logicalType === 'person' && typed.success
        ? personFromText(typed.data, people)
        : parseSheetCellInput(column.field, change.next)

    const invalid = sheetWriteError(column, value)
    const unit = column.field?.quantity?.storageUnit ?? ''

    if (invalid === 'wrong_unit') {
      const examples = unitsLike(unit).filter((other) => other !== unit)

      return {
        result: false,
        status: t(
          examples.length > 0
            ? 'notebook.canonicalSheetWorkspace.wrongUnit'
            : 'notebook.canonicalSheetWorkspace.wrongUnitOnly',
          {
            verb,
            label: column.label,
            unit,
            units: examples.slice(0, 4).join(', '),
          },
        ),
      }
    }

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

    const entry = column.field ? fieldQuantityEntry(column.field, value) : null

    if (entry?.kind === 'converted')
      converted = t('notebook.canonicalSheetWorkspace.unitConverted', {
        entered: `${entry.entered.value} ${entry.entered.unit}`,
        stored: `${entry.value} ${unit}`,
        label: column.label,
      })

    change.next = value
  }

  return { result: undefined, status: converted }
}
