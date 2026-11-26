import { useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type {
  GroupNode,
  SheetbaseField,
} from '@sheetbase-labs/sheetbase-shared'

import { filterRows } from '#/lib/list-filter'
import { decodeFilter, encodeFilter } from '#/lib/search-filter'
import type { ListFilter } from './list-filter'

/**
 * A list's filter, read from and written to the `filter` parameter of the page
 * it is on. The route lists it in `validateSearch` with `filterSearch`, so a
 * pane, a link and the back button keep it.
 */
export function useListFilter(fields: readonly SheetbaseField[]): ListFilter {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  // SAFETY: Every route that lists filters declares `filter` through `filterSearch`; strict:false only widens the key set.
  const raw = (search as { filter?: unknown }).filter

  const tree = useMemo(() => decodeFilter(raw), [raw])

  return useMemo(
    () => ({
      fields,
      tree,
      onChange: (next: GroupNode | undefined) => {
        void navigate({
          // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The page's own search keys pass through unchanged; only `filter` changes.
          search: ((prev: Record<string, unknown>) => ({
            ...prev,
            filter: encodeFilter(next),
          })) as never,
          replace: true,
        })
      },
    }),
    [fields, tree, navigate],
  )
}

/**
 * A filter on rows the list already holds: the URL tree decides which of
 * `rows` show. `toRecord` names each row's value for every filter field id, and
 * must keep one identity (a module-level function).
 */
export function useClientFilter<T>(
  fields: readonly SheetbaseField[],
  rows: readonly T[],
  toRecord: (row: T) => Record<string, unknown>,
): { filter: ListFilter; rows: T[] } {
  const filter = useListFilter(fields)

  const filtered = useMemo(
    () => filterRows(rows, filter.tree, toRecord),
    [rows, filter.tree, toRecord],
  )

  return { filter, rows: filtered }
}
