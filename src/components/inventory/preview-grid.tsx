/**
 * A preview of rows whose columns are only known at run time (a source table,
 * a mapped file, a pipeline step's output): the app's own grid, so it sorts,
 * chooses columns and exports like every other list. Values are plain text.
 */
import { useMemo } from 'react'

import { RegistryGrid } from './registry-grid'
import type { RegistryColumn } from './registry-grid'

export type PreviewValue = string | number | boolean | null | undefined

type PreviewRow = {
  readonly __row: string
  readonly values: Record<string, PreviewValue>
}

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
  numericColumns,
  maxHeight,
  selectedRow,
}: {
  /** The position of the row to shade, e.g. the one a chart point came from. */
  selectedRow?: number
  label: string
  columns: readonly string[]
  rows: readonly Record<string, PreviewValue>[]
  loading?: boolean
  className?: string
  /** Stable row keys when the rows have identity; otherwise their order is the key. */
  rowKeys?: readonly string[]
  /** Columns of numbers: right-aligned, in tabular figures. */
  numericColumns?: readonly string[]
  /** The tallest the preview grows, in px; a short one is only as tall as its rows. */
  maxHeight?: number
}) {
  const columnKey = columns.join('\u0000')
  const numericKey = (numericColumns ?? []).join('\u0000').split('\u0000')

  const defs = useMemo<RegistryColumn<PreviewRow>[]>(
    () =>
      columns.map((column) => ({
        id: `col:${column}`,
        header: column,
        accessorFn: (row: PreviewRow) => show(row.values[column]),
        meta: numericKey.includes(column)
          ? {
              headerTitle: column,
              headerClassName: 'text-right',
              cellClassName: 'text-right',
            }
          : { headerTitle: column },
        cell: ({ row }) => (
          <span
            className={
              numericKey.includes(column)
                ? 'num truncate'
                : 'mono truncate text-label'
            }
          >
            {show(row.original.values[column])}
          </span>
        ),
      })),
    // The column list is compared by content so a fresh array does not rebuild the cells.
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- the column list is read through `columnKey`, its content: a fresh array of the same names must not rebuild the cells.
    [columnKey, numericKey.join('\u0000')],
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

  // 31px header band + 33px rows + the scrollbar's room.
  const wanted = 31 + 33 * data.length + 14

  return (
    <div
      className={maxHeight ? 'overflow-hidden' : undefined}
      style={maxHeight ? { height: Math.min(maxHeight, wanted) } : undefined}
    >
      <RegistryGrid
        label={label}
        rows={data}
        columns={defs}
        getRowId={(row) => row.__row}
        selectable={false}
        rowSelection={
          selectedRow !== undefined && selectedRow >= 0
            ? { [data[selectedRow]?.__row ?? '']: true }
            : undefined
        }
        isLoading={loading}
        className={className}
      />
    </div>
  )
}
