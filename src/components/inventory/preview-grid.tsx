/**
 * A preview of rows whose columns are only known at run time (a source table,
 * a mapped file, a pipeline step's output): the app's own grid, so it sorts,
 * chooses columns and exports like every other list. Values are plain text.
 */
import { useMemo } from 'react'

import { RegistryGrid } from './registry-grid'
import type { RegistryColumn } from './registry-grid'

export type PreviewValue = string | number | boolean | null | undefined

type PreviewRow = { readonly __row: string; readonly values: Record<string, PreviewValue> }

function show(value: PreviewValue): string {
  return value === null || value === undefined ? '' : String(value)
}

export function PreviewGrid({
  label,
  columns,
  rows,
  loading = false,
  className,
  rowKeys,
}: {
  label: string
  columns: readonly string[]
  rows: readonly Record<string, PreviewValue>[]
  loading?: boolean
  className?: string
  /** Stable row keys when the rows have identity; otherwise their order is the key. */
  rowKeys?: readonly string[]
}) {
  const columnKey = columns.join('\u0000')

  const defs = useMemo<RegistryColumn<PreviewRow>[]>(
    () =>
      columns.map((column) => ({
        id: `col:${column}`,
        header: column,
        accessorFn: (row: PreviewRow) => show(row.values[column]),
        meta: { headerTitle: column },
        cell: ({ row }) => (
          <span className="mono truncate text-label">
            {show(row.original.values[column])}
          </span>
        ),
      })),
    // The column list is compared by content so a fresh array does not rebuild the cells.
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- the column list is read through `columnKey`, its content: a fresh array of the same names must not rebuild the cells.
    [columnKey],
  )

  const data = useMemo<PreviewRow[]>(
    () =>
      rows.map((values, index) => ({
        __row: rowKeys?.[index] ?? String(index),
        values,
      })),
    [rows, rowKeys],
  )

  if (columns.length === 0) return null

  return (
    <RegistryGrid
      label={label}
      rows={data}
      columns={defs}
      getRowId={(row) => row.__row}
      selectable={false}
      isLoading={loading}
      className={className}
    />
  )
}
