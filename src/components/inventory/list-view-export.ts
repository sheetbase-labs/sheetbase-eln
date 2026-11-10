import { getColumnHeaderLabel } from '#/components/reui/data-grid/data-grid'
import type { DataGridFeatures } from '#/components/reui/data-grid/data-grid'
import type { Column, RowData, Table } from '@tanstack/react-table'
import type { ExportTable, ExportValue } from '#/lib/export/table-file'

/** Shown value-bearing columns, excluding registry controls. */
function exportable<T extends RowData>(
  table: Table<DataGridFeatures, T>,
): Column<DataGridFeatures, T>[] {
  return table
    .getVisibleLeafColumns()
    .filter(
      (column) =>
        column.id !== '__bulk' &&
        column.id !== '__view' &&
        (column.columnDef.meta?.exportValue !== undefined ||
          'accessorFn' in column.columnDef),
    )
}

/** Visible records in their displayed order, without group bands. */
export function exportTable<T extends RowData>(
  table: Table<DataGridFeatures, T>,
): ExportTable {
  const columns = exportable(table)

  const rows = table
    .getRowModel()
    .rows.filter((row) => !('__band' in row.original))
    .map((row) =>
      columns.map((column): ExportValue => {
        const custom = column.columnDef.meta?.exportValue

        return custom
          ? custom(row.original)
          : row.getValue<ExportValue>(column.id)
      }),
    )

  return { headers: columns.map(getColumnHeaderLabel), rows }
}

export function exportFileName(name: string, extension: string): string {
  const stem =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'list'

  return `${stem}-${new Date().toISOString().slice(0, 10)}.${extension}`
}
