import type { ComposedSheetSnapshot } from './sheet-composition-data'
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
  data: unknown[][]
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
  return {
    columns,
    rowKeys: rows.map((row) => row.rowKey),
    data: rows.map((row) =>
      columns.map((column) => {
        const value = row.values[column.id]
        return value?.kind === 'present' ? value.value : null
      }),
    ),
  }
}
