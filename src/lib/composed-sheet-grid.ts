import type {
  ComposedSheetCellValue,
  ComposedSheetSnapshot,
} from './sheet-composition-data'
import type { FieldEditorPresentation } from './field-presentation'

export interface ComposedSheetGridColumn {
  id: string
  label: string
  presentation: FieldEditorPresentation
  editable: boolean
}

export interface ComposedSheetGridMatrix {
  columns: ComposedSheetGridColumn[]
  rowKeys: string[]
  data: ComposedSheetCellValue[][]
}

export function composedSheetGridMatrix(
  snapshot: ComposedSheetSnapshot,
): ComposedSheetGridMatrix {
  const columns = (snapshot.boundProjection?.columns ?? []).map((column) => ({
    id: column.id,
    label: column.label,
    presentation: column.presentation,
    editable: column.permission.editability === 'editable',
  }))

  const rows = snapshot.boundProjection?.rows ?? []
  // GRID-05: column ids hoisted out of the per-row loop; a missing value
  // entry reads as null instead of throwing (unmatched provenance shape).
  const columnIds = columns.map((column) => column.id)

  return {
    columns,
    rowKeys: rows.map((row) => row.rowKey),
    data: rows.map((row) =>
      columnIds.map((id) => {
        const value = Object.hasOwn(row.values, id) ? row.values[id] : undefined

        return value && value.kind === 'present' ? value.value : null
      }),
    ),
  }
}
