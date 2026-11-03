import { useEffect } from 'react'

/**
 * Keep a bottom sheet above the on-screen keyboard.
 *
 * On phones the keyboard shrinks the *visual* viewport but not the layout
 * viewport, so a panel pinned to the bottom edge ends up behind the keyboard.
 * While `active`, this publishes the keyboard's height and the visible height as
 * CSS variables on the root (`--kb-inset`, `--vv-height`) for the sheet to use.
 *
 * iOS also floats a previous / next / done bar over the top of the keyboard.
 * It is not part of the visual viewport, so it lands on whatever sits at the
 * bottom of the sheet. `--kb-accessory` is the room to leave for it, and is
 * only non-zero while the keyboard is open on an iPhone or iPad.
 */
const IOS_ACCESSORY_BAR_PX = 56

function isIos() {
  const ua = navigator.userAgent
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

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
      root.style.setProperty(
        '--kb-accessory',
        inset > 100 && isIos() ? `${IOS_ACCESSORY_BAR_PX}px` : '0px',
      )
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty('--kb-inset')
      root.style.removeProperty('--vv-height')
      root.style.removeProperty('--kb-accessory')
    }
  }, [active])
}
