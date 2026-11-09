/**
 * Swipe gestures for the phone navigation drawer: drag in from the left edge
 * to open it, drag left on it to close it. The edge strip is narrow so it
 * never fights with swiping across a table, and a mostly-vertical drag (a
 * scroll) never counts.
 */
import { useEffect, useRef } from 'react'

export const EDGE_WIDTH_PX = 24
export const SWIPE_DISTANCE_PX = 56

/** A swipe must be this much more sideways than up or down. */
export const SWIPE_RATIO = 1.6

export interface Point {
  x: number
  y: number
}

export type SwipeDirection = 'right' | 'left' | null

export function classifySwipe(start: Point, end: Point): SwipeDirection {
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (Math.abs(dx) < SWIPE_DISTANCE_PX) return null

  if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return null

  return dx > 0 ? 'right' : 'left'
}

export function startsAtLeftEdge(start: Point): boolean {
  return start.x <= EDGE_WIDTH_PX
}

/** Surfaces that own a sideways drag: canvases, sliders, anything opted out. */
const OPT_OUT = '[data-no-edge-swipe], canvas, input[type="range"]'

/**
 * True when a rightwards drag from this element already means something: an
 * opted-out surface, an open dialog, or a sideways scroller that is scrolled
 * away from its left end (it can still scroll back). A scroller at its left
 * end can't move right, so the swipe is free to open the drawer.
 */
export function touchOwnsHorizontalDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  if (target.closest(OPT_OUT)) return true

  if (target.closest('[role="dialog"], [role="alertdialog"]')) return true

  for (let el: Element | null = target; el; el = el.parentElement) {
    if (!(el instanceof HTMLElement) || el.scrollWidth <= el.clientWidth)
      continue
    const overflowX = getComputedStyle(el).overflowX

    if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollLeft > 0)
      return true
  }

  return false
}

const PHONE_QUERY = '(max-width: 767px)'

/** Open the drawer when the person drags in from the left edge of a phone. */
export function useEdgeSwipeOpen(onOpen: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    let start: Point | null = null

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      start =
        event.touches.length === 1 &&
        window.matchMedia(PHONE_QUERY).matches &&
        startsAtLeftEdge({ x: touch.clientX, y: touch.clientY }) &&
        !touchOwnsHorizontalDrag(event.target)
          ? { x: touch.clientX, y: touch.clientY }
          : null
    }

    const onEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0]
      const from = start
      start = null

      if (!from) return

      if (
        classifySwipe(from, { x: touch.clientX, y: touch.clientY }) === 'right'
      )
        onOpen()
    }

    const cancel = () => {
      start = null
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', cancel, { passive: true })

    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', cancel)
    }
  }, [enabled, onOpen])
}

/** Props for a panel that closes when dragged left. */
export function useSwipeToClose(onClose: () => void) {
  const start = useRef<Point | null>(null)

  return {
    onTouchStart: (event: React.TouchEvent) => {
      const touch = event.touches[0]
      start.current =
        event.touches.length === 1
          ? { x: touch.clientX, y: touch.clientY }
          : null
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const touch = event.changedTouches[0]
      const from = start.current
      start.current = null

      if (!from) return

      if (
        classifySwipe(from, { x: touch.clientX, y: touch.clientY }) === 'left'
      )
        onClose()
    },
  }
}
