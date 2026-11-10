import { useEffect, useState } from 'react'

/**
 * The part of the screen the person can actually see, for anything that floats
 * (menus, popovers, toolbars).
 *
 * On a phone the on-screen keyboard shrinks the *visual* viewport while the
 * layout viewport keeps the full screen height, and iOS can pan the visual
 * viewport down the page. In an installed app the page also draws under the
 * status bar and the home indicator. So "the window" is the wrong box to keep
 * a menu inside: this is the visible strip, in the coordinates that
 * `position: fixed` and `getBoundingClientRect` use.
 */
export interface VisibleArea {
  top: number
  bottom: number
  left: number
  right: number
}

/** iOS floats a previous / next / done bar over the top of the keyboard. */
export const IOS_ACCESSORY_BAR_PX = 56

/** A visual viewport this much shorter than the window means a keyboard. */
export const KEYBOARD_OPEN_PX = 100

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent

  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** The keyboard's height (0 when closed) and the room its accessory bar takes. */
export interface KeyboardInset {
  inset: number
  accessory: number
}

export function keyboardInset(): KeyboardInset {
  const viewport = typeof window === 'undefined' ? null : window.visualViewport

  if (!viewport) return { inset: 0, accessory: 0 }

  const inset = Math.max(
    0,
    window.innerHeight - viewport.height - viewport.offsetTop,
  )

  const open = inset > KEYBOARD_OPEN_PX

  return {
    inset,
    accessory: open && isIos() ? IOS_ACCESSORY_BAR_PX : 0,
  }
}

let probe: HTMLDivElement | null = null

/** The safe-area insets, read through a hidden element (CSS `env()` only). */
export function safeAreaInsets(): VisibleArea {
  if (typeof document === 'undefined')
    return { top: 0, bottom: 0, left: 0, right: 0 }

  if (!probe || !probe.isConnected) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
    document.body.appendChild(probe)
  }

  const style = getComputedStyle(probe)

  return {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  }
}

/** Measure the visible area now. */
export function readVisibleArea(): VisibleArea {
  if (typeof window === 'undefined')
    return { top: 0, bottom: 0, left: 0, right: 0 }
  const viewport = window.visualViewport
  const safe = safeAreaInsets()
  const offsetTop = viewport?.offsetTop ?? 0
  const offsetLeft = viewport?.offsetLeft ?? 0
  const height = viewport?.height ?? window.innerHeight
  const width = viewport?.width ?? document.documentElement.clientWidth
  const { inset, accessory } = keyboardInset()
  // With the keyboard open the home indicator is under it, so the bottom
  // safe area no longer applies; the accessory bar does.
  const bottomInset = inset > KEYBOARD_OPEN_PX ? accessory : safe.bottom

  return {
    top: offsetTop + safe.top,
    bottom: offsetTop + height - bottomInset,
    left: offsetLeft + safe.left,
    right: offsetLeft + width - safe.right,
  }
}

/** iOS can report the keyboard late; re-measure across its slide. */
const SETTLE_DELAYS_MS = [50, 150, 300, 500, 800]

/**
 * Subscribe to the visible area while `active`. Calls `onChange` whenever the
 * keyboard, the visual viewport, the window or a scroll container moves.
 * Returns an unsubscribe function.
 */
export function watchVisibleArea(onChange: () => void): () => void {
  const viewport = window.visualViewport
  let timers: Array<ReturnType<typeof setTimeout>> = []
  let frame = 0

  const update = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(onChange)
  }

  const settle = () => {
    update()
    timers.forEach(clearTimeout)
    timers = SETTLE_DELAYS_MS.map((ms) => setTimeout(update, ms))
  }

  viewport?.addEventListener('resize', update)
  viewport?.addEventListener('scroll', update)
  window.addEventListener('resize', settle)
  // Capture, so scrolling any pane (not only the window) re-places menus.
  window.addEventListener('scroll', update, true)
  document.addEventListener('focusin', settle)

  return () => {
    cancelAnimationFrame(frame)
    timers.forEach(clearTimeout)
    viewport?.removeEventListener('resize', update)
    viewport?.removeEventListener('scroll', update)
    window.removeEventListener('resize', settle)
    window.removeEventListener('scroll', update, true)
    document.removeEventListener('focusin', settle)
  }
}

