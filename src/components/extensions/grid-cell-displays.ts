import type {
  CellDisplays,
  CellDisplaySpec,
} from '#/lib/extensions/cell-display'

/**
 * The cell displays plugins offer a dataset grid, by column id. A column is
 * matched on its key and type with the same rules as a model's fields. A point
 * that names particular models or plugin field types does not apply here,
 * because a dataset column belongs to neither.
 */
export function gridCellDisplays(
  tableCells: ReadonlyArray<{
    declaration: {
      appliesTo: {
        models?: string[]
        fields?: string[]
        fieldTypes?: string[]
        pluginTypes?: string[]
      }
      display?: CellDisplaySpec
    }
  }>,
  columns: ReadonlyArray<{ id: string; key: string; logicalType: string }>,
): CellDisplays {
  const out: Record<string, CellDisplaySpec> = {}

  for (const column of columns) {
    for (const cell of tableCells) {
      const target = cell.declaration.appliesTo
      const display = cell.declaration.display

      if (!display || target.models || target.pluginTypes) continue

      if (target.fields && !target.fields.includes(column.key)) continue

      if (target.fieldTypes && !target.fieldTypes.includes(column.logicalType))
        continue
      out[column.id] = display
      break
    }
  }

  return out
}
