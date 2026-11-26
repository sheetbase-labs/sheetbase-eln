import { useCallback, useMemo } from 'react'
import type { RowData } from '@tanstack/react-table'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import type { RegistryColumn } from './registry-grid-data'
import { cellKind, filterCell } from '#/lib/list-filter'
import type { FilterCell, FilterRecord } from '#/lib/list-filter'
import { choiceFilter } from './list-filter-fields'
import { useClientFilter } from './use-list-filter'
import type { ClientFilter } from './use-list-filter'

/**
 * A filter for any list that already has its columns: each column with a
 * title and a value becomes a filter field, typed by what its rows hold (a
 * number, a date, a yes/no, a short list of words to pick from, or free text).
 * Lists that need pickers for people or projects build their own fields and
 * use `useClientFilter` instead.
 */

/** Up to this many different words, a text column is a list to pick from. */
const CHOICE_LIMIT = 30

interface ColumnSource<T> {
  id: string
  label: string
  accessor: (row: T, index: number) => FilterCell
}

function sources<T extends RowData>(
  columns: readonly RegistryColumn<T>[],
): ColumnSource<T>[] {
  return columns.flatMap((column): ColumnSource<T>[] => {
    const id = column.id
    const header: unknown = column.header

    // SAFETY: A column defined by an accessor function carries it as `accessorFn`; the union's other branches have none. TanStack types its result as unknown, which `filterCell` reads.
    // oxlint-disable-next-line anti-slop/no-unknown-returns
    const read = (column as { accessorFn?: (row: T, i: number) => unknown })
      .accessorFn

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A column's header is a title or a render function; only titles name a filter field.
    if (!id || id.startsWith('__') || typeof header !== 'string' || !read)
      return []

    return [
      { id, label: header, accessor: (row, i) => filterCell(read(row, i)) },
    ]
  })
}

const plainWord = (value: string) => value

/**
 * The field a column of values makes: a number, a yes/no, a date, a short list
 * of words to pick from, or free text. Nothing when every value is empty or the
 * values mix kinds.
 */
export function fieldFromCells(
  id: string,
  label: string,
  cells: readonly FilterCell[],
  rowCount: number,
  valueLabel: (value: string) => string = plainWord,
): SheetbaseField | undefined {
  const values = cells.filter((cell) => cellKind(cell) !== 'none')

  if (values.length === 0) return undefined
  const kinds = new Set(values.map(cellKind))

  if (kinds.has('number') || kinds.has('boolean')) {
    if (kinds.size > 1) return undefined

    return { id, label, dataType: kinds.has('number') ? 'number' : 'boolean' }
  }

  if (kinds.size === 1 && kinds.has('date'))
    return { id, label, dataType: 'date' }

  const words = [...new Set(values.map(String))]

  if (words.length <= CHOICE_LIMIT && rowCount > 1)
    return choiceFilter(
      id,
      label,
      words
        .sort((x, y) => x.localeCompare(y))
        .map((value) => ({ value, label: valueLabel(value) })),
    )

  return { id, label, dataType: 'text' }
}

function fieldFor<T>(
  source: ColumnSource<T>,
  rows: readonly T[],
): SheetbaseField | undefined {
  return fieldFromCells(
    source.id,
    source.label,
    rows.map((row, index) => source.accessor(row, index)),
    rows.length,
  )
}

/** The filter fields for a list's columns, and the values of one row. */
export interface ColumnFilterFields<T> {
  fields: readonly SheetbaseField[]
  toRecord: (row: T) => FilterRecord
}

/** The filter fields for a list's columns, and the values of one row. */
export function useColumnFilterFields<T extends RowData>(
  columns: readonly RegistryColumn<T>[],
  rows: readonly T[],
): ColumnFilterFields<T> {
  const columnSources = useMemo(() => sources(columns), [columns])

  const fields = useMemo(
    () =>
      columnSources.flatMap((source) => {
        const field = fieldFor(source, rows)

        return field ? [field] : []
      }),
    [columnSources, rows],
  )

  const toRecord = useCallback(
    (row: T) =>
      Object.fromEntries(
        columnSources.map((source) => [source.id, source.accessor(row, 0)]),
      ),
    [columnSources],
  )

  return { fields, toRecord }
}

/**
 * The list's filter and the rows it leaves, from the list's own columns.
 * `rows` are the rows the tab and search already left; `all` (default: the
 * same) is what the field pickers learn their types and words from.
 */
export function useColumnFilter<T extends RowData>(
  columns: readonly RegistryColumn<T>[],
  rows: readonly T[],
  all: readonly T[] = rows,
): ClientFilter<T> {
  const { fields, toRecord } = useColumnFilterFields(columns, all)

  return useClientFilter(fields, rows, toRecord)
}
