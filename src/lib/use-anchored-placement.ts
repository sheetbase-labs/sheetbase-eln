import * as React from 'react'

import { placeBeside, readVisibleArea, watchVisibleArea } from './visible-area'
import type { FloatingPlacement } from './visible-area'

export interface Anchor {
  top: number
  bottom: number
  left: number
}

/**
 * Keep a hand-positioned floating surface (the slash menu, the selection
 * toolbar) beside its anchor and inside the visible area: above the keyboard,
 * below the status bar, on screen sideways. Re-places it whenever the
 * keyboard, the viewport, a scroll container or the surface's own size moves.
 *
 * `getAnchor` is read again on every re-place, so a caret that scrolls with
 * the page drags the surface with it. `maxHeight` is the surface's natural
 * cap; it is shrunk (and the surface scrolls) when the room is smaller.
 *
 * Returns the style to spread on the surface (fixed position, top, left,
 * max height) and the side it opened on.
 */
export function useAnchoredPlacement<T extends HTMLElement>(options: {
  open: boolean
  ref: React.RefObject<T | null>
  getAnchor: () => Anchor | null
  maxHeight: number
  prefer?: 'top' | 'bottom'
  gap?: number
}): { style: React.CSSProperties; side: FloatingPlacement['side'] | null } {
  const { open, ref, maxHeight, prefer = 'bottom', gap } = options
  const getAnchorRef = React.useRef(options.getAnchor)
  getAnchorRef.current = options.getAnchor

  const [placement, setPlacement] = React.useState<FloatingPlacement | null>(
    null,
  )

  const place = React.useCallback(() => {
    const el = ref.current
    const anchor = getAnchorRef.current()

    if (!el || !anchor) return

    const next = placeBeside({
      anchor,
      size: {
        width: el.offsetWidth,
        height: Math.min(el.scrollHeight, maxHeight),
      },
      area: readVisibleArea(),
      gap,
      prefer,
    })

    setPlacement((prev) =>
      prev &&
      Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.left - next.left) < 0.5 &&
      Math.abs(prev.maxHeight - next.maxHeight) < 0.5 &&
      prev.side === next.side
        ? prev
        : next,
    )
  }, [ref, maxHeight, prefer, gap])

  React.useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)

      return
    }

    place()
    const stop = watchVisibleArea(place)
    const el = ref.current

    const observer =
      el && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(place)
        : null

    if (el) {
      observer?.observe(el)

      // The content's own size (filtering the list) changes scrollHeight.
      for (const child of Array.from(el.children)) observer?.observe(child)
    }

    return () => {
      stop()
      observer?.disconnect()
    }
  }, [open, place, ref])

  // Anchor moved between renders (typing, a new query): re-place.
  React.useLayoutEffect(() => {
    if (open) place()
  })

  if (!placement) {
    // Measured before it is shown, so the first frame never lands off-screen.
    return {
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        maxHeight,
        visibility: 'hidden',
      },
      side: null,
    }
  }

  return {
    style: {
      position: 'fixed',
      top: placement.top,
      left: placement.left,
      maxHeight: Math.min(maxHeight, placement.maxHeight),
    },
    side: placement.side,
  }
}
