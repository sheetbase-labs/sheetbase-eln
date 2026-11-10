/**
 * How a person likes their lists: the column a table is sorted by and the
 * columns they hid. Remembered per person (`api.list_views`), so the choice
 * follows them to another device and never changes what anyone else sees.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { functionalUpdate } from '@tanstack/react-table'
import type { SortingState, Updater } from '@tanstack/react-table'
import { z } from 'zod'

import { notebookDataClient } from './notebook-data'
import type { DataClient } from './data-client'

export interface ListViewChoice {
  sorting: SortingState
  /** Ids of the columns this person hid. */
  hidden: string[]
}

export interface ListView extends ListViewChoice {
  /** The server has answered; until then the table shows the list's own order. */
  ready: boolean
  setSorting: (updater: Updater<SortingState>) => void
  setHidden: (updater: Updater<string[]>) => void
  /** Back to the list's own order with every column shown. */
  reset: () => void
}

const EMPTY: ListViewChoice = { sorting: [], hidden: [] }

/** How long a burst of header clicks waits before it is written. */
export const LIST_VIEW_SAVE_MS = 600

export const listViewQueryKey = (key: string) => ['list-view', key] as const

interface ListViewWire {
  sorting: unknown
  hidden_columns: unknown
}

/** What the server holds, cleaned: a stored value that is not the expected
 * shape is treated as no choice rather than breaking the table. */
export function toListViewChoice(
  row: ListViewWire | undefined,
): ListViewChoice {
  if (!row) return EMPTY

  const sorting = Array.isArray(row.sorting)
    ? row.sorting.flatMap((entry): SortingState => {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Stored preferences retain native objects, including arrays with properties, rather than imposing a JSON-only contract.
        if (!entry || typeof entry !== 'object') return []

        // SAFETY: An object can be inspected through optional unknown properties; this promises neither their presence nor their value types.
        const candidate = entry as { id?: unknown; desc?: unknown }
        const parsed = z.string().safeParse(candidate.id)

        if (!parsed.success) return []

        // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Legacy output compatibility only: a native getter's second read is unchecked and can differ from the decoded first read.
        const id = candidate.id as string

        return [{ id, desc: candidate.desc === true }]
      })
    : []

  const hidden = Array.isArray(row.hidden_columns)
    ? row.hidden_columns.flatMap((id) => {
        const parsed = z.string().safeParse(id)

        return parsed.success ? [parsed.data] : []
      })
    : []

  return { sorting: sorting.slice(0, 4), hidden }
}

/**
 * The person's remembered sorting and hidden columns for one list, and the
 * setters that change and remember them. `key` names the list ("samples").
 */
export function useListView(
  key: string,
  client: DataClient = notebookDataClient,
): ListView {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => listViewQueryKey(key), [key])

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<ListViewChoice> => {
      const rows = await client.list<ListViewWire>(
        'list_views',
        `?list_key=eq.${encodeURIComponent(key)}&select=sorting,hidden_columns&limit=1`,
      )

      return toListViewChoice(rows[0])
    },
    staleTime: Infinity,
    // A list still works without its remembered view, so a failed read is not retried loudly.
    retry: false,
  })

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<ListViewChoice | undefined>(undefined)

  const flush = useCallback(() => {
    const choice = pending.current
    pending.current = undefined

    if (!choice) return
    // Remembering a view is a convenience: when it cannot be saved the table
    // still shows what was chosen for now.
    void Promise.resolve()
      .then(() =>
        client.rpc('set_list_view', {
          p_list_key: key,
          p_sorting: choice.sorting,
          p_hidden_columns: choice.hidden,
        }),
      )
      .catch(() => undefined)
  }, [client, key])

  // A choice still waiting is written when the list is left.
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      flush()
    },
    [flush],
  )

  const update = useCallback(
    (change: (current: ListViewChoice) => ListViewChoice) => {
      const current =
        queryClient.getQueryData<ListViewChoice>(queryKey) ?? EMPTY

      const next = change(current)
      // A read still in flight must not answer over a choice made meanwhile.
      void queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData(queryKey, next)
      pending.current = next
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, LIST_VIEW_SAVE_MS)
    },
    [queryClient, queryKey, flush],
  )

  const setSorting = useCallback(
    (updater: Updater<SortingState>) =>
      update((c) => ({ ...c, sorting: functionalUpdate(updater, c.sorting) })),
    [update],
  )

  const setHidden = useCallback(
    (updater: Updater<string[]>) =>
      update((c) => ({ ...c, hidden: functionalUpdate(updater, c.hidden) })),
    [update],
  )

  const reset = useCallback(() => update(() => EMPTY), [update])

  const choice = query.data ?? EMPTY

  return useMemo(
    () => ({
      ...choice,
      ready: !query.isPending,
      setSorting,
      setHidden,
      reset,
    }),
    [choice, query.isPending, setSorting, setHidden, reset],
  )
}
