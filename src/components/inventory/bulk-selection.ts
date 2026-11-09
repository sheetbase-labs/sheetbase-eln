import { useCallback, useMemo, useState } from 'react'

import { BULK_LIMIT } from '#/lib/bulk-records'

/**
 * The records ticked in a list, for bulk actions. This is separate from the
 * list's own selection, which is the one row its inspector shows: ticking a
 * box never opens or closes the inspector.
 */
export interface BulkSelection {
  ids: readonly string[]
  count: number
  has: (id: string) => boolean
  toggle: (id: string) => void
  /** Tick or untick every id in `ids` (capped at the bulk limit). */
  setMany: (ids: readonly string[], on: boolean) => void
  /** Keep only the ids still in the list, so a hidden row is never acted on. */
  retain: (ids: readonly string[]) => void
  /** Keep only these ids: what is left after an action refused some. */
  replace: (ids: readonly string[]) => void
  clear: () => void
}

export function useBulkSelection(): BulkSelection {
  const [selected, setSelected] = useState<readonly string[]>([])
  const has = useCallback((id: string) => selected.includes(id), [selected])

  const toggle = useCallback(
    (id: string) =>
      setSelected((current) =>
        current.includes(id)
          ? current.filter((x) => x !== id)
          : current.length >= BULK_LIMIT
            ? current
            : [...current, id],
      ),
    [],
  )

  const setMany = useCallback((ids: readonly string[], on: boolean) => {
    setSelected((current) =>
      on
        ? [...new Set([...current, ...ids])].slice(0, BULK_LIMIT)
        : current.filter((id) => !ids.includes(id)),
    )
  }, [])

  const retain = useCallback((ids: readonly string[]) => {
    const keep = new Set(ids)
    setSelected((current) =>
      current.every((id) => keep.has(id))
        ? current
        : current.filter((id) => keep.has(id)),
    )
  }, [])

  const replace = useCallback((ids: readonly string[]) => setSelected(ids), [])
  const clear = useCallback(() => setSelected([]), [])

  return useMemo(
    () => ({
      ids: selected,
      count: selected.length,
      has,
      toggle,
      setMany,
      retain,
      replace,
      clear,
    }),
    [selected, has, toggle, setMany, retain, replace, clear],
  )
}
