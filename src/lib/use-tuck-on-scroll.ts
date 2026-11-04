import { useEffect, useState } from 'react'

/** How far a scroll must move before it counts, so jitter does not flicker. */
const THRESHOLD_PX = 8

/**
 * True while the person is scrolling down, false once they scroll back up or
 * reach the top. A floating control uses it to step out of the way of the
 * content it would otherwise cover at the end of a page.
 *
 * Pages scroll inside their own containers rather than the window, and a
 * scroll event does not bubble, so this listens in the capture phase on the
 * document and tracks each container's last position separately. `resetKey`
 * (the pathname) brings the control back on navigation.
 */
export function useTuckOnScroll(resetKey?: unknown): boolean {
  const [tucked, setTucked] = useState(false)

  useEffect(() => {
    setTucked(false)
  }, [resetKey])

  useEffect(() => {
    const last = new WeakMap<EventTarget, number>()
    const onScroll = (event: Event) => {
      const target = event.target
      const element =
        target instanceof Element
          ? target
          : target === document
            ? document.scrollingElement
            : null
      if (!element || !target) return
      const top = element.scrollTop
      const previous = last.get(target) ?? 0
      if (top <= 0) {
        last.set(target, 0)
        setTucked(false)
        return
      }
      if (Math.abs(top - previous) < THRESHOLD_PX) return
      last.set(target, top)
      setTucked(top > previous)
    }
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    })
    return () =>
      document.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  return tucked
}
