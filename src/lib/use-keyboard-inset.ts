import { useEffect } from 'react'

/**
 * Keep a bottom sheet above the on-screen keyboard.
 *
 * On phones the keyboard shrinks the *visual* viewport but not the layout
 * viewport, so a panel pinned to the bottom edge ends up behind the keyboard.
 * While `active`, this publishes the keyboard's height and the visible height as
 * CSS variables on the root (`--kb-inset`, `--vv-height`) for the sheet to use.
 */
export function useKeyboardInset(active: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!active || !viewport) return
    const root = document.documentElement
    const update = () => {
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      )
      root.style.setProperty('--kb-inset', `${Math.round(inset)}px`)
      root.style.setProperty('--vv-height', `${Math.round(viewport.height)}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty('--kb-inset')
      root.style.removeProperty('--vv-height')
    }
  }, [active])
}
