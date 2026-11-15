import { useLayoutEffect, useMemo, useReducer } from 'react'
import type { RefObject } from 'react'
import type { ColumnVisibilityState } from '@tanstack/react-table'

/**
 * Keeps a registry table's headers whole.
 *
 * A table wider than its pane scrolls sideways, and the column at the edge is
 * drawn cut mid-word ("Exper", "Calibration du") or sits under a pinned column.
 * Instead, when the table overflows, the lowest-priority column is dropped
 * whole, one at a time, until what is left fits. It comes back when the pane
 * grows by enough to hold it again. Priority is the order of `candidates`, first
 * dropped first; the caller leaves out the columns that always stay (the row's
 * identity, its name, a pinned status or actions column).
 *
 * The user's own column choices are not touched: this only adds to the hidden
 * set, and the columns menu still lists every column.
 */
const REGAIN = 24

function scrollerOf(root: HTMLElement): HTMLElement | null {
  let el = root.querySelector('table')?.parentElement ?? null

  while (el && el !== root.parentElement) {
    const overflowX = getComputedStyle(el).overflowX

    if (overflowX === 'auto' || overflowX === 'scroll') return el
    el = el.parentElement
  }

  return null
}

interface FitState {
  readonly ids: readonly string[]
  /** The pane's width when each column was dropped, to know when it fits again. */
  readonly widths: Readonly<Record<string, number>>
}

type FitAction =
  | { kind: 'overflow'; width: number; candidates: readonly string[] }
  | { kind: 'room'; width: number; candidates: readonly string[] }

function fitReducer(state: FitState, action: FitAction): FitState {
  const open = new Set(action.candidates)
  // Forget a dropped column the table no longer has (a view change).
  const ids = state.ids.filter((id) => open.has(id))
  const gone = ids.length !== state.ids.length

  if (action.kind === 'overflow') {
    const held = new Set(ids)
    const next = action.candidates.find((id) => !held.has(id))

    if (!next) return gone ? { ...state, ids } : state

    return {
      ids: [...ids, next],
      widths: { ...state.widths, [next]: action.width },
    }
  }

  const last = ids.at(-1)

  if (last && action.width > (state.widths[last] ?? Infinity) + REGAIN) {
    return { ...state, ids: ids.slice(0, -1) }
  }

  return gone ? { ...state, ids } : state
}

export function useFitColumns(
  gridRef: RefObject<HTMLDivElement | null>,
  candidateKey: string,
  enabled: boolean,
  remeasureKey: string | number,
): ReadonlySet<string> {
  const [state, dispatch] = useReducer(fitReducer, { ids: [], widths: {} })

  const candidates = useMemo(
    () => (candidateKey ? candidateKey.split('\u0000') : []),
    [candidateKey],
  )

  useLayoutEffect(() => {
    const root = gridRef.current

    if (!enabled || !root) return

    const measure = () => {
      const scroller = scrollerOf(root)

      if (!scroller || scroller.clientWidth === 0) return
      const overflow = scroller.scrollWidth - scroller.clientWidth > 1

      dispatch({
        kind: overflow ? 'overflow' : 'room',
        width: scroller.clientWidth,
        candidates,
      })
    }

    measure()

    // Where there is no layout engine to watch (a test renderer), the
    // one measure above is all there is.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)

    observer.observe(root)
    const scroller = scrollerOf(root)

    if (scroller) observer.observe(scroller)

    return () => observer.disconnect()
  }, [gridRef, enabled, candidates, state, remeasureKey])

  return useMemo(() => new Set(state.ids), [state.ids])
}

/**
 * The columns that may be dropped, in the order they go: right to left, with
 * `keep` columns last. The row's identity and name (the first two data
 * columns), the pinned columns and anything the person hid are never offered.
 */
export function dropOrder(
  ids: readonly (string | undefined)[],
  pinned: readonly string[],
  hidden: ColumnVisibilityState,
  keep: readonly string[] = [],
): string {
  const data = ids.filter((id): id is string => Boolean(id) && id !== '__bulk')
  const stay = new Set([...pinned, ...data.slice(0, 2)])

  return data
    .filter((id) => !stay.has(id) && hidden[id] !== false)
    .reverse()
    .sort((a, b) => Number(keep.includes(a)) - Number(keep.includes(b)))
    .join('\u0000')
}

/**
 * Which columns hold an edge, which are dropped to fit, and the visibility
 * state that results. The first column (the ID) holds the start edge and a
 * trailing Status or row-actions column holds the end edge, so a Manage button
 * is never scrolled out of sight; pinning also moves a column to its edge, so
 * only columns already there are pinned.
 */
export function useFittedColumns({
  gridRef,
  ids,
  ticks,
  hidden,
  keep,
  fit,
  rowCount,
  viewing,
}: {
  gridRef: RefObject<HTMLDivElement | null>
  ids: readonly (string | undefined)[]
  /** Tick boxes take the first column; the ID is then the second. */
  ticks: boolean
  hidden: ColumnVisibilityState
  keep?: readonly string[]
  fit?: boolean
  rowCount: number
  /** A saved view owns column visibility, so it is always handed on. */
  viewing: boolean
}) {
  const key = ids.join('\u0000')

  const columnPinning = useMemo(() => {
    const all = key.split('\u0000').filter(Boolean)
    const end: string[] = []

    for (const id of [...all].reverse()) {
      if (id !== 'status' && id !== 'actions') break
      end.unshift(id)
    }

    return {
      start: ticks ? all.slice(0, 2) : all.slice(0, 1),
      end: all.length > 2 ? end : [],
    }
  }, [key, ticks])

  const dropped = useFitColumns(
    gridRef,
    dropOrder(
      ids,
      [...columnPinning.start, ...columnPinning.end],
      hidden,
      keep,
    ),
    fit !== false,
    rowCount,
  )

  const visibility = useMemo(
    () =>
      viewing || dropped.size > 0
        ? {
            ...hidden,
            ...Object.fromEntries([...dropped].map((id) => [id, false])),
          }
        : undefined,
    [viewing, hidden, dropped],
  )

  return { columnPinning, dropped, visibility }
}
