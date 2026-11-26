import { useCallback, useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import {
  choicesFrom,
  dateFilter,
  numberFilter,
  textFilter,
  useRecordFilterFields,
} from './list-filter-fields'
import type { FilterCell } from '#/lib/list-filter'
import { useClientFilter } from './use-list-filter'
import type { ClientFilter } from './use-list-filter'

/**
 * A filter for a list of typed rows: name each column to filter by, what to
 * call it, how its value filters, and where the row keeps it. `choice` offers
 * the words the rows hold; `project` and `owner` look people and projects up as
 * the person types (the row keeps their ids).
 */
export type FilterSpec<T> = Readonly<
  Record<
    string,
    {
      label: string
      type: 'text' | 'number' | 'date' | 'choice' | 'project' | 'owner'
      value: (row: T) => FilterCell
    }
  >
>

/**
 * The list's filter and the rows it leaves. `spec` must keep one identity (a
 * module-level constant); `rows` are what the tab and search left, and `all`
 * (default: the same) is what the pickers learn their words from.
 */
export function useSpecFilter<T>(
  spec: FilterSpec<T>,
  rows: readonly T[],
  all: readonly T[] = rows,
): ClientFilter<T> {
  const { project, owner } = useRecordFilterFields()

  const fields = useMemo<SheetbaseField[]>(
    () =>
      Object.entries(spec).map(([id, column]) => {
        const text = (row: T) => {
          const value = column.value(row)

          return value === null || value === undefined
            ? undefined
            : String(value)
        }

        switch (column.type) {
          case 'number':
            return numberFilter(id, column.label)
          case 'date':
            return dateFilter(id, column.label)
          case 'choice':
            return choicesFrom(id, column.label, all, text)
          case 'project':
            return { ...project, id, label: column.label }
          case 'owner':
            return { ...owner, id, label: column.label }
          default:
            return textFilter(id, column.label)
        }
      }),
    [spec, all, project, owner],
  )

  const toRecord = useCallback(
    (row: T) =>
      Object.fromEntries(
        Object.entries(spec).map(([id, column]) => [id, column.value(row)]),
      ),
    [spec],
  )

  return useClientFilter(fields, rows, toRecord)
}
