import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

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

export function useFitColumns(
  gridRef: RefObject<HTMLDivElement | null>,
  candidates: readonly string[],
  enabled: boolean,
  remeasureKey: string | number,
): ReadonlySet<string> {
  const [dropped, setDropped] = useState<readonly string[]>([])
  const widthWhenDropped = useRef(new Map<string, number>())
  const candidateKey = candidates.join('\u0000')

  useLayoutEffect(() => {
    const root = gridRef.current

    if (!enabled || !root) return

    const available = new Set(candidates)

    const measure = () => {
      const scroller = scrollerOf(root)

      if (!scroller || scroller.clientWidth === 0) return
      // Forget a dropped column the table no longer has (a view change).
      const live = dropped.filter((id) => available.has(id))

      if (live.length !== dropped.length) {
        setDropped(live)

        return
      }

      const overflow = scroller.scrollWidth - scroller.clientWidth > 1

      if (overflow) {
        const next = candidates.find((id) => !dropped.includes(id))

        if (next) {
          widthWhenDropped.current.set(next, scroller.clientWidth)
          setDropped([...dropped, next])
        }

        return
      }

      const last = dropped.at(-1)

      if (
        last &&
        scroller.clientWidth >
          (widthWhenDropped.current.get(last) ?? Infinity) + REGAIN
      ) {
        setDropped(dropped.slice(0, -1))
      }
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
    // `candidateKey` stands for `candidates`, which is rebuilt on every render.
  }, [gridRef, enabled, candidateKey, dropped, remeasureKey])

  return new Set(dropped)
}
