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
 *
 * With the keyboard closed the sheet's bottom edge sits on the home indicator,
 * so it pads by the safe area; with it open that room is the keyboard's.
 * `--kb-safe-bottom` is the padding to use.
 *
 * iOS does not always fire a visual viewport resize the first time the
 * keyboard opens (notably in the installed app), and it can fire one before the
 * keyboard has finished sliding in. So focus changes and window resizes also
 * re-measure, again over the length of the keyboard animation.
 */
const IOS_ACCESSORY_BAR_PX = 56
const KEYBOARD_OPEN_PX = 100
/** Re-measure across the keyboard's slide (about 250ms on iOS) and after it. */
const SETTLE_DELAYS_MS = [50, 150, 300, 500, 800]

function isIos() {
  const ua = navigator.userAgent
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

const VARS = ['--kb-inset', '--vv-height', '--kb-accessory', '--kb-safe-bottom']

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
      const open = inset > KEYBOARD_OPEN_PX
      root.style.setProperty('--kb-inset', `${Math.round(inset)}px`)
      root.style.setProperty('--vv-height', `${Math.round(viewport.height)}px`)
      root.style.setProperty(
        '--kb-accessory',
        open && isIos() ? `${IOS_ACCESSORY_BAR_PX}px` : '0px',
      )
      root.style.setProperty(
        '--kb-safe-bottom',
        open ? '0px' : 'env(safe-area-inset-bottom)',
      )
    }
    let timers: Array<ReturnType<typeof setTimeout>> = []
    const settle = () => {
      update()
      timers.forEach(clearTimeout)
      timers = SETTLE_DELAYS_MS.map((ms) => setTimeout(update, ms))
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    window.addEventListener('resize', settle)
    document.addEventListener('focusin', settle)
    document.addEventListener('focusout', settle)
    return () => {
      timers.forEach(clearTimeout)
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      window.removeEventListener('resize', settle)
      document.removeEventListener('focusin', settle)
      document.removeEventListener('focusout', settle)
      for (const name of VARS) root.style.removeProperty(name)
    }
  }, [active])
}