function sameArea(a: VisibleArea | null, b: VisibleArea) {
  return (
    a !== null &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.bottom - b.bottom) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.right - b.right) < 0.5
  )
}

/** The visible area, kept current while `active` (null while inactive). */
export function useVisibleArea(active: boolean): VisibleArea | null {
  const [area, setArea] = useState<VisibleArea | null>(null)
  useEffect(() => {
    if (!active) {
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- The measurement belongs to the active subscription: deactivating clears it so a later activation never reports an area measured for an earlier keyboard and screen.
      setArea(null)

      return
    }

    const update = () => {
      const next = readVisibleArea()
      setArea((prev) => (sameArea(prev, next) ? prev : next))
    }

    update()

    return watchVisibleArea(update)
  }, [active])

  return area
}

/** Room to leave between a floating surface and the edge of the area. */
export const EDGE_GAP_PX = 8

export interface FloatingPlacement {
  top: number
  left: number
  maxHeight: number
  /** Which side of the anchor it opened on. */
  side: 'top' | 'bottom'
}

/**
 * Place a floating surface beside an anchor (a caret or a selection) inside
 * the visible area. It opens below the anchor when its natural height fits
 * there, otherwise on whichever side has more room, and is capped to that
 * room so it scrolls instead of running off the screen. Horizontally it is
 * shifted back inside the area.
 */
export function placeBeside(options: {
  anchor: { top: number; bottom: number; left: number }
  size: { width: number; height: number }
  area: VisibleArea
  gap?: number
  prefer?: 'top' | 'bottom'
}): FloatingPlacement {
  const { size, area, gap = 6, prefer = 'bottom' } = options
  // An anchor the keyboard has covered (or scrolled above the status bar) is
  // treated as sitting on that edge, so the surface still lands on screen.
  const clamp = (y: number) => Math.min(Math.max(y, area.top), area.bottom)

  const anchor = {
    top: clamp(options.anchor.top),
    bottom: clamp(options.anchor.bottom),
    left: options.anchor.left,
  }

  const below = area.bottom - EDGE_GAP_PX - (anchor.bottom + gap)
  const above = anchor.top - gap - (area.top + EDGE_GAP_PX)
  const fitsBelow = size.height <= below
  const fitsAbove = size.height <= above
  const roomier = below >= above ? 'bottom' : 'top'

  const side: 'top' | 'bottom' =
    prefer === 'bottom'
      ? fitsBelow
        ? 'bottom'
        : fitsAbove
          ? 'top'
          : roomier
      : fitsAbove
        ? 'top'
        : fitsBelow
          ? 'bottom'
          : roomier

  const room = Math.max(0, side === 'bottom' ? below : above)
  const height = Math.min(size.height, room)

  const top =
    side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - height

  const maxLeft = area.right - EDGE_GAP_PX - size.width
  const left = Math.max(area.left + EDGE_GAP_PX, Math.min(anchor.left, maxLeft))

  return { top, left, maxHeight: room, side }
}

/** A popup boundary box, in the coordinates `position: fixed` uses. */
export interface CollisionBoundary {
  x: number
  y: number
  width: number
  height: number
}

/** Collision props for a Base UI positioner. */
export interface FloatingBoundary {
  collisionBoundary?: CollisionBoundary
  collisionPadding: number
}

/**
 * Collision props for a Base UI positioner (menus, popovers, tooltips): keep
 * the popup inside the visible area rather than the window, so it flips or
 * shrinks above the keyboard and stays clear of the status bar. Use it in a
 * component rendered inside the popup's portal, so it only listens while the
 * popup is open.
 */
export function useFloatingBoundary(): FloatingBoundary {
  const area = useVisibleArea(true)

  if (!area) return { collisionPadding: EDGE_GAP_PX }

  return {
    collisionBoundary: {
      x: area.left,
      y: area.top,
      width: Math.max(0, area.right - area.left),
      height: Math.max(0, area.bottom - area.top),
    },
    collisionPadding: EDGE_GAP_PX,
  }
}
