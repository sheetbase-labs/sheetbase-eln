import { useLayoutEffect, useRef } from 'react'

const ACTIVE = ':scope > [aria-current="page"], :scope > [data-active]'

/**
 * The current tab's mark, drawn once per strip and slid to whichever tab is
 * current, so a change of tab reads as movement rather than a swap. The tabs
 * keep their own resting mark until the first placement lands, so the strip
 * looks the same before hydration, without script and under reduced motion.
 *
 * Place it as the last child of the strip; the strip must be `relative`.
 */
export function TabIndicator() {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const mark = ref.current
    const strip = mark?.parentElement

    // Without layout observers (an old browser, a test DOM) the tabs keep
    // drawing their own mark.
    if (!mark || !strip || !('ResizeObserver' in window)) return

    const place = () => {
      const tab = strip.querySelector<HTMLElement>(ACTIVE)

      if (!tab || tab.offsetWidth === 0) {
        strip.removeAttribute('data-indicator')

        return
      }

      mark.style.setProperty('--tab-x', `${tab.offsetLeft}px`)
      mark.style.setProperty('--tab-y', `${tab.offsetTop}px`)
      mark.style.setProperty('--tab-w', `${tab.offsetWidth}px`)
      mark.style.setProperty('--tab-h', `${tab.offsetHeight}px`)

      // The first placement jumps; only later ones slide.
      if (strip.dataset.indicator === 'placed') strip.dataset.indicator = 'on'
      else if (strip.dataset.indicator !== 'on')
        strip.dataset.indicator = 'placed'
    }

    place()

    const resize = new ResizeObserver(place)

    resize.observe(strip)

    for (const child of strip.children) resize.observe(child)

    const mutate = new MutationObserver(place)

    mutate.observe(strip, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-current', 'data-active', 'class'],
    })

    return () => {
      resize.disconnect()
      mutate.disconnect()
      strip.removeAttribute('data-indicator')
    }
  }, [])

  return <span ref={ref} aria-hidden className="sb-tab-indicator" />
}
