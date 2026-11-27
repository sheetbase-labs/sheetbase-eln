import { useCallback, useEffect, useRef } from 'react'
import type { RefObject, UIEvent } from 'react'

export interface PaneScroll {
  onScrollCapture: (event: UIEvent<HTMLElement>) => void
}

/** How long a returning page gets to draw before we stop looking for its scroller. */
const SETTLE_MS = 2500

/** Where a pane's scrollers were left, per page it has shown. */
const left = new Map<string, Map<string, number>>()

/** How long after a wheel, touch or key press a scroll still counts as theirs. */
const INPUT_MS = 1500

/** Forget every remembered position (tests, and a closed pane's pages). */
export function resetPaneScroll(): void {
  left.clear()
}

/** Every element in the pane with exactly these classes, in page order. */
function twinsOf(root: HTMLElement, classes: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*')).filter(
    (el) => el.className === classes,
  )
}

/** A scroller named by its classes and its place among its twins in the pane. */
function nameOf(root: HTMLElement, el: HTMLElement): string {
  return `${el.className}#${twinsOf(root, el.className).indexOf(el)}`
}

/**
 * A list keeps its place. Going into a record from a long list and coming back
 * (back button, breadcrumb, the pane's trail) puts the list where it was left,
 * instead of at the top. Scrollers are found as the page draws, since rows
 * arrive after the page does, and a person who starts scrolling first wins.
 */
export function usePaneScroll(
  rootRef: RefObject<HTMLElement | null>,
  pageKey: string,
): PaneScroll {
  const remembering = useRef(true)
  const lastInput = useRef(Number.NEGATIVE_INFINITY)

  useEffect(() => {
    const root = rootRef.current

    const mark = () => {
      lastInput.current = performance.now()
    }

    const events = [
      'wheel',
      'touchstart',
      'touchmove',
      'touchend',
      'keydown',
      'pointerdown',
    ]

    for (const name of events)
      root?.addEventListener(name, mark, { passive: true, capture: true })

    return () => {
      for (const name of events)
        root?.removeEventListener(name, mark, { capture: true })
    }
  }, [rootRef])

  const onScrollCapture = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const root = rootRef.current
      const target = event.target

      if (!root || !(target instanceof HTMLElement) || !remembering.current)
        return
      const page = left.get(pageKey) ?? new Map<string, number>()

      const name = nameOf(root, target)

      // A list pushed back to the top as the page is left (rows swapped for a
      // skeleton, a refetch) is not the person scrolling there: only a scroll
      // to the top that follows their own input replaces where they were.
      const byPerson = performance.now() - lastInput.current < INPUT_MS

      if (target.scrollTop === 0 && !byPerson) return
      page.set(name, target.scrollTop)
      left.set(pageKey, page)
    },
    [rootRef, pageKey],
  )

  useEffect(() => {
    const root = rootRef.current
    const page = left.get(pageKey)

    if (!root || !page || page.size === 0) return
    const started = performance.now()
    let frame = 0
    let touched = false
    const stop = () => (touched = true)

    root.addEventListener('wheel', stop, { passive: true })
    root.addEventListener('touchstart', stop, { passive: true })
    root.addEventListener('keydown', stop)
    remembering.current = false

    // Keep putting the list back for a moment: rows that arrive late, or a
    // refetch swapping a skeleton for rows, can reset the scroller after it was
    // first restored. Anything the person does themselves ends this at once.
    const tick = () => {
      for (const [name, top] of page) {
        const cut = name.lastIndexOf('#')

        const el = twinsOf(root, name.slice(0, cut))[
          Number(name.slice(cut + 1))
        ]

        if (
          el &&
          el.scrollHeight - el.clientHeight >= top - 1 &&
          Math.abs(el.scrollTop - top) > 1
        )
          el.scrollTop = top
      }

      if (!touched && performance.now() - started < SETTLE_MS)
        frame = requestAnimationFrame(tick)
      else remembering.current = true
    }

    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      remembering.current = true
      root.removeEventListener('wheel', stop)
      root.removeEventListener('touchstart', stop)
      root.removeEventListener('keydown', stop)
    }
  }, [rootRef, pageKey])

  return { onScrollCapture }
}
