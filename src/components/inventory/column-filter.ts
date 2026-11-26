import { useCallback, useMemo } from 'react'
import type { RowData } from '@tanstack/react-table'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import type { RegistryColumn } from './registry-grid-data'
import { choiceFilter } from './list-filter-fields'
import { useClientFilter } from './use-list-filter'
import type { ListFilter } from './list-filter'

/**
 * A filter for any list that already has its columns: each column with a
 * title and a value becomes a filter field, typed by what its rows hold (a
 * number, a date, a yes/no, a short list of words to pick from, or free text).
 * Lists that need pickers for people or projects build their own fields and
 * use `useClientFilter` instead.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/

/** Up to this many different words, a text column is a list to pick from. */
const CHOICE_LIMIT = 30

type Accessor<T> = (row: T, index: number) => unknown

interface ColumnSource<T> {
  id: string
  label: string
  accessor: Accessor<T>
}

function sources<T extends RowData>(
  columns: readonly RegistryColumn<T>[],
): ColumnSource<T>[] {
  return columns.flatMap((column): ColumnSource<T>[] => {
    const id = column.id
    const header: unknown = column.header

    // SAFETY: A column defined by an accessor function carries it as `accessorFn`; the union's other branches have none.
    const accessor = (column as { accessorFn?: Accessor<T> }).accessorFn

    if (!id || id.startsWith('__') || typeof header !== 'string' || !accessor)
      return []

    return [{ id, label: header, accessor }]
  })
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

function fieldFor<T>(
  source: ColumnSource<T>,
  rows: readonly T[],
): SheetbaseField | undefined {
  const values = rows
    .map((row, index) => source.accessor(row, index))
    .filter(present)

  if (values.length === 0) return undefined
  const { id, label } = source

  if (values.every((v) => typeof v === 'number'))
    return { id, label, dataType: 'number' }

  if (values.every((v) => typeof v === 'boolean'))
    return { id, label, dataType: 'boolean' }

  if (!values.every((v) => typeof v === 'string')) return undefined

  if (values.every((v) => ISO_DATE.test(v)))
    return { id, label, dataType: 'date' }

  const words = [...new Set(values)]

  if (words.length <= CHOICE_LIMIT && rows.length > 1)
    return choiceFilter(
      id,
      label,
      words
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    )

  return { id, label, dataType: 'text' }
}

/** The filter fields for a list's columns, and the values of one row. */
export function useColumnFilterFields<T extends RowData>(
  columns: readonly RegistryColumn<T>[],
  rows: readonly T[],
): {
  fields: readonly SheetbaseField[]
  toRecord: (row: T) => Record<string, unknown>
} {
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
): { filter: ListFilter; rows: T[] } {
  const { fields, toRecord } = useColumnFilterFields(columns, all)

  return useClientFilter(fields, rows, toRecord)
}
