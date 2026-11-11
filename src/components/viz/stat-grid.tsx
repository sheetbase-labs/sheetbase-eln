/**
 * A small result table (group statistics, an ANOVA, model terms): the app's
 * own grid, so it sorts and exports like every other table. Numbers are set in
 * tabular figures; a column of words passes `text`.
 */
import { useMemo } from 'react'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'

export interface StatColumn<T> {
  id: string
  header: string
  /** What the cell shows. */
  value: (row: T) => string | number
  /** A column of words rather than figures. */
  text?: boolean
  /** The first column names the row. */
  strong?: boolean
  /** What the column sorts by, when that is not what it shows. */
  sortBy?: (row: T) => string | number | null
  /** Classes for a cell that needs its own colour. */
  tone?: (row: T) => string | undefined
}

export function StatGrid<T>({
  label,
  rows,
  columns,
  getRowId,
  maxHeight,
  bare = false,
}: {
  /** Drawn without its own border, inside a box that has one. */
  bare?: boolean
  label: string
  rows: readonly T[]
  columns: readonly StatColumn<T>[]
  getRowId: (row: T, index: number) => string
  /** The tallest the table grows, in px; a short one is only as tall as its rows. */
  maxHeight?: number
}) {
  const keyed = useMemo(
    () => rows.map((row, index) => ({ row, key: getRowId(row, index) })),
    // The key function is a plain read of the row, so only the rows matter.
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- `getRowId` is a pure read of its row; a fresh closure each render must not rebuild the rows.
    [rows],
  )

  type Keyed = (typeof keyed)[number]

  const defs = columns.map(
    (column, position): RegistryColumn<Keyed> => ({
      id: column.id,
      header: column.header,
      accessorFn: (entry: Keyed) =>
        (column.sortBy ?? column.value)(entry.row),
      enableHiding: position !== 0,
      meta: column.text
        ? undefined
        : { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => {
        const shown = column.value(row.original.row)

        const tone = column.tone?.(row.original.row)

        if (tone) return <span className={tone}>{shown}</span>

        return column.strong ? (
          <span className="font-medium text-fg">{shown}</span>
        ) : column.text ? (
          shown
        ) : (
          <span className="num">{shown}</span>
        )
      },
    }),
  )

  const wanted = 31 + 33 * keyed.length + 14

  return (
    <div
      className={bare ? 'overflow-hidden' : 'overflow-hidden rounded-md border'}
      style={
        maxHeight ? { height: Math.min(maxHeight, wanted) } : { height: wanted }
      }
    >
      <RegistryGrid
        label={label}
        rows={keyed}
        columns={defs}
        getRowId={(entry) => entry.key}
        selectable={false}
      />
    </div>
  )
}
